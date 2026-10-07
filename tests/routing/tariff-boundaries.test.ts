// tariff-boundaries.test.ts
// PX04 — deterministic, offline boundary coverage for the authoritative pricing
// catalog and fail-closed tariff semantics:
//   - long-context tier boundaries (immediately below / at / above)
//   - cache-hit vs cache-write vs uncached input
//   - reasoning-token inclusion is billed exactly once
//   - expired + unknown prices are rejected (never silently defaulted)
//   - unavailable manual models are rejected
//   - image/video-incompatible routes are rejected, not downgraded
//   - frontend/server catalog versions stay identical
//   - privacy-unapproved free endpoints are excluded from Auto
//   - the verify-catalog drift gate fails on injected drift (negative control)

import { afterEach, describe, expect, it } from 'vitest';
import {
  PRICING_REGISTRY,
  PRICING_VERSION as SERVER_PRICING_VERSION,
  StalePriceError,
  assertPricingCurrent,
  calculateEstimatedCostUsd,
  getPricingForModel,
  isPriceExpired,
  type ModelPricing,
} from '../../supabase/functions/router/pricing_registry.ts';
import {
  PRICING_REGISTRY as FRONTEND_PRICING_REGISTRY,
  PRICING_VERSION as FRONTEND_PRICING_VERSION,
} from '../../src/pricingRegistry';
import {
  CURATED_OPENCODE_REGISTRY,
  CURATED_ROUTE_POLICY,
} from '../../supabase/functions/router/models_hub.ts';
import {
  ModalityMismatchError,
  assertRouteSupportsModalities,
  determineRoute,
  normalizeModelOverride,
  resolveCanonicalModelId,
  type RouterParams,
} from '../../supabase/functions/router/router_logic.ts';
import { calculateCostBreakdown } from '../../supabase/functions/router/cost_engine.ts';
import { normalizeDecisionAgainstProviderAvailability } from '../../supabase/functions/router/provider_availability.ts';
import { verifyCatalog } from '../../scripts/verify-catalog.mjs';
import approvedModels from '../../catalog/approved-models.json';
import prices from '../../catalog/prices.json';

const LUNA_THRESHOLD = 272000;

function baseParams(over: Partial<RouterParams> = {}): RouterParams {
  return {
    userQuery: 'hi',
    currentSessionTokens: 0,
    platform: 'web',
    history: [],
    ...over,
  };
}

type CatalogEntry = {
  id: string;
  gateway: string;
  protocol: string;
  modalities: string[];
  qualification: 'approved' | 'candidate' | 'disabled';
  tariffKey: string;
  privacy: { retention: string; trainsOnData: boolean };
};

const approvedById = new Map(
  (approvedModels as CatalogEntry[]).map((entry) => [entry.id, entry]),
);

describe('long-context tariff boundaries (gpt-5.6-luna @ 272000)', () => {
  it('immediately below the threshold bills the base input rate', () => {
    const result = calculateEstimatedCostUsd(
      'gpt-5.6-luna',
      LUNA_THRESHOLD - 1,
      0,
      LUNA_THRESHOLD - 1,
    );
    expect(result.isLongContext).toBe(false);
    expect(result.costUsd).toBeCloseTo(((LUNA_THRESHOLD - 1) / 1_000_000) * 0.20, 9);
  });

  it('exactly at the threshold is NOT long context (strict greater-than)', () => {
    const result = calculateEstimatedCostUsd('gpt-5.6-luna', LUNA_THRESHOLD, 0, LUNA_THRESHOLD);
    expect(result.isLongContext).toBe(false);
    expect(result.costUsd).toBeCloseTo((LUNA_THRESHOLD / 1_000_000) * 0.20, 9);
  });

  it('immediately above the threshold switches to the long-context rate', () => {
    const result = calculateEstimatedCostUsd(
      'gpt-5.6-luna',
      LUNA_THRESHOLD + 1,
      0,
      LUNA_THRESHOLD + 1,
    );
    expect(result.isLongContext).toBe(true);
    expect(result.costUsd).toBeCloseTo(((LUNA_THRESHOLD + 1) / 1_000_000) * 0.40, 9);
  });
});

describe('cache hit / cache write / uncached tariff semantics', () => {
  it('bills uncached, cached-read and cached-write buckets at distinct rates', () => {
    const result = calculateEstimatedCostUsd(
      'claude-haiku-4-5',
      1_000_000,
      0,
      1_000_000,
      400_000,
      100_000,
    );
    expect(result.breakdown?.inputCost).toBeCloseTo(0.60, 9);
    expect(result.breakdown?.cachedReadCost).toBeCloseTo(0.04, 9);
    expect(result.breakdown?.cachedWriteCost).toBeCloseTo(0.125, 9);
    expect(result.costUsd).toBeCloseTo(0.765, 9);
  });

  it('never bills cached-read tokens at the uncached input rate', () => {
    const result = calculateEstimatedCostUsd(
      'claude-haiku-4-5',
      1_000_000,
      0,
      1_000_000,
      1_000_000,
      0,
    );
    expect(result.breakdown?.inputCost).toBe(0);
    expect(result.breakdown?.cachedReadCost).toBeCloseTo(0.10, 9);
    expect(result.costUsd).toBeCloseTo(0.10, 9);
  });
});

