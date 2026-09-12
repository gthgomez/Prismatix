// explainable_routing.test.ts
// Regression coverage for the explainable-routing & cost-safety campaign:
//  - Auto routes expose a UI-safe explanation derived from the real decision
//  - Unknown pricing can never auto-send (backend gate is authoritative)
//  - Discovery failure fails closed instead of silently escalating to an
//    expensive legacy direct-provider model
//  - Fallbacks remain deterministic and preserve explainability metadata
// All providers/discovery are mocked — no real credits are used.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CURATED_OPENCODE_REGISTRY,
  CURATED_ROUTE_POLICY,
  ModelUnavailableError,
  resolveRoleCandidates,
} from '../../supabase/functions/router/models_hub.ts';
import {
  determineRoute,
  type RouteExplanation,
  type RouterParams,
} from '../../supabase/functions/router/router_logic.ts';
import {
  calculatePreFlightCost,
  evaluateAutoSendSafety,
} from '../../supabase/functions/router/cost_engine.ts';
import {
  modelRateBasis,
  normalizeDecisionAgainstProviderAvailability,
  PROVIDER_UNAVAILABLE_FALLBACKS,
} from '../../supabase/functions/router/provider_availability.ts';
import { PRICING_REGISTRY } from '../../supabase/functions/router/pricing_registry.ts';

function baseParams(over: Partial<RouterParams> = {}): RouterParams {
  return {
    userQuery: 'what is 2 + 2?',
    currentSessionTokens: 0,
    platform: 'web',
    history: [],
    ...over,
  };
}

describe('explainable route contract', () => {
  it('successful known-price Auto route carries a complete explanation', () => {
    const decision = determineRoute(baseParams(), undefined, true);

    expect(decision.modelTier).toBe('deepseek-v4-flash');
    expect(decision.explanation).toBeDefined();
    const e = decision.explanation as RouteExplanation;
    expect(e.selection).toBe('auto');
    expect(e.role).toBe('economy');
    expect(e.gateway).toBe('opencode');
    expect(e.priceKnown).toBe(true);
    expect(e.fallbackUsed).toBe(false);
    expect(e.reason).toContain('economy');
    expect(e.attemptedModels).toEqual([]);
    // No secrets or internals leak into the explanation
    expect(JSON.stringify(e)).not.toMatch(/key|token|authorization|bearer/i);
  });

  it('override decisions explain the manual selection and skip role semantics', () => {
    const decision = determineRoute(baseParams(), 'gpt-5.6-sol', true);

    expect(decision.rationaleTag).toBe('manual-override');
    expect(decision.routeRole).toBeUndefined();
    const e = decision.explanation as RouteExplanation;
    expect(e.selection).toBe('override');
    expect(e.modelTier).toBe('gpt-5.6-sol');
    expect(e.priceKnown).toBe(true);
    expect(e.fallbackUsed).toBe(false);
    expect(e.reason).toContain('Manually selected');
  });
});

