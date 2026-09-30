// pricing_effective_dating.test.ts
// PX02 negative controls: prices are effective-dated routing inputs.
//
// Controls proven here:
//  1. Context-tier boundary: below/above the 272K threshold select the
//     standard vs long-context tariff (tested exactly at the boundary).
//  2. Expired promotional rate: a rate whose effective window has ended is
//     reported as `stale` (never silently current, never coerced to free)
//     and must reject Auto before any provider call.
//  3. Unknown pricing: fail-closed — lookup returns `unknown` with a null
//     record (not zero rates), and neither Auto nor manual send is allowed.
//  4. Registry rows are sourced: concrete source URL, currency, and
//     effective range are exposed so receipts can record them.
//
// The corrected tariff values below are pinned to the official OpenCode Zen
// pricing page (https://opencode.ai/docs/zen, page updated 2026-09-29) and
// the official OpenAI API pricing page
// (https://developers.openai.com/api/docs/pricing) observed on 2026-09-29.

import { describe, expect, it } from 'vitest';
import {
  PRICING_REGISTRY,
  PRICING_SOURCES,
  PRICING_VERSION,
  STALE_AFTER_DAYS,
  calculateEstimatedCostUsd,
  lookupPrice,
} from '../../supabase/functions/router/pricing_registry.ts';
import { evaluateAutoSendSafety } from '../../supabase/functions/router/cost_engine.ts';

const OFFICIAL_TARIFF_OBSERVED_ON = '2026-09-29';

