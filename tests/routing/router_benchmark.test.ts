// router_benchmark.test.ts
// Deterministic evaluation and calibration benchmark for Prismatix Auto routing.
// Validates role assignment, cost-quality monotonicity, execution latency,
// and safety containment across synthetic prompt categories.

import { describe, expect, it } from 'vitest';
import {
  CURATED_OPENCODE_REGISTRY,
  type RouteRole,
} from '../../supabase/functions/router/models_hub.ts';
import {
  determineRoute,
  determineRouteRole,
  type ImageAttachment,
  type RouterParams,
} from '../../supabase/functions/router/router_logic.ts';
import { resolveDebateChallengerCount } from '../../supabase/functions/router/debate_profiles.ts';
import { getPricingForModel } from '../../supabase/functions/router/pricing_registry.ts';

interface BenchmarkFixture {
  id: string;
  category:
    | 'factual_casual'
    | 'intermediate_explanatory'
    | 'code_review'
    | 'frontier_reasoning'
    | 'multimodal_vision'
    | 'long_context';
  params: RouterParams;
  expectedRoles: RouteRole[];
  expectedModelTiers: string[];
}

function makeParams(over: Partial<RouterParams>): RouterParams {
  return {
    userQuery: '',
    currentSessionTokens: 0,
    platform: 'web',
    history: [],
    ...over,
  };
}

const SAMPLE_IMAGE: ImageAttachment = {
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  mediaType: 'image/png',
};

const SONNET_V55 = ['claude', 'sonnet', '5-5'].join('-');

const FIXTURES: BenchmarkFixture[] = [
  // 1. Factual & Casual Queries (scores <= 45 or 46-65)
  {
    id: 'factual-math',
    category: 'factual_casual',
    params: makeParams({ userQuery: 'what is 2 + 2?' }),
    expectedRoles: ['economy', 'fast'],
    expectedModelTiers: ['gpt-6-luna', 'deepseek-v4-flash'],
  },
  {
    id: 'casual-greeting',
    params: makeParams({ userQuery: 'hello there, how are you today?' }),
    category: 'factual_casual',
    expectedRoles: ['economy', 'fast'],
    expectedModelTiers: ['gpt-6-luna', 'deepseek-v4-flash'],
  },
  {
    id: 'factual-trivia',
    category: 'factual_casual',
    params: makeParams({ userQuery: 'what is the capital of Australia?' }),
    expectedRoles: ['economy', 'fast'],
    expectedModelTiers: ['gpt-6-luna', 'deepseek-v4-flash'],
  },

  // 2. Intermediate / Explanatory Queries (scores 46-65 for fast, 66-80 for balanced)
  {
    id: 'explain-concepts-fast',
    category: 'intermediate_explanatory',
    params: makeParams({
      userQuery:
        'How and why do relational databases versus document stores handle distributed transactions differently? Compare and contrast their consistency, latency, and fault-tolerance trade-offs in depth.',
    }),
    expectedRoles: ['fast', 'balanced'],
    expectedModelTiers: ['gpt-6-luna', 'deepseek-v4-1-flash'],
  },
  {
    id: 'explain-architecture-balanced',
    category: 'intermediate_explanatory',
    params: makeParams({
      userQuery:
        'How, why, and in what scenarios would an enterprise organization migrate from a monolithic core banking architecture toward event-driven domain services? Please provide an in-depth comparative evaluation of the operational trade-offs, consistency guarantees, organizational readiness, and migration risks involved in this multi-year transition.',
    }),
    expectedRoles: ['balanced'],
    expectedModelTiers: ['deepseek-v4-1-flash'],
  },

  // 3. Code Heavy / Review Queries
  {
    id: 'code-review-typescript',
    category: 'code_review',
    params: makeParams({
      userQuery:
        '```typescript\nfunction processBatch(items: Item[]): Result {\n  for (const item of items) {\n    if (!item.valid) throw new Error("crash");\n  }\n  return { success: true };\n}\n```\nreview this code and optimize error handling and memory footprint in-depth',
    }),
    expectedRoles: ['code_review', 'strong'],
    expectedModelTiers: [SONNET_V55],
  },
  {
    id: 'code-debug-python',
    category: 'code_review',
    params: makeParams({
      userQuery:
        '```python\ndef recursive_worker(tree, depth=0):\n    if depth > 500:\n        raise RecursionError("overflow")\n    return [recursive_worker(c, depth+1) for c in tree.children]\n```\ndebug this exception, refactor to iterative traversal, and optimize',
    }),
    expectedRoles: ['code_review', 'strong'],
    expectedModelTiers: [SONNET_V55],
  },

  // 4. Frontier Reasoning / Max Queries
  {
    id: 'frontier-systems-design',
    category: 'frontier_reasoning',
    params: makeParams({
      userQuery:
        'analyze research comprehensive detailed analysis evaluate synthesize critique design architect strategy in-depth thorough explain why reasoning implications trade-offs debug this review this code optimize refactor',
    }),
    expectedRoles: ['max'],
    expectedModelTiers: ['gpt-6-sol'],
  },

  // 5. Multimodal / Vision Queries
  {
    id: 'vision-quick-screenshot',
    category: 'multimodal_vision',
    params: makeParams({
      userQuery: 'What is shown in this user interface wireframe?',
      images: [SAMPLE_IMAGE],
    }),
    expectedRoles: ['vision_fast', 'vision_strong'],
    expectedModelTiers: ['gemini-3.8-flash', SONNET_V55],
  },
  {
    id: 'vision-complex-diagram',
    category: 'multimodal_vision',
    params: makeParams({
      userQuery:
        'analyze research comprehensive detailed analysis evaluate synthesize critique design architect in-depth thorough explain why reasoning implications trade-offs',
      images: [SAMPLE_IMAGE],
    }),
    expectedRoles: ['vision_strong'],
    expectedModelTiers: [SONNET_V55],
  },

  // 6. Long-Context Queries
  {
    id: 'long-context-synthesis',
    category: 'long_context',
    params: makeParams({
      userQuery:
        'How and why did the consensus protocol choices evolve across the transcript? Compare and contrast the architecture trade-offs, explain why compromises were made, and synthesize the implications in depth.',
      currentSessionTokens: 130000,
    }),
    expectedRoles: ['max'],
    expectedModelTiers: ['gpt-6-sol'],
  },
];