describe('cost safety: unknown price cannot auto-send', () => {
  const flashEntry = CURATED_OPENCODE_REGISTRY['deepseek-v4-flash']!;
  const originalFlashPricing = flashEntry.pricing!;

  beforeEach(() => {
    flashEntry.pricing = {
      ...originalFlashPricing,
      isUnknown: true,
    };
  });

  afterEach(() => {
    flashEntry.pricing = originalFlashPricing;
  });

  it('resolveRoleCandidates skips unknown-priced candidates and reports why', () => {
    const allIds = new Set(Object.keys(CURATED_OPENCODE_REGISTRY));
    const resolution = resolveRoleCandidates('economy', allIds);

    // Primary deepseek-v4-flash is unknown-priced in this fixture -> skipped
    expect(resolution.config.modelId).toBe('gpt-5.6-luna');
    expect(resolution.attempted).toContainEqual({
      modelId: 'deepseek-v4-flash',
      reason: 'pricing-unknown',
    });
  });

  it('fully unpriced role resolution fails closed instead of guessing', () => {
    expect(() => resolveRoleCandidates('economy', new Set(['deepseek-v4-flash'])))
      .toThrow(ModelUnavailableError);
  });

  it('backend pre-flight marks unknown rates and estimates $0 (never a fake price)', () => {
    const result = calculatePreFlightCost('unregistered-mystery-model', 'hello world', 0);
    expect(result.hasUnknownRate).toBe(true);
    expect(result.estimatedUsd).toBe(0);
  });

  it('evaluateAutoSendSafety blocks unknown-priced models for auto AND explicit selection', () => {
    const auto = evaluateAutoSendSafety({
      isAuto: true,
      modelTier: 'unregistered-mystery-model',
      hasUnknownRate: true,
    });
    expect(auto.allowed).toBe(false);
    expect(auto.reason).toBe('unknown_pricing');

    const explicit = evaluateAutoSendSafety({
      isAuto: false,
      modelTier: 'unregistered-mystery-model',
      hasUnknownRate: true,
    });
    expect(explicit.allowed).toBe(false);
    expect(explicit.reason).toBe('unknown_pricing');
  });

  it('evaluateAutoSendSafety blocks auto-ineligible models (free tier) only for Auto', () => {
    const auto = evaluateAutoSendSafety({
      isAuto: true,
      modelTier: 'deepseek-v4-flash-free',
      hasUnknownRate: false,
    });
    expect(auto.allowed).toBe(false);
    expect(auto.reason).toBe('auto_not_eligible');

    const explicit = evaluateAutoSendSafety({
      isAuto: false,
      modelTier: 'deepseek-v4-flash-free',
      hasUnknownRate: false,
    });
    expect(explicit.allowed).toBe(true);
  });

  it('known-price explicit selection passes the safety gate', () => {
    const decision = evaluateAutoSendSafety({
      isAuto: false,
      modelTier: 'claude-opus-5',
      hasUnknownRate: false,
    });
    expect(decision.allowed).toBe(true);
  });
});

describe('discovery failure fails closed (no expensive silent fallback)', () => {
  it('curated resolution failure with OpenCode primary propagates instead of routing legacy', () => {
    // Empty discovery + primary configured: the pre-campaign behavior silently
    // routed max-complexity asks to direct Anthropic opus-4.6 ($15/$75 per 1M).
    const maxParams = baseParams({
      userQuery:
        'analyze research comprehensive detailed analysis evaluate synthesize critique design architect strategy in-depth thorough explain why reasoning implications trade-offs debug this review this code optimize refactor',
    });

    expect(() => determineRoute(maxParams, undefined, true, new Set(['unrelated-model'])))
      .toThrow(ModelUnavailableError);
  });

  it('legacy direct mode remains available only as an explicit deployment posture', () => {
    const decision = determineRoute(baseParams(), undefined, false);

    expect(decision.modelTier).toBe('qwen3-235b');
    const e = decision.explanation as RouteExplanation;
    expect(e.selection).toBe('auto');
    expect(e.gateway).toBe('direct_fallback');
    expect(e.fallbackUsed).toBe(true);
    expect(e.priceKnown).toBe(true);
  });

  it('every legacy direct model referenced by the fallback chain is priced', () => {
    for (const tier of ['gemini-3.1-pro', 'gemini-2.5-flash', 'opus-4.6', 'sonnet-4.6', 'deepseek-v3', 'qwen3-235b']) {
      const entry = PRICING_REGISTRY[tier];
      expect(entry, `legacy model ${tier} must have a pricing entry`).toBeDefined();
      expect(entry!.isUnknown).toBeFalsy();
    }
  });
});

describe('fallback chains preserve explainability', () => {
  it('role fallback records the skipped primary and the fallbackUsed flag', () => {
    // 'fast' primary is gpt-5.6-luna; only gemini-3.7-flash is discovered.
    const discovered = new Set(['gemini-3.7-flash']);
    const resolution = resolveRoleCandidates('fast', discovered);

    expect(resolution.config.modelId).toBe('gemini-3.7-flash');
    expect(resolution.attempted).toContainEqual({
      modelId: 'gpt-5.6-luna',
      reason: 'not-discovered',
    });

    // vision_fast primary is gemini-3.7-flash; discovery only has gpt-5.6-luna.
    const visionDiscovered = new Set(['gpt-5.6-luna']);
    const decision = determineRoute(
      baseParams({
        userQuery: 'What is shown in this screenshot?',
        images: [{ data: 'fake-base64-bytes', mediaType: 'image/png' }],
      }),
      undefined,
      true,
      visionDiscovered,
    );
    expect(decision.modelTier).toBe('gpt-5.6-luna');
    const e = decision.explanation as RouteExplanation;
    expect(e.fallbackUsed).toBe(true);
    expect(e.attemptedModels).toBeDefined();
    expect(e.attemptedModels?.some((m) => m.startsWith('gemini-3.7-flash:'))).toBe(true);
  });
});

