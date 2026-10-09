// tariff-boundaries.test.ts — PX04 deterministic boundary coverage for the
// authoritative pricing interval + modality guards.
//
// Offline/deterministic: every "now" is passed explicitly, every model is a
// real registry entry, and the functions under test are the real production
// implementations (no self-asserting mocks).
//
// Policy:
//  - Long-context billing flips only strictly above longContextThreshold.
//  - Cache-hit (read), cache-write and uncached input bill into distinct buckets.
//  - Reasoning tokens are a subset of completion tokens: never double-charged.
//  - Expired / malformed / unknown prices fail closed (never a live rate).
//  - Images supplied to a model that cannot see images are rejected.
//  - Frontend and server tariff versions are identical.
//  - Auto routing excludes non-approved (trainsOnData / free-tier) endpoints.

import { describe, expect, it } from 'vitest';
import {
  MODEL_TARIFF_VERSION,
  isPriceExpired,
  assertPricingCurrent,
  StalePriceError,
} from '../../supabase/functions/_shared/model_tariff.ts';
import {
  PRICING_VERSION as BACKEND_PRICING_VERSION,
  getPricingForModel,
  calculateEstimatedCostUsd,
} from '../../supabase/functions/router/pricing_registry.ts';
import { PRICING_VERSION as FRONTEND_PRICING_VERSION } from '../../src/pricingRegistry';
import {
  calculateFinalCost,
  calculateCostBreakdown,
  evaluateAutoSendSafety,
} from '../../supabase/functions/router/cost_engine.ts';
import {
  ModalityMismatchError,
  assertRouteSupportsModalities,
  routeSupportsImages,
} from '../../supabase/functions/router/router_logic.ts';

// gpt-5.6-luna: threshold 272000; base input $0.20/M, long-context input $0.40/M.
const LONG_CONTEXT_THRESHOLD = 272000;

describe('long-context tier boundary (immediately below / at / above threshold)', () => {
  it('bills base rates strictly below and exactly at the threshold, long rates above', () => {
    const below = calculateEstimatedCostUsd(
      'gpt-5.6-luna',
      LONG_CONTEXT_THRESHOLD - 1,
      1000,
      LONG_CONTEXT_THRESHOLD - 1,
    );
    const at = calculateEstimatedCostUsd(
      'gpt-5.6-luna',
      LONG_CONTEXT_THRESHOLD,
      1000,
      LONG_CONTEXT_THRESHOLD,
    );
    const above = calculateEstimatedCostUsd(
      'gpt-5.6-luna',
      LONG_CONTEXT_THRESHOLD + 1,
      1000,
      LONG_CONTEXT_THRESHOLD + 1,
    );

    // The threshold is exclusive: at-threshold is NOT long context.
    expect(below.isLongContext).toBe(false);
    expect(at.isLongContext).toBe(false);
    expect(above.isLongContext).toBe(true);

    // Base input rate ($0.20/M) below and at; long-context rate ($0.40/M) above.
    expect(below.breakdown?.inputCost).toBeCloseTo((LONG_CONTEXT_THRESHOLD - 1) * 0.2 / 1_000_000, 9);
    expect(at.breakdown?.inputCost).toBeCloseTo(LONG_CONTEXT_THRESHOLD * 0.2 / 1_000_000, 9);
    expect(above.breakdown?.inputCost).toBeCloseTo((LONG_CONTEXT_THRESHOLD + 1) * 0.4 / 1_000_000, 9);
  });
});

describe('cache hit / cache write / uncached bucket separation', () => {
  it('applies each token class to its own rate without overlap', () => {
    // claude-sonnet-5: input $2.00/M, output $10.00/M, cache read $0.20/M, cache write $2.50/M.
    const cost = calculateEstimatedCostUsd(
      'claude-sonnet-5',
      1000, // total prompt tokens
      200, // output tokens
      1000, // context tokens (below any long-context threshold)
      400, // cache-hit (read) tokens
      100, // cache-write tokens
    );

    // Uncached input = 1000 - 400 = 600 tokens.
    expect(cost.breakdown?.inputCost).toBeCloseTo(600 * 2.0 / 1_000_000, 12);
    expect(cost.breakdown?.cachedReadCost).toBeCloseTo(400 * 0.2 / 1_000_000, 12);
    expect(cost.breakdown?.cachedWriteCost).toBeCloseTo(100 * 2.5 / 1_000_000, 12);
    expect(cost.breakdown?.outputCost).toBeCloseTo(200 * 10.0 / 1_000_000, 12);

    const total =
      (600 * 2.0 + 200 * 10.0 + 400 * 0.2 + 100 * 2.5) / 1_000_000;
    expect(cost.costUsd).toBeCloseTo(total, 12);
  });
});

