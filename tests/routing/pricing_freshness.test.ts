// pricing_freshness.test.ts
// Price-freshness + authority-divergence audit, executed as part of the
// canonical verification command (`npm test`) so CI always surfaces stale
// pricing.
//
// Policy (matches existing repository semantics):
//  - Every routable model must have a pricing registry entry that is not
//    marked unknown.
//  - OpenCode auto-route prices older than STALE_AFTER_DAYS fail the test.
//    Stale legacy direct-provider rates fail closed at runtime and appear in
//    the non-auto inventory so they can be reviewed.
//  - The frontend pricing registry is a display-only mirror of the backend
//    authority; shared rates and PRICING_VERSION must never diverge.

import { describe, expect, it } from 'vitest';
import { MODEL_REGISTRY } from '../../supabase/functions/router/router_logic.ts';
import { CURATED_OPENCODE_REGISTRY } from '../../supabase/functions/router/models_hub.ts';
import {
  PRICING_REGISTRY,
  PRICING_VERSION as BACKEND_PRICING_VERSION,
  getPricingForModel,
} from '../../supabase/functions/router/pricing_registry.ts';
import { isLegacyPriceStale } from '../../supabase/functions/_shared/model_tariff.ts';
import {
  PRICING_REGISTRY as FRONTEND_PRICING_REGISTRY,
  PRICING_VERSION as FRONTEND_PRICING_VERSION,
} from '../../src/pricingRegistry';

const STALE_AFTER_DAYS = 60;

// Curated OpenCode models are the models Auto can actually pick, so their
// pricing must be current. Legacy direct-provider entries are also blocked at
// runtime when their audit date is too old; the inventory remains visible
// until a verified pricing review refreshes them.
const AUTO_ROUTABLE_SOURCES = new Set(['opencode-zen-official', 'opencode-zen-free-tier', 'opencode-zen-free']);

function ageInDays(isoDate: string): number {
  const then = new Date(`${isoDate}T00:00:00Z`).getTime();
  return (Date.now() - then) / 86_400_000;
}

describe('pricing freshness audit', () => {
  it('every routable model (registry + curated hub) has a known pricing entry', () => {
    const routableModels = [
      ...Object.keys(MODEL_REGISTRY),
      ...Object.keys(CURATED_OPENCODE_REGISTRY),
    ];
    const missing: string[] = [];

    for (const tier of routableModels) {
      const pricing = PRICING_REGISTRY[tier];
      if (!pricing) {
        missing.push(`${tier}: no PRICING_REGISTRY entry`);
      } else if (pricing.isUnknown) {
        missing.push(`${tier}: entry marked isUnknown`);
      }
    }

    expect(missing, `Unpriced routable models:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it(`pricing for auto-routable OpenCode models is never older than ${STALE_AFTER_DAYS} days (blocking)`, () => {
    const stale = Object.entries(PRICING_REGISTRY)
      .filter(([, p]) => AUTO_ROUTABLE_SOURCES.has(p.sourceRef))
      .filter(([, p]) => ageInDays(p.asOfDate) > STALE_AFTER_DAYS)
      .map(([tier, p]) => `${tier}: asOfDate ${p.asOfDate}`);

    expect(
      stale,
      'Stale pricing on auto-routable models — verify current OpenCode Zen rates ' +
        `and bump asOfDate/PRICING_VERSION:\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });

  it('stale legacy direct-provider entries are blocked without changing unverified rates', () => {
    const now = new Date('2026-11-21T12:00:00Z');
    const stale = Object.entries(PRICING_REGISTRY)
      .filter(([, p]) => isLegacyPriceStale(p, now));

    for (const [tier, entry] of stale) {
      const guarded = getPricingForModel(tier, now);
      expect(guarded.isUnknown, `${tier} stale source ${entry.sourceRef}`).toBe(true);
      expect(guarded.isStale, `${tier} stale source ${entry.sourceRef}`).toBe(true);
      expect(guarded.inputRatePer1M).toBe(0);
      expect(guarded.outputRatePer1M).toBe(0);
    }

    // Keep the inventory visible without requiring prices to remain stale or
    // to be marked current before anyone has verified them.
    const otherNonAutoStale = Object.entries(PRICING_REGISTRY)
      .filter(([, p]) => !AUTO_ROUTABLE_SOURCES.has(p.sourceRef))
      .filter(([, p]) => ageInDays(p.asOfDate) > STALE_AFTER_DAYS)
      .map(([tier, p]) => `${tier}: asOfDate ${p.asOfDate} (${Math.floor(ageInDays(p.asOfDate))} days)`);
    if (otherNonAutoStale.length > 0) {
      console.warn(
        `[pricing-freshness] WARNING: ${otherNonAutoStale.length} non-auto pricing entries are ` +
          `older than ${STALE_AFTER_DAYS} days (do not bump dates without review):\n  ${otherNonAutoStale.join('\n  ')}`,
      );
    }
  });

  it('backend is the pricing authority and version-stamped', () => {
    expect(BACKEND_PRICING_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}-v\d+$/);
  });
});

describe('frontend pricing mirror divergence guard', () => {
  it('frontend PRICING_VERSION matches the backend authority', () => {
    expect(FRONTEND_PRICING_VERSION).toBe(BACKEND_PRICING_VERSION);
  });

  it('shared rate fields never diverge between frontend mirror and backend authority', () => {
    const divergences: string[] = [];
    const RATE_FIELDS = [
      'inputRatePer1M',
      'outputRatePer1M',
      'cachedReadRatePer1M',
      'cachedWriteRatePer1M',
      'reasoningRatePer1M',
    ] as const;

    for (const [tier, backend] of Object.entries(PRICING_REGISTRY)) {
      const frontend = FRONTEND_PRICING_REGISTRY[tier];
      if (!frontend) {
        divergences.push(`${tier}: missing from frontend mirror`);
        continue;
      }
      for (const field of RATE_FIELDS) {
        if (backend[field] !== frontend[field]) {
          divergences.push(`${tier}.${field}: backend=${backend[field]} frontend=${frontend[field]}`);
        }
      }
      if (backend.asOfDate !== frontend.asOfDate) {
        divergences.push(`${tier}.asOfDate: backend=${backend.asOfDate} frontend=${frontend.asOfDate}`);
      }
    }

    expect(
      divergences,
      'Pricing mirror divergence (backend is authoritative):\n  ' + divergences.join('\n  '),
    ).toEqual([]);
  });
});
