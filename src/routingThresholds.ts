/**
 * Score gates shown in the UI — MUST match
 * `supabase/functions/router/router_logic.ts` (`determineRoute`, `analyzeRouting` bands)
 * and `debate_profiles.ts` (`resolveDebateChallengerCount`).
 *
 * Token ceilings (mini / Haiku caps) exist only in the router; hints mention them in the legend.
 */

export const ROUTING_SCORE_GATES = {
  /** Text path: `gpt-5.4-mini` when score ≤ this (plus token caps). */
  GPT_MINI_MAX: 18,
  /** Text path: `haiku-4.5` when score ≤ this (plus token caps). */
  HAIKU_MAX: 28,
  /** Text path: `qwen3-235b` when score in [29, ROUTE_QWEN_MAX]. */
  ROUTE_QWEN_MIN: 29,
  ROUTE_QWEN_MAX: 45,
  /** Text path: `deepseek-v3` when score in [46, ROUTE_DEEPSEEK_MAX] (and code-mid branch). */
  ROUTE_DEEPSEEK_MIN: 46,
  ROUTE_DEEPSEEK_MAX: 65,
  /** Text path: `gemini-2.5-flash` band. */
  ROUTE_FLASH_MIN: 66,
  ROUTE_FLASH_MAX: 80,
  /** Code-heavy: `sonnet-4.6` when score ≥ this (after Opus gate). */
  CODE_SONNET_MIN: 75,
  /** Text-only: `sonnet-4.6` when score ≥ this (no images / video). */
  SONNET_TEXT_MIN: 81,
  /** Opus: `reasoningDifficulty` ≥ this. */
  OPUS_REASONING_MIN: 90,
  /** Opus: `contextTokens` > this with `reasoningDifficulty` ≥ OPUS_CONTEXT_REASONING_MIN. */
  OPUS_CONTEXT_TOKEN_THRESHOLD: 120000,
  OPUS_CONTEXT_REASONING_MIN: 70,
  /** Images: `gemini-3.1-pro` when complexity ≥ this. */
  IMAGES_PRO_MIN: 75,
  /** Mid-level code → DeepSeek when code-heavy and score < this (and ≥ ROUTE_QWEN_MIN). */
  CODE_MID_DEEPSEEK_MAX_EXCLUSIVE: 70,
} as const;

/** Implicit debate: second challenger when score ≥ this (`debate_profiles.ts`). */
export const DEBATE_CHALLENGER_FULL_MIN_SCORE = 93;

/** One line: numeric gates for power users (wraps on narrow screens). */
export const ROUTING_SCORE_GATE_LEGEND =
  `Bands: mini≤${ROUTING_SCORE_GATES.GPT_MINI_MAX} · Haiku≤${ROUTING_SCORE_GATES.HAIKU_MAX} · ` +
  `Qwen ${ROUTING_SCORE_GATES.ROUTE_QWEN_MIN}–${ROUTING_SCORE_GATES.ROUTE_QWEN_MAX} · ` +
  `DeepSeek ${ROUTING_SCORE_GATES.ROUTE_DEEPSEEK_MIN}–${ROUTING_SCORE_GATES.ROUTE_DEEPSEEK_MAX} ` +
  `(+ code ${ROUTING_SCORE_GATES.ROUTE_QWEN_MIN}–${ROUTING_SCORE_GATES.CODE_MID_DEEPSEEK_MAX_EXCLUSIVE - 1}) · ` +
  `Flash ${ROUTING_SCORE_GATES.ROUTE_FLASH_MIN}–${ROUTING_SCORE_GATES.ROUTE_FLASH_MAX} · ` +
  `Sonnet code≥${ROUTING_SCORE_GATES.CODE_SONNET_MIN} or text≥${ROUTING_SCORE_GATES.SONNET_TEXT_MIN} · ` +
  `Opus reasoning≥${ROUTING_SCORE_GATES.OPUS_REASONING_MIN} or ` +
  `(ctx>${ROUTING_SCORE_GATES.OPUS_CONTEXT_TOKEN_THRESHOLD} & reasoning≥${ROUTING_SCORE_GATES.OPUS_CONTEXT_REASONING_MIN}) · ` +
  `images Pro≥${ROUTING_SCORE_GATES.IMAGES_PRO_MIN} · ` +
  `debate +2 ≥${DEBATE_CHALLENGER_FULL_MIN_SCORE}.`;

/**
 * Hint for a **complexity score** (UI slider / post-hoc). Text-path bands only;
 * Opus uses `reasoningDifficulty` in the router — legend covers the full rule.
 */
export function complexityScoreRoutingHint(score: number): string {
  const g = ROUTING_SCORE_GATES;
  if (score >= g.SONNET_TEXT_MIN) {
    return `↳ Score ≥${g.SONNET_TEXT_MIN}: Sonnet tier on text (or code≥${g.CODE_SONNET_MIN}); Opus uses reasoning/context gates from legend.`;
  }
  if (score <= g.GPT_MINI_MAX) {
    return `↳ Score ≤${g.GPT_MINI_MAX}: GPT mini band (token caps apply).`;
  }
  if (score <= g.HAIKU_MAX) {
    return `↳ Scores ${g.GPT_MINI_MAX + 1}–${g.HAIKU_MAX}: Haiku band (token caps apply).`;
  }
  if (score >= g.ROUTE_DEEPSEEK_MIN && score <= g.ROUTE_DEEPSEEK_MAX) {
    return `↳ Scores ${g.ROUTE_DEEPSEEK_MIN}–${g.ROUTE_DEEPSEEK_MAX}: DeepSeek band (code-heavy ${g.ROUTE_QWEN_MIN}–${g.CODE_MID_DEEPSEEK_MAX_EXCLUSIVE - 1} uses DeepSeek earlier).`;
  }
  if (score >= g.ROUTE_QWEN_MIN && score <= g.ROUTE_QWEN_MAX) {
    return `↳ Scores ${g.ROUTE_QWEN_MIN}–${g.ROUTE_QWEN_MAX}: Qwen3-235B band (non-code-heavy).`;
  }
  if (score >= g.ROUTE_FLASH_MIN && score <= g.ROUTE_FLASH_MAX) {
    return `↳ Scores ${g.ROUTE_FLASH_MIN}–${g.ROUTE_FLASH_MAX}: Gemini 2.5 Flash band.`;
  }
  return `↳ Outside the listed text bands; images/video/code rules in legend apply.`;
}
