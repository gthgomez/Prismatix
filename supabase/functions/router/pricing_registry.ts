// Single source of truth lives in ../_shared/model_tariff.ts. This module
// re-exports it typed for the router and keeps the server-side helpers.
import {
  MODEL_TARIFF,
  MODEL_TARIFF_VERSION,
  isPriceExpired,
} from '../_shared/model_tariff.ts';

export {
  assertPricingCurrent,
  isPriceExpired,
  StalePriceError,
} from '../_shared/model_tariff.ts';

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
  isExpired?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string;
  isEligibleForAutoRouting?: boolean;
}

export const PRICING_VERSION: string = MODEL_TARIFF_VERSION;

/**
 * Checks if a given UTC time falls within DeepSeek's official off-peak window (16:30 - 08:30 UTC).
 */
export function isDeepSeekOffPeak(date: Date = new Date()): boolean {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  // 16:30 UTC = 990 minutes; 08:30 UTC = 510 minutes
  return utcMinutes >= 990 || utcMinutes < 510;
}


export const PRICING_REGISTRY: Record<string, ModelPricing> =
  MODEL_TARIFF as unknown as Record<string, ModelPricing>;


/**
 * Fail-Closed Pricing Retrieval.
 * If pricing is unknown or its effective interval has expired, automatic
 * routing is strictly forbidden and no live rate is ever returned.
 */
export function getPricingForModel(model: string, now: Date = new Date()): ModelPricing {
  const existing = PRICING_REGISTRY[model];
  if (existing) {
    if (isPriceExpired(existing, now)) {
      // Expired price: same fail-closed posture as an unknown model, plus an
      // explicit isExpired flag so callers can explain the difference.
      return {
        inputRatePer1M: 0.0,
        outputRatePer1M: 0.0,
        asOfDate: 'expired',
        sourceRef: 'expired-fail-closed',
        isEstimated: true,
        isUnknown: true,
        isExpired: true,
        isEligibleForAutoRouting: false,
      };
    }
    return existing;
  }

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
