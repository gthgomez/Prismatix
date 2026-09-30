export interface ModelPricing {
  inputRatePer1M: number;
  outputRatePer1M: number;
  cachedReadRatePer1M?: number;
  cachedWriteRatePer1M?: number;
  reasoningRatePer1M?: number;
  longContextThreshold?: number;
  longContextInputRatePer1M?: number;
  longContextOutputRatePer1M?: number;
  longContextCachedReadRatePer1M?: number;
  longContextCachedWriteRatePer1M?: number;
  offPeakInputRatePer1M?: number;
  offPeakOutputRatePer1M?: number;
  offPeakCachedReadRatePer1M?: number;
  asOfDate: string;
  /** Effective-dating (PX02): inclusive start of this rate's validity window. */
  effectiveFrom?: string;
  /** Effective-dating (PX02): inclusive end of this rate's validity window
   * (e.g. a promotional rate's advertised expiry). When absent, staleness is
   * governed by STALE_AFTER_DAYS relative to asOfDate/effectiveFrom. */
  effectiveUntil?: string;
  sourceRef: string;
  isEstimated: boolean;
  isUnknown?: boolean;
  isEligibleForAutoRouting?: boolean;
}

export const PRICING_VERSION = '2026-09-29-v8';

/**
 * A known rate older than this many days (relative to evaluation time) is
 * reported as `stale` by lookupPrice and is ineligible for automatic routing.
 * Stale rates keep their recorded values — they never masquerade as current
 * and are never coerced to free.
 */
export const STALE_AFTER_DAYS = 60;

/**
 * Concrete, citable source URLs (PX02). Every registry row's sourceRef must
 * resolve here so pricing receipts can record where a rate came from.
 */
export const PRICING_SOURCES: Record<string, { name: string; url: string }> = {
  'opencode-zen-official': {
    name: 'OpenCode Zen official pricing',
    url: 'https://opencode.ai/docs/zen',
  },
  'opencode-zen-free': {
    name: 'OpenCode Zen official pricing (free tier)',
    url: 'https://opencode.ai/docs/zen',
  },
  'opencode-zen-free-tier': {
    name: 'OpenCode Zen official pricing (free tier)',
    url: 'https://opencode.ai/docs/zen',
  },
  'openai-pricing': {
    name: 'OpenAI API pricing',
    url: 'https://developers.openai.com/api/docs/pricing',
  },
  'anthropic-pricing': {
    name: 'Anthropic pricing',
    url: 'https://platform.claude.com/docs/en/docs/about-claude/pricing',
  },
  'google-pricing': {
    name: 'Google Gemini API pricing',
    url: 'https://ai.google.dev/pricing',
  },
  'deepinfra-pricing': {
    name: 'DeepInfra pricing',
    url: 'https://deepinfra.com/pricing',
  },
  'unpriced-fail-closed': {
    name: 'No verified source (fail-closed placeholder)',
    url: '',
  },
};

/**
 * Checks if a given UTC time falls within DeepSeek's official off-peak window (16:30 - 08:30 UTC).
 */
export function isDeepSeekOffPeak(date: Date = new Date()): boolean {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  // 16:30 UTC = 990 minutes; 08:30 UTC = 510 minutes
  return utcMinutes >= 990 || utcMinutes < 510;
}