describe('reasoning tokens are a subset of completion tokens (no double-charge)', () => {
  it('charges reasoning at the reasoning rate and the remainder at the output rate', () => {
    // o3-mini: output $4.40/M, reasoning $4.40/M.
    const usage = { promptTokens: 0, completionTokens: 1000, reasoningTokens: 400 };

    const final = calculateFinalCost('o3-mini', usage);
    const breakdown = calculateCostBreakdown('o3-mini', usage);

    // 600 output * $4.40/M + 400 reasoning * $4.40/M = $0.0044 — NOT $0.00616.
    expect(final.finalUsd).toBeCloseTo(0.0044, 9);
    expect(breakdown.outputCostUsd).toBeCloseTo(0.00264, 9);
    expect(breakdown.reasoningCostUsd).toBeCloseTo(0.00176, 9);
    expect(breakdown.totalUsd).toBeCloseTo(0.0044, 9);
  });

  it('treats reasoning tokens beyond completion tokens as non-negative billable output', () => {
    const final = calculateFinalCost('o3-mini', {
      promptTokens: 0,
      completionTokens: 100,
      reasoningTokens: 400,
    });
    // Output bucket floors at zero; reasoning is still billed once.
    expect(final.finalUsd).toBeCloseTo(400 * 4.4 / 1_000_000, 9);
  });
});

describe('effective-interval expiry fails closed', () => {
  it('treats a past effectiveTo as expired and a future one as current', () => {
    const now = new Date('2026-10-07T00:00:00Z');
    expect(isPriceExpired({ effectiveTo: '2020-01-01' }, now)).toBe(true);
    expect(isPriceExpired({ effectiveTo: '2030-01-01' }, now)).toBe(false);
    expect(isPriceExpired({}, now)).toBe(false);
    // The whole effectiveTo UTC day is billable (inclusive).
    expect(isPriceExpired({ effectiveTo: '2026-10-07' }, now)).toBe(false);
  });

  it('effectiveTo is inclusive of its last billable UTC day', () => {
    const lastDay = '2026-12-31';
    // Any instant during the effectiveTo day is still live...
    expect(isPriceExpired({ effectiveTo: lastDay }, new Date('2026-12-31T00:00:00Z'))).toBe(false);
    expect(isPriceExpired({ effectiveTo: lastDay }, new Date('2026-12-31T23:59:59Z'))).toBe(false);
    // ...and it expires at the start of the following UTC day.
    expect(isPriceExpired({ effectiveTo: lastDay }, new Date('2027-01-01T00:00:00Z'))).toBe(true);
    expect(isPriceExpired({ effectiveTo: lastDay }, new Date('2027-01-01T00:00:01Z'))).toBe(true);
  });

  it('getPricingForModel returns the fail-closed marker for an expired entry', () => {
    // Gemini 3.8 Flash intro rate is billable through (and including) 2026-12-31.
    const duringLastDay = getPricingForModel(
      'gemini-3.8-flash',
      new Date('2026-12-31T23:59:59Z'),
    );
    expect(duringLastDay.isUnknown).toBeFalsy();
    expect(duringLastDay.inputRatePer1M).toBe(0.75);

    const afterExpiry = new Date('2027-01-01T00:00:00Z');
    const expired = getPricingForModel('gemini-3.8-flash', afterExpiry);

    expect(expired.isUnknown).toBe(true);
    expect(expired.isExpired).toBe(true);
    expect(expired.isEligibleForAutoRouting).toBe(false);
    expect(expired.inputRatePer1M).toBe(0);
    expect(expired.outputRatePer1M).toBe(0);

    // Same model is live before its effectiveTo.
    const live = getPricingForModel('gemini-3.8-flash', new Date('2026-10-07T00:00:00Z'));
    expect(live.isUnknown).toBeFalsy();
    expect(live.inputRatePer1M).toBe(0.75);
  });

  it('assertPricingCurrent throws StalePriceError for expired and unknown models', () => {
    expect(() => assertPricingCurrent('gemini-3.8-flash', new Date('2027-01-01T00:00:00Z')))
      .toThrow(StalePriceError);
    expect(() => assertPricingCurrent('gemini-3.8-flash', new Date('2026-10-07T00:00:00Z')))
      .not.toThrow();
    expect(() => assertPricingCurrent('definitely-not-a-model')).toThrow(StalePriceError);
  });

  it('a malformed effectiveTo fails closed (treated as expired)', () => {
    const now = new Date('2026-10-07T00:00:00Z');
    expect(isPriceExpired({ effectiveTo: 'not-a-date' }, now)).toBe(true);
    expect(isPriceExpired({ effectiveTo: '2026-13-45' }, now)).toBe(true);
    expect(isPriceExpired({ effectiveTo: '2026-02-30' }, now)).toBe(true);
    expect(isPriceExpired({ effectiveTo: '2026-2-3' }, now)).toBe(true);
  });

  it('unknown prices are rejected, never silently priced', () => {
    const unknown = getPricingForModel('definitely-not-a-model');
    expect(unknown.isUnknown).toBe(true);
    expect(unknown.isEligibleForAutoRouting).toBe(false);

    const cost = calculateEstimatedCostUsd('definitely-not-a-model', 1000, 500);
    expect(cost.costUsd).toBeNull();
    expect(cost.isUnknown).toBe(true);
    expect(cost.eligibleForAutoRoute).toBe(false);
  });
});

