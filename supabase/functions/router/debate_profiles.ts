// debate_profiles.ts
// Debate Mode is a router "tool": run 1-2 challenger critiques, then ask the primary model to synthesize.
// This file contains ONLY config + pure helpers (no fetch side effects).

import type { RouterModel } from './router_logic.ts';

export type DebateProfile = 'general' | 'code' | 'video_ui';
export type DebateTrigger = 'off' | 'explicit' | 'auto';

export interface DebatePlan {
  profile: DebateProfile;
  challengers: Array<{ role: string; modelTier: RouterModel }>;
  maxChallengerChars: number;
}

export const DEFAULT_DEBATE_THRESHOLD = 85;

/**
 * Role-aware fallback cascades for debate challengers (cheapest-first within role class).
 *
 * General/skeptic/architect roles: prefer diverse reasoning models.
 * Code roles: prefer models with strong code critique / structured output ability.
 * Each cascade is tried in order when the assigned model fails or is unavailable.
 *
 * Blended $/1M (3:1 in:out ratio) as of 2026-04-13:
 *   llama-3.3-70b-turbo: $0.012in / $0.03out  → ~$0.02 blended
 *   nemotron-3-super:    $0.10in  / $0.50out  → ~$0.20 blended
 *   mistral-small-24b:   $0.04in  / $0.08out  → ~$0.05 blended
 *   qwen3-32b:           $0.07in  / $0.28out  → ~$0.12 blended
 *   deepseek-v3:         $0.22in  / $0.89out  → ~$0.39 blended
 *   gemini-3-flash:      $0.50in  / $3.00out  → ~$1.13 blended
 *   gpt-5.4-mini:        $0.75in  / $4.50out  → ~$1.69 blended
 */
export const GENERAL_CHALLENGER_FALLBACKS: RouterModel[] = [
  'nemotron-3-super',      // strong general reasoning, very cheap
  'llama-3.3-70b-turbo',   // fast, solid general baseline
  'qwen3-32b',             // alternative framing tendency
  'gemini-3-flash',        // reliable, slightly higher cost
  'gpt-5.4-mini',          // last resort
];

export const CODE_CHALLENGER_FALLBACKS: RouterModel[] = [
  'gpt-5.4-mini',          // best code critique at this price tier
  'deepseek-v3',           // strong structured code reasoning
  'haiku-4.5',             // cheap Anthropic code baseline
  'gemini-3-flash',        // fallback
];

/** @deprecated use GENERAL_CHALLENGER_FALLBACKS or CODE_CHALLENGER_FALLBACKS */
export const DEBATE_COST_CASCADE: RouterModel[] = GENERAL_CHALLENGER_FALLBACKS;

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function uniqChallengers(
  arr: Array<{ role: string; modelTier: RouterModel }>,
): Array<{ role: string; modelTier: RouterModel }> {
  const seen = new Set<string>();
  const out: Array<{ role: string; modelTier: RouterModel }> = [];
  for (const c of arr) {
    const key = `${c.role}::${c.modelTier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

const HIGH_RISK_CODE_PATTERN =
  /\b(auth|password|token|secret|api.?key|billing|payment|sql|inject|xss|rce|exploit|privilege|sanitize|encrypt|hash|csrf|cors|rbac|permission|credential)\b/i;

/**
 * Determines how many challengers to run based on complexity score and query risk.
 *
 * video_ui is always fixed at 3 (multi-persona by design).
 * code forces 2 when high-risk keywords are detected regardless of complexity.
 * general/code use 1 challenger for moderate complexity (85–92) and 2 for high (93+),
 * but explicit debate requests always get the full set unless score is low.
 */
export function resolveDebateChallengerCount(
  profile: DebateProfile,
  complexityScore: number,
  userQuery: string,
  debateWasExplicit: boolean,
): 1 | 2 | 3 {
  if (profile === 'video_ui') return 3;

  if (profile === 'code' && HIGH_RISK_CODE_PATTERN.test(userQuery)) return 2;

  // Auto-triggered debate at moderate complexity: single challenger to save cost
  if (!debateWasExplicit && complexityScore < 93) return 1;

  // Explicit debate or very high complexity: full set
  return 2;
}

/**
 * Choose challengers based on profile + primary model.
 * Goal: keep it cheap + diverse, but never require frontend RouterModel changes.
 */
export function getDebatePlan(
  profile: DebateProfile,
  primary: RouterModel,
  challengerCount: 1 | 2 | 3 = 2,
): DebatePlan {
  // Keep challengers bounded for cost/perf.
  // NOTE: All tiers must exist in MODEL_REGISTRY; do not invent keys here.
  const base = profile === 'code'
    ? [
        { role: 'critic', modelTier: 'gpt-5.4-mini' as RouterModel },
        { role: 'implementer', modelTier: 'haiku-4.5' as RouterModel },
      ]
    : profile === 'video_ui'
    ? [
        { role: 'UI Designer Critic', modelTier: 'gemini-3.1-pro' as RouterModel },
        { role: 'Product QA / UX Researcher', modelTier: 'gemini-3.1-pro' as RouterModel },
        { role: 'Customer Persona', modelTier: 'gemini-3.1-pro' as RouterModel },
      ]
    : [
        { role: 'skeptic', modelTier: 'gpt-5.4-mini' as RouterModel },
        { role: 'alternative architect', modelTier: 'gemini-3-flash' as RouterModel },
      ];

  const filtered = profile === 'video_ui'
    ? base
    : base.filter((c) => c.modelTier !== primary);
  const challengers = uniq(uniqChallengers(filtered)).slice(0, challengerCount);

  return {
    profile,
    challengers,
    // Keep worker outputs bounded so synthesis prompt doesn't explode.
    maxChallengerChars: profile === 'code' ? 2400 : profile === 'video_ui' ? 1800 : 2000,
  };
}
