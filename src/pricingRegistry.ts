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
  sourceRef: string;
  isEstimated: boolean;
  isUnknown?: boolean;
  isEligibleForAutoRouting?: boolean;
}

export const PRICING_VERSION = '2026-08-16-v7';

/**
 * Checks if a given UTC time falls within DeepSeek's official off-peak window (16:30 - 08:30 UTC).
 */
export function isDeepSeekOffPeak(date: Date = new Date()): boolean {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return utcMinutes >= 990 || utcMinutes < 510;
}

// Official OpenCode Zen & fallback pricing table with tier-aware cache economics & peak/off-peak rates
export const PRICING_REGISTRY: Record<string, ModelPricing> = {
  // OpenCode Curated Models (Official Zen Rates 2026)
  // DeepSeek V4 Flash: Peak rate ($0.44/$1.32/$0.014) is conservative routing ceiling; off-peak ($0.22/$0.66/$0.007)
  'deepseek-v4-flash': {
    inputRatePer1M: 0.44,
    outputRatePer1M: 1.32,
    cachedReadRatePer1M: 0.014,
    offPeakInputRatePer1M: 0.22,
    offPeakOutputRatePer1M: 0.66,
    offPeakCachedReadRatePer1M: 0.007,
    asOfDate: '2026-08-16',
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
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  // DeepSeek V4 Pro: Peak rate ($1.32/$3.96/$0.044) is conservative routing ceiling; off-peak ($0.66/$1.98/$0.022)
  'deepseek-v4-pro': {
    inputRatePer1M: 1.32,
    outputRatePer1M: 3.96,
    cachedReadRatePer1M: 0.044,
    offPeakInputRatePer1M: 0.66,
    offPeakOutputRatePer1M: 1.98,
    offPeakCachedReadRatePer1M: 0.022,
    asOfDate: '2026-08-16',
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
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-sonnet-5': {
    inputRatePer1M: 2.00,
    outputRatePer1M: 10.00,
    cachedReadRatePer1M: 0.20,
    cachedWriteRatePer1M: 2.50,
    asOfDate: '2026-08-16',
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
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-opus-5': {
    inputRatePer1M: 5.00,
    outputRatePer1M: 25.00,
    cachedReadRatePer1M: 0.50,
    cachedWriteRatePer1M: 6.25,
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-5.6-sol': {
    inputRatePer1M: 5.00,
    outputRatePer1M: 30.00,
    cachedReadRatePer1M: 0.50,
    cachedWriteRatePer1M: 6.25,
    longContextThreshold: 272000,
    longContextInputRatePer1M: 10.00,
    longContextOutputRatePer1M: 45.00,
    longContextCachedReadRatePer1M: 1.00,
    longContextCachedWriteRatePer1M: 12.50,
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-3.7-flash': {
    inputRatePer1M: 1.50,
    outputRatePer1M: 7.50,
    cachedReadRatePer1M: 0.05,
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-haiku-4-5': {
    inputRatePer1M: 1.00,
    outputRatePer1M: 5.00,
    cachedReadRatePer1M: 0.10,
    cachedWriteRatePer1M: 1.25,
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },

  // Free/Experimental models
  'deepseek-v4-flash-free': {
    inputRatePer1M: 0.0,
    outputRatePer1M: 0.0,
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-free',
    isEstimated: false,
    isEligibleForAutoRouting: false,
  },
  'mimo-v2.5-free': {
    inputRatePer1M: 0.0,
    outputRatePer1M: 0.0,
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-free',
    isEstimated: false,
    isEligibleForAutoRouting: false,
  },

  // Legacy / Direct Router Model Mappings
  'haiku-4.5': {
    inputRatePer1M: 0.80,
    outputRatePer1M: 4.00,
    asOfDate: '2026-04-13',
    sourceRef: 'anthropic-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'sonnet-4.6': {
    inputRatePer1M: 3.00,
    outputRatePer1M: 15.00,
    asOfDate: '2026-04-13',
    sourceRef: 'anthropic-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'opus-4.6': {
    inputRatePer1M: 15.00,
    outputRatePer1M: 75.00,
    asOfDate: '2026-04-13',
    sourceRef: 'anthropic-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-5.4-mini': {
    inputRatePer1M: 0.15,
    outputRatePer1M: 0.60,
    asOfDate: '2026-04-13',
    sourceRef: 'openai-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-3-flash': {
    inputRatePer1M: 0.075,
    outputRatePer1M: 0.30,
    asOfDate: '2026-04-13',
    sourceRef: 'google-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-3.1-pro': {
    inputRatePer1M: 1.25,
    outputRatePer1M: 5.00,
    asOfDate: '2026-04-13',
    sourceRef: 'google-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'nemotron-3-super': {
    inputRatePer1M: 0.10,
    outputRatePer1M: 0.16,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'llama-4-scout': {
    inputRatePer1M: 0.10,
    outputRatePer1M: 0.30,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'qwen3-235b': {
    inputRatePer1M: 0.05,
    outputRatePer1M: 0.10,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'llama-3.3-70b-turbo': {
    inputRatePer1M: 0.02,
    outputRatePer1M: 0.03,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'mistral-small-24b': {
    inputRatePer1M: 0.03,
    outputRatePer1M: 0.08,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'qwen3-32b': {
    inputRatePer1M: 0.08,
    outputRatePer1M: 0.28,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },

  // Direct Provider Fallback Pricing Table
  'claude-3-5-sonnet': {
    inputRatePer1M: 3.00,
    outputRatePer1M: 15.00,
    asOfDate: '2026-04-13',
    sourceRef: 'anthropic-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-3-5-haiku': {
    inputRatePer1M: 0.80,
    outputRatePer1M: 4.00,
    asOfDate: '2026-04-13',
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
    inputRatePer1M: 2.50,
    outputRatePer1M: 10.00,
    asOfDate: '2026-04-13',
    sourceRef: 'openai-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-4o-mini': {
    inputRatePer1M: 0.15,
    outputRatePer1M: 0.60,
    asOfDate: '2026-04-13',
    sourceRef: 'openai-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'o3-mini': {
    inputRatePer1M: 1.10,
    outputRatePer1M: 4.40,
    reasoningRatePer1M: 4.40,
    asOfDate: '2026-04-13',
    sourceRef: 'openai-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-2.5-flash': {
    inputRatePer1M: 0.075,
    outputRatePer1M: 0.30,
    asOfDate: '2026-04-13',
    sourceRef: 'google-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-2.5-pro': {
    inputRatePer1M: 1.25,
    outputRatePer1M: 5.00,
    asOfDate: '2026-04-13',
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
    inputRatePer1M: 0.55,
    outputRatePer1M: 2.19,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'deepseek-v3': {
    inputRatePer1M: 0.20,
    outputRatePer1M: 0.77,
    asOfDate: '2026-04-13',
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
    outputRatePer1M: 0.03,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'mistral-nemo': {
    inputRatePer1M: 0.02,
    outputRatePer1M: 0.04,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'nemotron-nano-30b': {
    inputRatePer1M: 0.10,
    outputRatePer1M: 0.16,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
};

/**
 * Fail-Closed Pricing Retrieval.
 * If pricing is unknown, automatic routing is strictly forbidden.
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
  eligibleForAutoRoute: boolean;
  isLongContext: boolean;
  isOffPeak?: boolean;
  breakdown?: {
    inputCost: number;
    outputCost: number;
    cachedReadCost: number;
    cachedWriteCost: number;
  };
} {
  const pricing = getPricingForModel(model);
  if (pricing.isUnknown) {
    return {
      costUsd: null,
      isUnknown: true,
      eligibleForAutoRoute: false,
      isLongContext: false,
    };
  }

  const isLongContext = Boolean(
    pricing.longContextThreshold && contextTokens > pricing.longContextThreshold,
  );

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
    eligibleForAutoRoute: pricing.isEligibleForAutoRouting !== false,
    isLongContext,
    isOffPeak,
    breakdown: {
      inputCost,
      outputCost,
      cachedReadCost,
      cachedWriteCost,
    },
  };
}
