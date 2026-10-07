// Single source of truth lives in ../_shared/model_tariff.ts. This module
// re-exports it typed for the router and keeps the server-side helpers.
import {
  MODEL_TARIFF,
  MODEL_TARIFF_VERSION,
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
  isEligibleForAutoRouting?: boolean;
}

export const PRICING_VERSION: string = MODEL_TARIFF_VERSION;

/**
 * DeepSeek peak window per https://api-docs.deepseek.com/quick_start/pricing/
 * (verified 2026-10-07): peak = 01:00-04:00 and 06:00-10:00 UTC, Mon-Fri.
 * Weekends are off-peak; Chinese public holidays are also off-peak but are
 * NOT modeled here (no holiday calendar) — off-peak estimates on those days
 * will be conservative. Off-peak rates are half of peak.
 */
export function isDeepSeekOffPeak(date: Date = new Date()): boolean {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return true; // Sat/Sun
  const m = date.getUTCHours() * 60 + date.getUTCMinutes();
  const peak = (m >= 60 && m < 240) || (m >= 360 && m < 600);
  return !peak;
}


export const PRICING_REGISTRY: Record<string, ModelPricing> =
  MODEL_TARIFF as unknown as Record<string, ModelPricing>;


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