describe('reasoning-token billing semantics', () => {
  it('bills reasoning tokens exactly once at the reasoning rate', () => {
    const result = calculateCostBreakdown('o3-mini', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      reasoningTokens: 1_000_000,
    });
    expect(result.inputCostUsd).toBeCloseTo(1.10, 9);
    expect(result.outputCostUsd).toBeCloseTo(4.40, 9);
    expect(result.reasoningCostUsd).toBeCloseTo(4.40, 9);
    expect(result.totalUsd).toBeCloseTo(1.10 + 4.40 + 4.40, 9);
  });

  it('falls back to the output rate exactly once when no reasoning rate is set', () => {
    const result = calculateCostBreakdown('gpt-5.6-luna', {
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 1_000_000,
    });
    expect(result.reasoningCostUsd).toBeCloseTo(1.20, 9);
    expect(result.totalUsd).toBeCloseTo(1.20, 9);
  });
});

describe('fail-closed expiry and unknown prices', () => {
  const EXPIRED_FIXTURE = '__px04-expired-fixture__';

  afterEach(() => {
    delete PRICING_REGISTRY[EXPIRED_FIXTURE];
  });

  it('rejects an expired price instead of defaulting to a rate', () => {
    PRICING_REGISTRY[EXPIRED_FIXTURE] = {
      inputRatePer1M: 1,
      outputRatePer1M: 1,
      asOfDate: '2000-01-01',
      sourceRef: 'test-fixture',
      isEstimated: false,
      effectiveFrom: '2000-01-01',
      effectiveTo: '2000-01-02',
    };

    const now = new Date('2026-10-07T00:00:00Z');
    const pricing = getPricingForModel(EXPIRED_FIXTURE, now);
    expect(pricing.isUnknown).toBe(true);
    expect(pricing.isExpired).toBe(true);
    expect(pricing.isEligibleForAutoRouting).toBe(false);

    const cost = calculateEstimatedCostUsd(EXPIRED_FIXTURE, 1_000, 1_000);
    expect(cost.costUsd).toBeNull();
    expect(cost.isUnknown).toBe(true);

    expect(() => assertPricingCurrent(EXPIRED_FIXTURE, now)).toThrow(StalePriceError);
  });

  it('rejects an unknown price (typed marker, never a silent zero rate)', () => {
    const pricing = getPricingForModel('__px04-mystery-model__');
    expect(pricing.isUnknown).toBe(true);
    expect(pricing.isEligibleForAutoRouting).toBe(false);

    expect(calculateEstimatedCostUsd('__px04-mystery-model__', 1_000, 1_000).costUsd).toBeNull();
    expect(() => assertPricingCurrent('__px04-mystery-model__')).toThrow(StalePriceError);
  });

  it('accepts a price whose effective interval has not lapsed', () => {
    const valid: ModelPricing = {
      ...PRICING_REGISTRY['claude-opus-5']!,
      effectiveTo: '2099-01-01',
    };
    expect(isPriceExpired(valid, new Date('2026-10-07T00:00:00Z'))).toBe(false);
    expect(() => assertPricingCurrent('claude-opus-5')).not.toThrow();
  });
});

describe('alias resolution before pricing', () => {
  it('resolves a curated alias to its canonical model before any price lookup', () => {
    expect(normalizeModelOverride('anthropic:haiku')).toBe('haiku-4.5');
    expect(resolveCanonicalModelId('anthropic:haiku')).toBe('haiku-4.5');

    const canonical = resolveCanonicalModelId('anthropic:haiku')!;
    expect(getPricingForModel(canonical).isUnknown).toBeFalsy();
  });

  it('never substitutes a different family for an unknown manual selection', () => {
    expect(normalizeModelOverride('not-a-real-model')).toBeUndefined();
    expect(resolveCanonicalModelId('not-a-real-model')).toBeUndefined();
  });
});

describe('unavailable manual model rejection', () => {
  it('rejects a manual override whose provider is not ready (no silent re-route)', () => {
    const decision = determineRoute(baseParams(), 'opus-4.6', true);
    const result = normalizeDecisionAgainstProviderAvailability(
      decision,
      'opus-4.6',
      () => false,
    );
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Requested model');
  });
});

describe('modality compatibility (image/video-incompatible route rejection)', () => {
  it('rejects a text-only endpoint for an image request instead of downgrading', () => {
    expect(() => assertRouteSupportsModalities('deepseek-v4-flash', { hasImages: true }))
      .toThrow(ModalityMismatchError);

    const params = baseParams({
      userQuery: 'What is shown in this screenshot?',
      images: [{ data: 'fake-base64', mediaType: 'image/png' }],
    });
    expect(() => determineRoute(params, 'deepseek-v4-flash', true)).toThrow(ModalityMismatchError);
  });

  it('allows an image-capable endpoint for an image request', () => {
    expect(() => assertRouteSupportsModalities('gemini-3.7-flash', { hasImages: true }))
      .not.toThrow();
  });

  it('rejects video assets on a non-vision endpoint', () => {
    expect(() => assertRouteSupportsModalities('deepseek-v4-pro', { hasVideoAssets: true }))
      .toThrow(ModalityMismatchError);
  });
});

