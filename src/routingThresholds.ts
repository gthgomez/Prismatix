/**
 * Score gates shown in the UI — matches semantic route roles in
 * `supabase/functions/router/models_hub.ts` and `router_logic.ts`.
 */

export const ROUTING_SCORE_GATES = {
  /** Economy cloud tier: score ≤ 45 */
  ECONOMY_MAX: 45,
  /** Balanced cloud tier: score 46–65 */
  BALANCED_MIN: 46,
  BALANCED_MAX: 65,
  /** Fast cloud tier: score 66–80 */
  FAST_MIN: 66,
  FAST_MAX: 80,
  /** Code-heavy review gate */
  CODE_STRONG_MIN: 70,
  /** Strong cloud tier: score ≥ 81 */
  STRONG_MIN: 81,
  /** Max frontier tier: reasoning ≥ 90 or ctx > 120k */
  MAX_REASONING_MIN: 90,
  MAX_CONTEXT_TOKEN_THRESHOLD: 120000,
  MAX_CONTEXT_REASONING_MIN: 70,
  /** Vision strong gate: complexity ≥ 75 */
  VISION_STRONG_MIN: 75,
} as const;

/** Implicit debate: second challenger when score ≥ this */
export const DEBATE_CHALLENGER_FULL_MIN_SCORE = 93;

/** One line: numeric gates for power users (wraps on narrow screens). */
export const ROUTING_SCORE_GATE_LEGEND =
  `Tiers: Economy≤${ROUTING_SCORE_GATES.ECONOMY_MAX} · ` +
  `Balanced ${ROUTING_SCORE_GATES.BALANCED_MIN}–${ROUTING_SCORE_GATES.BALANCED_MAX} · ` +
  `Fast ${ROUTING_SCORE_GATES.FAST_MIN}–${ROUTING_SCORE_GATES.FAST_MAX} · ` +
  `Strong text≥${ROUTING_SCORE_GATES.STRONG_MIN} or code≥${ROUTING_SCORE_GATES.CODE_STRONG_MIN} · ` +
  `Max reasoning≥${ROUTING_SCORE_GATES.MAX_REASONING_MIN} or ` +
  `(ctx>${ROUTING_SCORE_GATES.MAX_CONTEXT_TOKEN_THRESHOLD} & reasoning≥${ROUTING_SCORE_GATES.MAX_CONTEXT_REASONING_MIN}) · ` +
  `Vision Strong≥${ROUTING_SCORE_GATES.VISION_STRONG_MIN}.`;

/**
 * Hint for a complexity score displaying the semantic cloud tier.
 */
export function complexityScoreRoutingHint(score: number): string {
  const g = ROUTING_SCORE_GATES;
  if (score >= g.STRONG_MIN) {
    return `↳ Score ≥${g.STRONG_MIN}: STRONG / Code Review cloud tier (Max tier triggers on high reasoning/context).`;
  }
  if (score >= g.FAST_MIN && score <= g.FAST_MAX) {
    return `↳ Score ${g.FAST_MIN}–${g.FAST_MAX}: FAST cloud tier.`;
  }
  if (score >= g.BALANCED_MIN && score <= g.BALANCED_MAX) {
    return `↳ Score ${g.BALANCED_MIN}–${g.BALANCED_MAX}: BALANCED cloud tier.`;
  }
  if (score <= g.ECONOMY_MAX) {
    return `↳ Score ≤${g.ECONOMY_MAX}: ECONOMY cloud tier.`;
  }
  return `↳ Outside standard text bands; multimodal/vision rules apply.`;
}