describe('PX10: Synthetic Fixture Benchmark Suite for Auto Routing', () => {
  it('correctly classifies all fixtures into their target role domains', () => {
    for (const fixture of FIXTURES) {
      const role = determineRouteRole(fixture.params);
      expect(
        fixture.expectedRoles,
        `Fixture ${fixture.id} expected roles [${fixture.expectedRoles.join(', ')}] but got '${role}'`,
      ).toContain(role);
    }
  });

  it('routes each fixture to a valid, supported model in the curated registry', () => {
    for (const fixture of FIXTURES) {
      const decision = determineRoute(fixture.params, undefined, true);
      expect(
        fixture.expectedModelTiers,
        `Fixture ${fixture.id} routed to unexpected model '${decision.modelTier}'`,
      ).toContain(decision.modelTier);

      // Verify the model exists in the Curated OpenCode Registry
      const config = CURATED_OPENCODE_REGISTRY[decision.modelTier];
      expect(config).toBeDefined();
      expect(config?.gateway).toBe('opencode');
      expect(config?.isExperimentalFree).toBeFalsy();

      // Verify explanation metadata integrity
      expect(decision.explanation).toBeDefined();
      expect(decision.explanation?.priceKnown).toBe(true);
      expect(decision.explanation?.selection).toBe('auto');
    }
  });

  it('demonstrates monotonic rate basis progression across capability tiers', () => {
    const getAvgInputRate = (category: BenchmarkFixture['category']): number => {
      const matching = FIXTURES.filter((f) => f.category === category);
      if (matching.length === 0) return 0;
      const sum = matching.reduce((acc, f) => {
        const d = determineRoute(f.params, undefined, true);
        const pricing = getPricingForModel(d.modelTier);
        return acc + pricing.inputRatePer1M;
      }, 0);
      return sum / matching.length;
    };

    const factualRate = getAvgInputRate('factual_casual');
    const intermediateRate = getAvgInputRate('intermediate_explanatory');
    const codeRate = getAvgInputRate('code_review');
    const frontierRate = getAvgInputRate('frontier_reasoning');

    // Factual queries on economy/fast tier must be exceptionally inexpensive (<= $0.20/1M)
    expect(factualRate).toBeLessThanOrEqual(0.20);

    // Monotonic cost rate progression:
    // Factual ($0.10) < Intermediate ($0.20) < Code ($2.00) <= Frontier ($2.00)
    expect(factualRate).toBeLessThan(intermediateRate);
    expect(intermediateRate).toBeLessThan(codeRate);
    expect(codeRate).toBeLessThanOrEqual(frontierRate);
  });

  it('guarantees sub-millisecond routing execution overhead (no network delay in heuristics)', () => {
    const iterations = 500;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const fixture = FIXTURES[i % FIXTURES.length]!;
      determineRoute(fixture.params, undefined, true);
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / iterations;

    // Routing must execute under 0.5ms per decision on local test runner
    expect(avgMs).toBeLessThan(0.5);
  });

  it('qualifies debate mode containment: low/medium queries never trigger multi-challenger debate', () => {
    // Casual query should resolve to minimal challenger count
    const casualCount = resolveDebateChallengerCount('general', 30, 'what is 2 + 2?', false);
    expect(casualCount).toBe(1);

    // High complexity non-explicit query below 93 threshold should stay at 1
    const midCount = resolveDebateChallengerCount('general', 90, 'explain sorting algorithms', false);
    expect(midCount).toBe(1);

    // Only extreme complexity (>= 93) or explicit requests increase challengers
    const extremeCount = resolveDebateChallengerCount('general', 95, 'design distributed consensus', false);
    expect(extremeCount).toBe(2);

    const explicitCount = resolveDebateChallengerCount('general', 40, 'hello', true);
    expect(explicitCount).toBe(2);
  });
});
