import { describe, it, expect } from 'vitest';
import {
  resolveModelForRole,
  CURATED_OPENCODE_REGISTRY,
  CURATED_ROUTE_POLICY,
  EXPERIMENTAL_FREE_POLICY,
  ModelUnavailableError,
} from '../../supabase/functions/router/models_hub';
import {
  determineRouteRole,
  RouterParams,
} from '../../supabase/functions/router/router_logic';
import {
  getPricingForModel,
  calculateEstimatedCostUsd,
} from '../../supabase/functions/router/pricing_registry';

describe('OpenCode Model Hub & Semantic Routing Migration', () => {
  describe('Semantic Role Resolution & Privacy Invariants', () => {
    it('resolves primary paid model for every curated role when all models are available', () => {
      const allIds = new Set(Object.keys(CURATED_OPENCODE_REGISTRY));

      expect(resolveModelForRole('economy', allIds).modelId).toBe('deepseek-v4-flash');
      expect(resolveModelForRole('fast', allIds).modelId).toBe('gpt-5.6-luna');
      expect(resolveModelForRole('balanced', allIds).modelId).toBe('deepseek-v4-pro');
      expect(resolveModelForRole('strong', allIds).modelId).toBe('claude-sonnet-5');
      expect(resolveModelForRole('max', allIds).modelId).toBe('gpt-5.6-sol');
      expect(resolveModelForRole('vision_fast', allIds).modelId).toBe('gemini-3.7-flash');
      expect(resolveModelForRole('code_review', allIds).modelId).toBe('claude-sonnet-5');
      expect(resolveModelForRole('cheap_critic', allIds).modelId).toBe('deepseek-v4-flash');
    });

    it('NEVER silently falls back to a free/data-training endpoint in production auto-routing', () => {
      for (const [role, policy] of Object.entries(CURATED_ROUTE_POLICY)) {
        const allCandidates = [policy.primary, ...policy.fallback];
        for (const modelId of allCandidates) {
          const config = CURATED_OPENCODE_REGISTRY[modelId];
          expect(
            config?.isExperimentalFree,
            `Role '${role}' MUST NOT contain free model '${modelId}' in production policy`,
          ).toBeFalsy();
        }
      }
    });

    it('quarantines free models into EXPERIMENTAL_FREE_POLICY only', () => {
      expect(EXPERIMENTAL_FREE_POLICY['fast-free']).toBe('deepseek-v4-flash-free');
      expect(EXPERIMENTAL_FREE_POLICY['mimo-free']).toBe('mimo-v2.5-free');
    });

    it('falls back to configured backup if primary is unavailable in discovery', () => {
      // Primary 'gpt-5.6-luna' is missing for 'fast', should fall back to 'gemini-3.7-flash'
      const subsetIds = new Set(['gemini-3.7-flash', 'claude-sonnet-5']);
      const resolved = resolveModelForRole('fast', subsetIds);
      expect(resolved.modelId).toBe('gemini-3.7-flash');
    });

    it('fails closed when no configured models for a role exist in discovery', () => {
      const disjointIds = new Set(['some-unrelated-model']);
      expect(() => resolveModelForRole('max', disjointIds)).toThrow(ModelUnavailableError);
    });

    it('does NOT automatically route to an un-curated discovered model', () => {
      const discoveredIds = new Set(['new-random-untrusted-model-999']);
      expect(() => resolveModelForRole('economy', discoveredIds)).toThrow(ModelUnavailableError);
    });
  });

  describe('Routing Decision to Semantic Roles', () => {
    const baseParams: RouterParams = {
      userQuery: 'hello',
      currentSessionTokens: 0,
      platform: 'mobile',
      history: [],
    };

    it('maps simple queries to economy role', () => {
      const role = determineRouteRole({
        ...baseParams,
        userQuery: 'what is 2 + 2?',
      });
      expect(role).toBe('economy');
    });

    it('maps heavy code queries to code_review role', () => {
      const role = determineRouteRole({
        ...baseParams,
        userQuery: '```typescript\nfunction debugThisBug(x: number) {\n  throw new Error("crash");\n}\n```\nreview this code and optimize performance in-depth',
      });
      expect(['code_review', 'strong']).toContain(role);
    });

    it('maps images to vision_fast or vision_strong role', () => {
      const roleFast = determineRouteRole({
        ...baseParams,
        userQuery: 'what is in this photo?',
        images: [{ data: 'base64', mediaType: 'image/jpeg' }],
      });
      expect(roleFast).toBe('vision_fast');

      const maxKw =
        'analyze research comprehensive detailed analysis evaluate synthesize critique design architect strategy in-depth thorough explain why reasoning implications trade-offs debug this review this code optimize refactor';
      const roleStrong = determineRouteRole({
        ...baseParams,
        userQuery: maxKw,
        images: [{ data: 'base64', mediaType: 'image/jpeg' }],
      });
      expect(roleStrong).toBe('vision_strong');
    });

    it('maps frontier complex queries to max role', () => {
      const maxKw =
        'analyze research comprehensive detailed analysis evaluate synthesize critique design architect strategy in-depth thorough explain why reasoning implications trade-offs debug this review this code optimize refactor';
      const role = determineRouteRole({
        ...baseParams,
        userQuery: maxKw,
      });
      expect(role).toBe('max');
    });
  });

  describe('Pricing Registry & Fail-Closed Spend Policy', () => {
    it('accurately prices curated OpenCode models with modern Zen rates', () => {
      const ds = getPricingForModel('deepseek-v4-flash');
      expect(ds.inputRatePer1M).toBe(0.14);
      expect(ds.outputRatePer1M).toBe(0.28);
      expect(ds.isEligibleForAutoRouting).toBe(true);

      const luna = getPricingForModel('gpt-5.6-luna');
      expect(luna.inputRatePer1M).toBe(0.20);
      expect(luna.outputRatePer1M).toBe(1.20);

      const haiku = getPricingForModel('claude-haiku-4-5');
      expect(haiku.inputRatePer1M).toBe(1.00);
      expect(haiku.outputRatePer1M).toBe(5.00);

      const sol = getPricingForModel('gpt-5.6-sol');
      expect(sol.inputRatePer1M).toBe(5.00);
      expect(sol.outputRatePer1M).toBe(30.00);
      expect(sol.longContextThreshold).toBe(272000);

      // Base context calculation
      const costBase = calculateEstimatedCostUsd('gpt-5.6-sol', 1000, 500, 1000);
      expect(costBase.isLongContext).toBe(false);
      expect(costBase.costUsd).toBeCloseTo(0.02, 5);

      // Long context threshold calculation (> 272k tokens): 300k * $10/M + 1k * $45/M = $3.045
      const costLong = calculateEstimatedCostUsd('gpt-5.6-sol', 300000, 1000, 300000);
      expect(costLong.isLongContext).toBe(true);
      expect(costLong.costUsd).toBeCloseTo(3.045, 3);

      // Grok 4.6 tiered cache reads: base cached read ($0.50/M) vs long-context cached read ($1.00/M)
      const grokBase = calculateEstimatedCostUsd('grok-4.6', 10000, 1000, 10000, 8000);
      // (2k * $2.00/M) + (1k * $6.00/M) + (8k * $0.50/M) = $0.004 + $0.006 + $0.004 = $0.014
      expect(grokBase.costUsd).toBeCloseTo(0.014, 5);

      const grokLong = calculateEstimatedCostUsd('grok-4.6', 250000, 2000, 250000, 200000);
      // (50k * $4.00/M) + (2k * $12.00/M) + (200k * $1.00/M) = $0.20 + $0.024 + $0.20 = $0.424
      expect(grokLong.isLongContext).toBe(true);
      expect(grokLong.costUsd).toBeCloseTo(0.424, 4);
    });

    it('forbids automatic routing for unknown models (fails closed)', () => {
      const unknown = getPricingForModel('unregistered-mystery-model');
      expect(unknown.isUnknown).toBe(true);
      expect(unknown.isEligibleForAutoRouting).toBe(false);

      const cost = calculateEstimatedCostUsd('unregistered-mystery-model', 1000, 500);
      expect(cost.costUsd).toBeNull();
      expect(cost.isUnknown).toBe(true);
      expect(cost.eligibleForAutoRoute).toBe(false);
    });
  });
});