describe('provider-unavailable fallback cost guard', () => {
  const fixtureDecision = (
    modelTier: string,
    provider: 'deepinfra' | 'nvidia' | 'google' | 'anthropic',
  ): ReturnType<typeof determineRoute> => ({
    provider,
    model: modelTier,
    modelTier,
    budgetCap: 8192,
    rationaleTag: 'test-fixture',
    complexityScore: 10,
    routingDebug: {
      complexityScore: 10,
      reasoningDifficulty: 10,
      codeSignals: 0,
      isCodeHeavy: false,
      multimodalLoad: 0,
      contextTokens: 0,
      textQueryTokens: 0,
      imageAttachmentCount: 0,
      hasImages: false,
      hasVideoAssets: false,
      routeStep: 'test',
    },
  });

  const readyOnly = (...providers: string[]) => (p: string) => providers.includes(p);

  it('fallback candidate more expensive than the decided model is rejected', () => {
    // Decided economy qwen3-235b (basis 0.25, deepinfra unavailable).
    // gemini-2.5-flash (0.375), gpt-5.4-mini (0.75) and sonnet-4.6 (18) are
    // all more expensive -> fail closed rather than silently escalate spend.
    const decision = fixtureDecision('qwen3-235b', 'deepinfra');
    const result = normalizeDecisionAgainstProviderAvailability(
      decision,
      undefined,
      readyOnly('google', 'openai', 'anthropic'),
    );

    expect(result.error).toBeDefined();
    expect(result.error).toContain('failed closed');
  });

  it('cheaper priced fallback is allowed and fully explained', () => {
    // Decided max opus-4.6 (basis 90, anthropic unavailable).
    // gemini-2.5-flash (0.375) is cheaper and priced -> allowed.
    const decision = fixtureDecision('opus-4.6', 'anthropic');
    const result = normalizeDecisionAgainstProviderAvailability(
      decision,
      undefined,
      readyOnly('google', 'openai', 'deepinfra'),
    );

    expect(result.error).toBeUndefined();
    expect(result.decision.modelTier).toBe('gemini-2.5-flash');
    const e = result.decision.explanation as RouteExplanation;
    expect(e.fallbackUsed).toBe(true);
    expect(e.attemptedModels?.[0]).toBe('opus-4.6: provider-unavailable');
    expect(e.reason).toContain('unavailable');
  });

  it('no ready provider at all fails closed', () => {
    const decision = fixtureDecision('qwen3-235b', 'deepinfra');
    const result = normalizeDecisionAgainstProviderAvailability(
      decision,
      undefined,
      readyOnly(),
    );
    expect(result.error).toBeDefined();
  });

  it('override with unavailable provider never re-routes', () => {
    const decision = fixtureDecision('qwen3-235b', 'deepinfra');
    const result = normalizeDecisionAgainstProviderAvailability(
      decision,
      'qwen3-235b',
      readyOnly('google'),
    );
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Requested model');
  });

  it('fallback order is deterministic and every entry is priced', () => {
    expect(PROVIDER_UNAVAILABLE_FALLBACKS).toEqual([
      'gemini-2.5-flash',
      'gpt-5.4-mini',
      'sonnet-4.6',
    ]);
    for (const tier of PROVIDER_UNAVAILABLE_FALLBACKS) {
      expect(Number.isFinite(modelRateBasis(tier)), `${tier} basis must be finite`).toBe(true);
    }
  });
});

describe('curated policy integrity', () => {
  it('every policy candidate exists in the curated registry', () => {
    for (const [role, policy] of Object.entries(CURATED_ROUTE_POLICY)) {
      for (const modelId of [policy.primary, ...policy.fallback]) {
        expect(
          CURATED_OPENCODE_REGISTRY[modelId],
          `role '${role}' references unknown model '${modelId}'`,
        ).toBeDefined();
      }
    }
  });
});