describe('image-modality guard', () => {
  it('rejects images supplied to an image-incompatible route and accepts an image-capable one', () => {
    expect(routeSupportsImages('deepseek-v4-flash')).toBe(false);
    expect(routeSupportsImages('gpt-5.6-luna')).toBe(true);

    expect(() => assertRouteSupportsModalities('deepseek-v4-flash', { images: true }))
      .toThrow(ModalityMismatchError);
    expect(() => assertRouteSupportsModalities('gpt-5.6-luna', { images: true }))
      .not.toThrow();

    // Text-only requests are always allowed.
    expect(() => assertRouteSupportsModalities('deepseek-v4-flash', { images: false }))
      .not.toThrow();
    expect(() => assertRouteSupportsModalities('deepseek-v4-flash'))
      .not.toThrow();
  });

  it('fails closed for an unknown route when images are supplied', () => {
    expect(routeSupportsImages('no-such-route')).toBe(false);
    expect(() => assertRouteSupportsModalities('no-such-route', { images: true }))
      .toThrow(ModalityMismatchError);
  });
});

describe('catalog version identity', () => {
  it('frontend and server PRICING_VERSION match the single tariff authority', () => {
    expect(FRONTEND_PRICING_VERSION).toBe(BACKEND_PRICING_VERSION);
    expect(BACKEND_PRICING_VERSION).toBe(MODEL_TARIFF_VERSION);
  });
});

describe('Auto excludes non-approved / data-retentive endpoints', () => {
  it('flags free-tier endpoints as ineligible for automatic routing', () => {
    expect(getPricingForModel('deepseek-v4-flash-free').isEligibleForAutoRouting).toBe(false);
    expect(getPricingForModel('mimo-v2.5-free').isEligibleForAutoRouting).toBe(false);
  });

  it('evaluateAutoSendSafety blocks auto-send to a non-approved endpoint', () => {
    const decision = evaluateAutoSendSafety({
      isAuto: true,
      modelTier: 'deepseek-v4-flash-free',
      hasUnknownRate: false,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('auto_not_eligible');
  });

  it('still allows an approved model for automatic routing', () => {
    const decision = evaluateAutoSendSafety({
      isAuto: true,
      modelTier: 'deepseek-v4-flash',
      hasUnknownRate: false,
    });
    expect(decision.allowed).toBe(true);
  });
});