// Official OpenCode Zen & fallback pricing table with tier-aware cache economics.
// Rows dated 2026-09-29 were verified against the official OpenCode Zen page
// (https://opencode.ai/docs/zen, page updated 2026-09-29). That page lists a
// single rate per DeepSeek model; the previous peak/off-peak DeepSeek rows
// (0.44/1.32 and 1.32/3.96 "peak ceiling") disagreed with the official tariff
// and the unverifiable off-peak schedule was dropped rather than guessed.
// All rates are USD per 1M tokens.
export const PRICING_REGISTRY: Record<string, ModelPricing> = {
  // OpenCode Curated Models (official Zen tariff, verified 2026-09-29)
  'deepseek-v4-flash': {
    inputRatePer1M: 0.14,
    outputRatePer1M: 0.28,
    cachedReadRatePer1M: 0.028,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-5.6-luna': {
    inputRatePer1M: 0.20,
    outputRatePer1M: 1.20,
    cachedReadRatePer1M: 0.02,
    cachedWriteRatePer1M: 0.25,
    longContextThreshold: 272000,
    longContextInputRatePer1M: 0.40,
    longContextOutputRatePer1M: 1.80,
    longContextCachedReadRatePer1M: 0.04,
    longContextCachedWriteRatePer1M: 0.50,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  // DeepSeek V4 Pro: single official rate (verified 2026-09-29); no verified off-peak schedule.
  'deepseek-v4-pro': {
    inputRatePer1M: 1.74,
    outputRatePer1M: 3.48,
    cachedReadRatePer1M: 0.145,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'grok-4.6': {
    inputRatePer1M: 2.00,
    outputRatePer1M: 6.00,
    cachedReadRatePer1M: 0.50,
    longContextThreshold: 200000,
    longContextInputRatePer1M: 4.00,
    longContextOutputRatePer1M: 12.00,
    longContextCachedReadRatePer1M: 1.00,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-sonnet-5': {
    inputRatePer1M: 2.00,
    outputRatePer1M: 10.00,
    cachedReadRatePer1M: 0.20,
    cachedWriteRatePer1M: 2.50,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-5.6-terra': {
    inputRatePer1M: 2.00,
    outputRatePer1M: 12.00,
    cachedReadRatePer1M: 0.20,
    cachedWriteRatePer1M: 2.50,
    longContextThreshold: 272000,
    longContextInputRatePer1M: 4.00,
    longContextOutputRatePer1M: 18.00,
    longContextCachedReadRatePer1M: 0.40,
    longContextCachedWriteRatePer1M: 5.00,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-opus-5': {
    inputRatePer1M: 5.00,
    outputRatePer1M: 25.00,
    cachedReadRatePer1M: 0.50,
    cachedWriteRatePer1M: 6.25,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-5.6-sol': {
    // Corrected 2026-09-29 against the official tariff (was 5.00/30.00,
    // long 10.00/45.00 — audit E28 mismatch). Promotional rates advertised
    // through 2026-11-21; the expiry is recorded so the row goes stale
    // instead of masquerading as current after that date.
    inputRatePer1M: 4.00,
    outputRatePer1M: 20.00,
    cachedReadRatePer1M: 0.40,
    cachedWriteRatePer1M: 5.00,
    longContextThreshold: 272000,
    longContextInputRatePer1M: 8.00,
    longContextOutputRatePer1M: 30.00,
    longContextCachedReadRatePer1M: 0.80,
    longContextCachedWriteRatePer1M: 10.00,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    effectiveUntil: '2026-11-21',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-3.7-flash': {
    inputRatePer1M: 1.50,
    outputRatePer1M: 7.50,
    // Corrected 2026-09-29: official cached-read rate is $0.15 (was 0.05).
    cachedReadRatePer1M: 0.15,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-haiku-4-5': {
    inputRatePer1M: 1.00,
    outputRatePer1M: 5.00,
    cachedReadRatePer1M: 0.10,
    cachedWriteRatePer1M: 1.25,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },

  // Free/Experimental models
  'deepseek-v4-flash-free': {
    inputRatePer1M: 0.0,
    outputRatePer1M: 0.0,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'opencode-zen-free',
    isEstimated: false,
    isEligibleForAutoRouting: false,
  },
  'mimo-v2.5-free': {
    inputRatePer1M: 0.0,
    outputRatePer1M: 0.0,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'opencode-zen-free',
    isEstimated: false,
    isEligibleForAutoRouting: false,
  },

  // Legacy / Direct Router Model Mappings
  'haiku-4.5': {
    inputRatePer1M: 1.0,
    outputRatePer1M: 5.0,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'anthropic-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'sonnet-4.6': {
    inputRatePer1M: 3.0,
    outputRatePer1M: 15.0,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'anthropic-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'opus-4.6': {
    inputRatePer1M: 5.0,
    outputRatePer1M: 25.0,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'anthropic-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-5.4-mini': {
    inputRatePer1M: 0.75,
    outputRatePer1M: 4.50,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'openai-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-3-flash': {
    inputRatePer1M: 0.5,
    outputRatePer1M: 3.0,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'google-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-3.1-pro': {
    inputRatePer1M: 2.0,
    outputRatePer1M: 12.0,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'google-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'nemotron-3-super': {
    inputRatePer1M: 0.085,
    outputRatePer1M: 0.4,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'llama-4-scout': {
    inputRatePer1M: 0.1,
    outputRatePer1M: 0.3,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'qwen3-235b': {
    inputRatePer1M: 0.09,
    outputRatePer1M: 0.55,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'llama-3.3-70b-turbo': {
    inputRatePer1M: 0.1,
    outputRatePer1M: 0.32,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'mistral-small-24b': {
    inputRatePer1M: 0.05,
    outputRatePer1M: 0.08,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'qwen3-32b': {
    inputRatePer1M: 0.08,
    outputRatePer1M: 0.28,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },

  // Direct Provider Fallback Pricing Table.
  // Rows dated 2026-09-29 were refreshed/corrected against the official
  // provider pricing pages observed that day (see docs/engineering/pricing.md).
  // Six rows could NOT be re-verified on 2026-09-29 and keep their recorded
  // 2026-04-13 rates: gemini-2.0-flash, claude-3-5-sonnet, claude-3-opus,
  // glm-4.7-flash, qwen3.5-4b, step-3.5-flash. They resolve to status
  // 'stale' (Auto-rejected; manual use shows a staleness warning) — they are
  // never silently treated as current and never coerced to free.
  'claude-3-5-sonnet': {
    inputRatePer1M: 3.00,
    outputRatePer1M: 15.00,
    asOfDate: '2026-04-13',
    sourceRef: 'anthropic-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-3-5-haiku': {
    inputRatePer1M: 0.8,
    outputRatePer1M: 4.0,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'anthropic-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-3-opus': {
    inputRatePer1M: 15.00,
    outputRatePer1M: 75.00,
    asOfDate: '2026-04-13',
    sourceRef: 'anthropic-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-4o': {
    inputRatePer1M: 2.5,
    outputRatePer1M: 10.0,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'openai-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-4o-mini': {
    inputRatePer1M: 0.15,
    outputRatePer1M: 0.6,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'openai-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'o3-mini': {
    inputRatePer1M: 1.1,
    outputRatePer1M: 4.4,
    reasoningRatePer1M: 4.40,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'openai-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-2.5-flash': {
    inputRatePer1M: 0.3,
    outputRatePer1M: 2.5,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'google-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-2.5-pro': {
    inputRatePer1M: 1.25,
    outputRatePer1M: 10.0,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'google-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-2.0-flash': {
    inputRatePer1M: 0.10,
    outputRatePer1M: 0.40,
    asOfDate: '2026-04-13',
    sourceRef: 'google-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'deepseek-r1': {
    inputRatePer1M: 0.5,
    outputRatePer1M: 2.15,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'deepseek-v3': {
    inputRatePer1M: 0.32,
    outputRatePer1M: 0.89,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'glm-4.7-flash': {
    inputRatePer1M: 0.06,
    outputRatePer1M: 0.40,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'qwen3.5-4b': {
    inputRatePer1M: 0.03,
    outputRatePer1M: 0.15,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'qwen3.5-9b': {
    inputRatePer1M: 0.04,
    outputRatePer1M: 0.20,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'step-3.5-flash': {
    inputRatePer1M: 0.10,
    outputRatePer1M: 0.30,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'llama-3.1-8b-turbo': {
    inputRatePer1M: 0.02,
    outputRatePer1M: 0.04,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'mistral-nemo': {
    inputRatePer1M: 0.019,
    outputRatePer1M: 0.03,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'nemotron-nano-30b': {
    inputRatePer1M: 0.05,
    outputRatePer1M: 0.2,
    asOfDate: '2026-09-29',
    effectiveFrom: '2026-09-29',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
};

/**
 * Fail-Closed Pricing Retrieval.
 * If pricing is unknown, automatic routing is strictly forbidden.
 *
 * Note: this legacy helper returns a zero-rate placeholder for unknown
 * models (flagged isUnknown). New code should prefer the typed
 * {@link lookupPrice}, whose unknown state carries a null record instead
 * of zeros so a price can never be silently coerced to free.
 */
export function getPricingForModel(model: string): ModelPricing {
  const existing = PRICING_REGISTRY[model];
  if (existing) return existing;

  // Unknown model pricing: auto-routing forbidden
  return {
    inputRatePer1M: 0.0,
    outputRatePer1M: 0.0,
    asOfDate: 'unknown',
    sourceRef: 'unpriced-fail-closed',
    isEstimated: true,
    isUnknown: true,
    isEligibleForAutoRouting: false,
  };
}

/**
 * Backward compatibility alias for router/cost_engine.ts
 */
export const getModelPricing = getPricingForModel;

export type PriceStatus = 'known' | 'stale' | 'unknown';
export type ContextTier = 'standard' | 'long';

/**
 * Typed result of a price lookup (PX02 interface contract).
 * Cost decisions must consume this result — never a bare optional number —
 * so a stale or unknown rate cannot masquerade as a current one.
 */
export interface PriceLookupResult {
  model: string;
  status: PriceStatus;
  /** All rates in this registry are quoted in USD. */
  currency: 'USD';
  priceVersion: string;
  /** Inclusive start of the rate's validity window (null when unknown). */
  effectiveFrom: string | null;
  /** Inclusive end of the rate's validity window (null when open-ended). */
  effectiveUntil: string | null;
  /** Context tier the request falls into for this model. */
  contextTier: ContextTier;
  /** The tier boundary token count (null when the model has no long tier). */
  contextTierThresholdTokens: number | null;
  /** True only when status === 'known' and the row allows automatic routing. */
  isEligibleForAutoRouting: boolean;
  /** Concrete provenance for pricing receipts. */
  sourceRef: string | null;
  sourceUrl: string | null;
  /** The recorded rates (null when unknown — never zero-faked). */
  pricing: ModelPricing | null;
}

function ageInDays(fromIso: string, now: Date): number {
  const then = new Date(`${fromIso}T00:00:00Z`).getTime();
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - then) / 86_400_000;
}

/**
 * Typed, effective-dated price lookup.
 *
 * Status rules:
 *  - 'unknown': the model has no registry row (fail-closed placeholder with
 *    a null record — never zero rates).
 *  - 'stale': the row's effectiveUntil has passed, or the row is older than
 *    STALE_AFTER_DAYS. Recorded rates remain visible but are ineligible for
 *    automatic routing.
 *  - 'known': within its effective window and freshly verified.
 */
export function lookupPrice(
  model: string,
  contextTokens: number = 0,
  evaluationDate: Date = new Date(),
): PriceLookupResult {
  const row = PRICING_REGISTRY[model];
  if (!row) {
    return {
      model,
      status: 'unknown',
      currency: 'USD',
      priceVersion: PRICING_VERSION,
      effectiveFrom: null,
      effectiveUntil: null,
      contextTier: 'standard',
      contextTierThresholdTokens: null,
      isEligibleForAutoRouting: false,
      sourceRef: null,
      sourceUrl: null,
      pricing: null,
    };
  }

  const effectiveFrom = row.effectiveFrom ?? row.asOfDate;
  const effectiveUntil = row.effectiveUntil ?? null;
  const source = PRICING_SOURCES[row.sourceRef] ?? null;

  const expiredByWindow =
    effectiveUntil !== null &&
    ageInDays(effectiveUntil, evaluationDate) > 0; // day after effectiveUntil
  const expiredByAge = ageInDays(effectiveFrom, evaluationDate) > STALE_AFTER_DAYS;
  const status: PriceStatus = expiredByWindow || expiredByAge ? 'stale' : 'known';

  const threshold = row.longContextThreshold ?? null;
  const contextTier: ContextTier =
    threshold !== null && contextTokens > threshold ? 'long' : 'standard';

  return {
    model,
    status,
    currency: 'USD',
    priceVersion: PRICING_VERSION,
    effectiveFrom,
    effectiveUntil,
    contextTier,
    contextTierThresholdTokens: threshold,
    isEligibleForAutoRouting: status === 'known' && row.isEligibleForAutoRouting !== false,
    sourceRef: row.sourceRef,
    sourceUrl: source?.url ?? null,
    pricing: row,
  };
}

export function calculateEstimatedCostUsd(
  model: string,
  inputTokens: number,
  estimatedOutputTokens: number,
  contextTokens: number = inputTokens,
  cachedReadTokens: number = 0,
  cachedWriteTokens: number = 0,
  evaluationDate?: Date,
): {
  costUsd: number | null;
  isUnknown: boolean;
  isStale: boolean;
  pricingStatus: PriceStatus;
  eligibleForAutoRoute: boolean;
  isLongContext: boolean;
  contextTier: ContextTier;
  priceVersion: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  sourceRef: string | null;
  sourceUrl: string | null;
  isOffPeak?: boolean;
  breakdown?: {
    inputCost: number;
    outputCost: number;
    cachedReadCost: number;
    cachedWriteCost: number;
  };
} {
  const lookup = lookupPrice(model, contextTokens, evaluationDate);
  if (lookup.pricing === null) {
    return {
      costUsd: null,
      isUnknown: true,
      isStale: false,
      pricingStatus: 'unknown',
      eligibleForAutoRoute: false,
      isLongContext: false,
      contextTier: 'standard',
      priceVersion: lookup.priceVersion,
      effectiveFrom: null,
      effectiveUntil: null,
      sourceRef: null,
      sourceUrl: null,
    };
  }
  const pricing = lookup.pricing;

  const isLongContext = lookup.contextTier === 'long';

  const hasOffPeak = pricing.offPeakInputRatePer1M !== undefined;
  const isOffPeak = hasOffPeak && evaluationDate ? isDeepSeekOffPeak(evaluationDate) : false;

  let inputRate: number;
  let outputRate: number;
  let cachedReadRate: number;
  let cachedWriteRate: number;

  if (isLongContext) {
    inputRate = pricing.longContextInputRatePer1M ?? pricing.inputRatePer1M;
    outputRate = pricing.longContextOutputRatePer1M ?? pricing.outputRatePer1M;
    cachedReadRate = pricing.longContextCachedReadRatePer1M ?? (pricing.cachedReadRatePer1M ?? inputRate);
    cachedWriteRate = pricing.longContextCachedWriteRatePer1M ?? (pricing.cachedWriteRatePer1M ?? inputRate);
  } else if (isOffPeak) {
    inputRate = pricing.offPeakInputRatePer1M!;
    outputRate = pricing.offPeakOutputRatePer1M!;
    cachedReadRate = pricing.offPeakCachedReadRatePer1M!;
    cachedWriteRate = pricing.cachedWriteRatePer1M ?? inputRate;
  } else {
    inputRate = pricing.inputRatePer1M;
    outputRate = pricing.outputRatePer1M;
    cachedReadRate = pricing.cachedReadRatePer1M ?? inputRate;
    cachedWriteRate = pricing.cachedWriteRatePer1M ?? inputRate;
  }

  const uncachedInputTokens = Math.max(0, inputTokens - cachedReadTokens);
  const inputCost = (uncachedInputTokens / 1_000_000) * inputRate;
  const outputCost = (estimatedOutputTokens / 1_000_000) * outputRate;
  const cachedReadCost = (cachedReadTokens / 1_000_000) * cachedReadRate;
  const cachedWriteCost = (cachedWriteTokens / 1_000_000) * cachedWriteRate;

  const totalCost = inputCost + outputCost + cachedReadCost + cachedWriteCost;

  return {
    costUsd: totalCost,
    isUnknown: false,
    isStale: lookup.status === 'stale',
    pricingStatus: lookup.status,
    eligibleForAutoRoute: lookup.isEligibleForAutoRouting,
    isLongContext,
    contextTier: lookup.contextTier,
    priceVersion: lookup.priceVersion,
    effectiveFrom: lookup.effectiveFrom,
    effectiveUntil: lookup.effectiveUntil,
    sourceRef: lookup.sourceRef,
    sourceUrl: lookup.sourceUrl,
    isOffPeak,
    breakdown: {
      inputCost,
      outputCost,
      cachedReadCost,
      cachedWriteCost,
    },
  };
}