describe('PX02 negative controls: effective-dated pricing', () => {
  it('272K tier boundary: at or below the threshold uses the standard tariff', () => {
    const standard = calculateEstimatedCostUsd(
      'gpt-5.6-sol',
      1_000_000,
      0,
      272_000, // exactly the boundary: standard tier
      0,
      0,
      new Date(`${OFFICIAL_TARIFF_OBSERVED_ON}T12:00:00Z`),
    );
    expect(standard.isLongContext).toBe(false);
    // Official tariff: $4.00 input per 1M (standard tier).
    expect(standard.breakdown?.inputCost).toBeCloseTo(4.0, 6);
  });

  it('272K tier boundary: above the threshold uses the long-context tariff', () => {
    const long = calculateEstimatedCostUsd(
      'gpt-5.6-sol',
      1_000_000,
      0,
      272_001, // one token past the boundary
      0,
      0,
      new Date(`${OFFICIAL_TARIFF_OBSERVED_ON}T12:00:00Z`),
    );
    expect(long.isLongContext).toBe(true);
    // Official tariff: $8.00 input per 1M (long-context tier).
    expect(long.breakdown?.inputCost).toBeCloseTo(8.0, 6);
  });

  it('expired promotional rate is reported stale, not free and not current', () => {
    // Fixture: promotional rate that expired before the evaluation date.
    const fixtureKey = 'promo-expired-fixture';
    try {
      PRICING_REGISTRY[fixtureKey] = {
        inputRatePer1M: 0.1,
        outputRatePer1M: 0.2,
        asOfDate: '2026-09-01',
        effectiveFrom: '2026-09-01',
        effectiveUntil: '2026-09-15', // expired relative to evaluation date
        sourceRef: 'opencode-zen-official',
        isEstimated: false,
        isEligibleForAutoRouting: true,
      };

      const lookup = lookupPrice(
        fixtureKey,
        0,
        new Date(`${OFFICIAL_TARIFF_OBSERVED_ON}T12:00:00Z`),
      );
      expect(lookup.status).toBe('stale');
      expect(lookup.effectiveUntil).toBe('2026-09-15');
      // Stale authoritative data keeps its recorded rates — it must not
      // masquerade as current, and it must not be coerced to free.
      expect(lookup.pricing?.inputRatePer1M).toBe(0.1);
      expect(lookup.isEligibleForAutoRouting).toBe(false);

      const estimate = calculateEstimatedCostUsd(
        fixtureKey,
        1_000_000,
        0,
        0,
        0,
        0,
        new Date(`${OFFICIAL_TARIFF_OBSERVED_ON}T12:00:00Z`),
      );
      expect(estimate.isStale).toBe(true);
      expect(estimate.pricingStatus).toBe('stale');
      expect(estimate.breakdown?.inputCost).toBeCloseTo(0.1, 6);
      expect(estimate.eligibleForAutoRoute).toBe(false);
    } finally {
      delete PRICING_REGISTRY[fixtureKey];
    }
  });

  it('expired promotional rate rejects Auto before any provider call', () => {
    const fixtureKey = 'promo-expired-fixture';
    try {
      PRICING_REGISTRY[fixtureKey] = {
        inputRatePer1M: 0.1,
        outputRatePer1M: 0.2,
        asOfDate: '2026-09-01',
        effectiveFrom: '2026-09-01',
        effectiveUntil: '2026-09-15',
        sourceRef: 'opencode-zen-official',
        isEstimated: false,
        isEligibleForAutoRouting: true,
      };

      // Pure gate: runs synchronously before the provider call path.
      const decision = evaluateAutoSendSafety({
        isAuto: true,
        modelTier: fixtureKey as never,
        hasUnknownRate: false,
        evaluationDate: new Date(`${OFFICIAL_TARIFF_OBSERVED_ON}T12:00:00Z`),
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('stale_pricing');
    } finally {
      delete PRICING_REGISTRY[fixtureKey];
    }
  });

  it('unknown pricing is fail-closed: null record, no Auto, no manual route', () => {
    const lookup = lookupPrice('no-such-model-anywhere');
    expect(lookup.status).toBe('unknown');
    // Unknown must be a null record, never silently zero/free rates.
    expect(lookup.pricing).toBeNull();
    expect(lookup.isEligibleForAutoRouting).toBe(false);

    const auto = evaluateAutoSendSafety({
      isAuto: true,
      modelTier: 'no-such-model-anywhere' as never,
      hasUnknownRate: false,
    });
    expect(auto.allowed).toBe(false);
    expect(auto.reason).toBe('unknown_pricing');

    // Manual unknown-price route requires explicit supported policy — the
    // default gate rejects it too.
    const manual = evaluateAutoSendSafety({
      isAuto: false,
      modelTier: 'no-such-model-anywhere' as never,
      hasUnknownRate: false,
    });
    expect(manual.allowed).toBe(false);
    expect(manual.reason).toBe('unknown_pricing');

    const estimate = calculateEstimatedCostUsd('no-such-model-anywhere', 1000, 100);
    expect(estimate.costUsd).toBeNull();
    expect(estimate.isUnknown).toBe(true);
  });

  it('stale legacy pricing rejects Auto but keeps recorded rates for manual review', () => {
    // Legacy direct-provider rows have not been re-verified since
    // 2026-04-13, which is older than the staleness window.
    const lookup = lookupPrice(
      'claude-3-5-sonnet',
      0,
      new Date(`${OFFICIAL_TARIFF_OBSERVED_ON}T12:00:00Z`),
    );
    expect(lookup.status).toBe('stale');
    expect(lookup.isEligibleForAutoRouting).toBe(false);
    expect(lookup.pricing?.inputRatePer1M).toBe(3.0);
  });

  it('every registry row resolves to a concrete source URL and currency', () => {
    const problems: string[] = [];
    for (const [model, pricing] of Object.entries(PRICING_REGISTRY)) {
      if (!PRICING_SOURCES[pricing.sourceRef]) {
        problems.push(`${model}: no concrete source URL for sourceRef '${pricing.sourceRef}'`);
      }
      const lookup = lookupPrice(model, 0, new Date(`${OFFICIAL_TARIFF_OBSERVED_ON}T12:00:00Z`));
      if (lookup.currency !== 'USD') problems.push(`${model}: currency is not USD`);
      if (!lookup.effectiveFrom) problems.push(`${model}: no effectiveFrom`);
    }
    expect(problems).toEqual([]);
  });

  it('registry rows corrected against the 2026-09-29 official tariff are pinned', () => {
    // deepseek-v4-flash / deepseek-v4-pro / gpt-5.6-sol / gemini-3.7-flash
    // previously disagreed with the official provider pages (audit E28/E64).
    const flash = PRICING_REGISTRY['deepseek-v4-flash']!;
    expect(flash.inputRatePer1M).toBe(0.14);
    expect(flash.outputRatePer1M).toBe(0.28);
    expect(flash.cachedReadRatePer1M).toBe(0.028);
    expect(flash.asOfDate).toBe(OFFICIAL_TARIFF_OBSERVED_ON);

    const pro = PRICING_REGISTRY['deepseek-v4-pro']!;
    expect(pro.inputRatePer1M).toBe(1.74);
    expect(pro.outputRatePer1M).toBe(3.48);
    expect(pro.cachedReadRatePer1M).toBe(0.145);

    const sol = PRICING_REGISTRY['gpt-5.6-sol']!;
    expect(sol.inputRatePer1M).toBe(4.0);
    expect(sol.outputRatePer1M).toBe(20.0);
    expect(sol.longContextInputRatePer1M).toBe(8.0);
    expect(sol.longContextOutputRatePer1M).toBe(30.0);
    // Promotional window recorded so expiry is detectable, not silent.
    expect(sol.effectiveUntil).toBe('2026-11-21');

    const gemini = PRICING_REGISTRY['gemini-3.7-flash']!;
    expect(gemini.cachedReadRatePer1M).toBe(0.15);
  });

  it('price version and staleness window are exported for receipts', () => {
    expect(PRICING_VERSION).toBe('2026-09-29-v8');
    expect(STALE_AFTER_DAYS).toBeGreaterThan(0);
  });
});