describe('catalog version parity and protocol qualification', () => {
  it('frontend and server catalog versions are identical', () => {
    expect(FRONTEND_PRICING_VERSION).toBe(SERVER_PRICING_VERSION);
  });

  it('every approved endpoint declares a supported protocol', () => {
    const allowed = new Set(['openai-responses', 'openai-chat', 'anthropic-messages', 'gemini']);
    for (const entry of approvedModels as CatalogEntry[]) {
      expect(allowed.has(entry.protocol), `${entry.id} protocol '${entry.protocol}'`).toBe(true);
    }
  });

  it('approved OpenCode endpoints match the runtime protocol and modality identity', () => {
    const approvedOpenCode = (approvedModels as CatalogEntry[]).filter(
      (entry) => entry.gateway === 'opencode' && entry.qualification === 'approved',
    );
    expect(approvedOpenCode.length).toBeGreaterThan(0);
    for (const entry of approvedOpenCode) {
      const runtime = CURATED_OPENCODE_REGISTRY[entry.id];
      expect(runtime, `${entry.id} missing from runtime curated registry`).toBeDefined();
      expect(runtime!.protocol).toBe(entry.protocol);
      expect(runtime!.supportsImages).toBe(entry.modalities.includes('image'));
    }
  });
});

describe('Auto never reaches privacy-unapproved endpoints', () => {
  it('every Auto candidate is an approved, non-training endpoint', () => {
    const candidates = Object.values(CURATED_ROUTE_POLICY).flatMap((policy) => [
      policy.primary,
      ...policy.fallback,
    ]);
    expect(candidates.length).toBeGreaterThan(0);

    for (const id of candidates) {
      expect(
        CURATED_OPENCODE_REGISTRY[id]?.isExperimentalFree,
        `${id} is experimental-free and must not be Auto-reachable`,
      ).toBeFalsy();

      const entry = approvedById.get(id);
      expect(entry, `${id} missing from approved-models.json`).toBeDefined();
      expect(entry!.qualification, `${id} qualification`).toBe('approved');
      expect(entry!.privacy.trainsOnData, `${id} trainsOnData`).toBe(false);
    }
  });

  it('free endpoints are catalogued as disabled with trainsOnData=true', () => {
    for (const id of ['deepseek-v4-flash-free', 'mimo-v2.5-free']) {
      const entry = approvedById.get(id);
      expect(entry, `${id} missing from approved-models.json`).toBeDefined();
      expect(entry!.qualification).toBe('disabled');
      expect(entry!.privacy.trainsOnData).toBe(true);
    }
  });
});

describe('verify-catalog drift gate', () => {
  it('passes on the committed catalog', () => {
    const result = verifyCatalog();
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('fails on an injected expired price (negative control)', () => {
    const drifted = structuredClone(prices) as Record<string, Record<string, unknown>>;
    drifted['claude-opus-5']!.effectiveTo = '2000-01-01';

    const result = verifyCatalog({ prices: drifted, today: '2026-10-07' });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toMatch(/expired/i);
  });

  it('fails on an injected unknown price field (negative control)', () => {
    const drifted = structuredClone(prices) as Record<string, Record<string, unknown>>;
    drifted['claude-opus-5']!.mysteryRate = '1.23';

    const result = verifyCatalog({ prices: drifted, today: '2026-10-07' });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toMatch(/unknown field/i);
  });

  it('fails when the server and frontend PRICING_VERSION drift (negative control)', () => {
    const result = verifyCatalog({
      frontendVersion: '2099-01-01-v1',
      frontendRegistry: FRONTEND_PRICING_REGISTRY,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toMatch(/PRICING_VERSION/);
  });

  it('fails when a shared rate drifts between the server and frontend mirrors (negative control)', () => {
    const drifted = structuredClone(FRONTEND_PRICING_REGISTRY) as unknown as Record<
      string,
      Record<string, unknown>
    >;
    drifted['claude-opus-5']!.inputRatePer1M = 99;

    const result = verifyCatalog({
      frontendRegistry: drifted as unknown as Record<string, ModelPricing>,
    });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toMatch(/inputRatePer1M/);
  });

  it('fails when a privacy-unapproved endpoint is reachable from Auto (negative control)', () => {
    const driftedPolicy = structuredClone(CURATED_ROUTE_POLICY);
    driftedPolicy.economy = { primary: 'deepseek-v4-flash-free', fallback: [] };

    const result = verifyCatalog({ autoPolicy: driftedPolicy });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toMatch(/deepseek-v4-flash-free/);
  });

  it('fails when an approved tariffKey does not resolve to a price (negative control)', () => {
    const drifted = structuredClone(approvedModels) as CatalogEntry[];
    const target = drifted.find((entry) => entry.id === 'claude-opus-5')!;
    target.tariffKey = '__px04-missing-tariff__';

    const result = verifyCatalog({ approved: drifted });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toMatch(/__px04-missing-tariff__/);
  });
});
