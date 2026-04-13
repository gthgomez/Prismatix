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
 * General cascade: cheap DeepInfra models first, escalate only when needed.
 * Code critic cascade: starts cheap (GLM), escalates to DeepSeek for serious critique.
 * Code implementer cascade: Step-3.5-Flash first (agentic), then ultra-cheap floor.
 *
 * Blended $/1M (3:1 in:out ratio) as of 2026-04-13:
 *   qwen3.5-4b:          $0.03in  / $0.15out  → ~$0.06 blended
 *   llama-3.1-8b-turbo:  $0.02in  / $0.03out  → ~$0.02 blended
 *   mistral-nemo:        $0.02in  / $0.04out  → ~$0.03 blended
 *   glm-4.7-flash:       $0.06in  / $0.40out  → ~$0.15 blended
 *   qwen3.5-9b:          $0.04in  / $0.20out  → ~$0.08 blended
 *   nemotron-nano-30b:   $0.10in  / $0.16out  → ~$0.11 blended
 *   llama-3.3-70b-turbo: $0.012in / $0.03out  → ~$0.02 blended
 *   qwen3-32b:           $0.07in  / $0.28out  → ~$0.12 blended
 *   step-3.5-flash:      $0.10in  / $0.30out  → ~$0.15 blended
 *   deepseek-v3:         $0.22in  / $0.89out  → ~$0.39 blended
 *   nemotron-3-super:    $0.10in  / $0.50out  → ~$0.20 blended
 */
export const GENERAL_CHALLENGER_FALLBACKS: RouterModel[] = [
  'qwen3.5-4b',            // ultra-cheap, good alternative framing
  'glm-4.7-flash',         // cheap skeptical challenger
  'qwen3.5-9b',            // stronger cheap option
  'llama-3.1-8b-turbo',    // absolute floor fallback
  'llama-3.3-70b-turbo',   // mid-tier sturdy fallback
  'nemotron-3-super',      // stronger agentic reasoning if needed
];

export const CODE_CRITIC_FALLBACKS: RouterModel[] = [
  'glm-4.7-flash',         // cheap first-pass critic
  'deepseek-v3',           // strong open-weight code critic
  'qwen3-32b',             // mid-band open alternative
  'step-3.5-flash',        // agentic + code-aware
  'llama-3.3-70b-turbo',   // sturdy 70B fallback
];

export const CODE_IMPLEMENTER_FALLBACKS: RouterModel[] = [
  'step-3.5-flash',        // agentic, SWE-bench strong
  'mistral-nemo',          // ultra-cheap implementer
  'llama-3.1-8b-turbo',    // absolute floor fallback
  'qwen3.5-9b',            // cheap structured alternative
];

/** @deprecated use profile-specific cascade constants */
export const DEBATE_COST_CASCADE: RouterModel[] = GENERAL_CHALLENGER_FALLBACKS;
// Alias kept for any external references
export const CODE_CHALLENGER_FALLBACKS: RouterModel[] = CODE_CRITIC_FALLBACKS;

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
        { role: 'critic', modelTier: 'deepseek-v3' as RouterModel },
        { role: 'implementer', modelTier: 'step-3.5-flash' as RouterModel },
      ]
    : profile === 'video_ui'
    ? [
        { role: 'UI Designer Critic', modelTier: 'gemini-3.1-pro' as RouterModel },
        { role: 'Product QA / UX Researcher', modelTier: 'gemini-3.1-pro' as RouterModel },
        { role: 'Customer Persona', modelTier: 'gemini-3.1-pro' as RouterModel },
      ]
    : [
        { role: 'skeptic', modelTier: 'glm-4.7-flash' as RouterModel },
        { role: 'alternative architect', modelTier: 'qwen3.5-4b' as RouterModel },
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
