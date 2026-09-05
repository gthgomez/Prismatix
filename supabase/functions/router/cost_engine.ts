import { countTokens, type RouterModel } from './router_logic.ts';
import { getModelPricing, PRICING_VERSION } from './pricing_registry.ts';

const TOKENS_PER_MILLION = 1_000_000;

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export interface PreFlightCostResult {
  tokenEstimate: number;
  promptTokens: number;
  projectedOutputTokens: number;
  estimatedUsd: number;
  pricingVersion: string;
  hasUnknownRate: boolean;
}

export interface UsageStats {
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
}

export interface FinalCostResult {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  finalUsd: number;
  pricingVersion: string;
  hasUnknownRate: boolean;
}

export interface CostBreakdownResult {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  reasoningCostUsd: number;
  totalUsd: number;
  pricingVersion: string;
  hasUnknownRate: boolean;
}

export function calculatePreFlightCost(
  modelTier: RouterModel,
  contextText: string,
  images: number,
  additionalPromptTokens = 0,
): PreFlightCostResult {
  const imageTokens = Math.max(0, images) * 1600;
  const promptTokens = countTokens(contextText) + imageTokens + Math.max(0, additionalPromptTokens);
  const projectedOutputTokens = Math.max(64, Math.ceil(promptTokens * 0.35));
  const pricing = getModelPricing(modelTier);

  // Fail-closed: getPricingForModel returns an isUnknown placeholder rather
  // than null for unpriced models. Treat it as an unknown rate ($0 estimate,
  // flagged) instead of silently assuming the placeholder's zero rates.
  if (pricing.isUnknown) {
    return {
      tokenEstimate: promptTokens + projectedOutputTokens,
      promptTokens,
      projectedOutputTokens,
      estimatedUsd: 0,
      pricingVersion: PRICING_VERSION,
      hasUnknownRate: true,
    };
  }

  const inputCost = (promptTokens / TOKENS_PER_MILLION) * pricing.inputRatePer1M;
  const outputCost = (projectedOutputTokens / TOKENS_PER_MILLION) * pricing.outputRatePer1M;

  return {
    tokenEstimate: promptTokens + projectedOutputTokens,
    promptTokens,
    projectedOutputTokens,
    estimatedUsd: roundUsd(inputCost + outputCost),
    pricingVersion: PRICING_VERSION,
    hasUnknownRate: false,
  };
}

export function calculateFinalCost(
  modelTier: RouterModel,
  usage: UsageStats,
): FinalCostResult {
  const promptTokens = Math.max(0, usage.promptTokens || 0);
  const completionTokens = Math.max(0, usage.completionTokens || 0);
  const reasoningTokens = Math.max(0, usage.reasoningTokens || 0);
  const pricing = getModelPricing(modelTier);

  if (pricing.isUnknown) {
    return {
      promptTokens,
      completionTokens,
      reasoningTokens,
      finalUsd: 0,
      pricingVersion: PRICING_VERSION,
      hasUnknownRate: true,
    };
  }

  const inputCost = (promptTokens / TOKENS_PER_MILLION) * pricing.inputRatePer1M;
  const outputCost = (completionTokens / TOKENS_PER_MILLION) * pricing.outputRatePer1M;
  const reasoningRate = pricing.reasoningRatePer1M ?? pricing.outputRatePer1M;
  const reasoningCost = (reasoningTokens / TOKENS_PER_MILLION) * reasoningRate;

  return {
    promptTokens,
    completionTokens,
    reasoningTokens,
    finalUsd: roundUsd(inputCost + outputCost + reasoningCost),
    pricingVersion: PRICING_VERSION,
    hasUnknownRate: false,
  };
}

export function calculateCostBreakdown(
  modelTier: RouterModel,
  usage: UsageStats,
): CostBreakdownResult {
  const promptTokens = Math.max(0, usage.promptTokens || 0);
  const completionTokens = Math.max(0, usage.completionTokens || 0);
  const reasoningTokens = Math.max(0, usage.reasoningTokens || 0);
  const pricing = getModelPricing(modelTier);

  if (pricing.isUnknown) {
    return {
      promptTokens,
      completionTokens,
      reasoningTokens,
      inputCostUsd: 0,
      outputCostUsd: 0,
      reasoningCostUsd: 0,
      totalUsd: 0,
      pricingVersion: PRICING_VERSION,
      hasUnknownRate: true,
    };
  }

  const inputCost = roundUsd((promptTokens / TOKENS_PER_MILLION) * pricing.inputRatePer1M);
  const outputCost = roundUsd((completionTokens / TOKENS_PER_MILLION) * pricing.outputRatePer1M);
  const reasoningRate = pricing.reasoningRatePer1M ?? pricing.outputRatePer1M;
  const reasoningCost = roundUsd((reasoningTokens / TOKENS_PER_MILLION) * reasoningRate);

  return {
    promptTokens,
    completionTokens,
    reasoningTokens,
    inputCostUsd: inputCost,
    outputCostUsd: outputCost,
    reasoningCostUsd: reasoningCost,
    totalUsd: roundUsd(inputCost + outputCost + reasoningCost),
    pricingVersion: PRICING_VERSION,
    hasUnknownRate: false,
  };
}

export interface AutoSendSafetyInput {
  /** True when the model was chosen by Auto routing (no manual override). */
  isAuto: boolean;
  modelTier: RouterModel;
  hasUnknownRate: boolean;
}

export interface AutoSendSafetyDecision {
  allowed: boolean;
  reason?: 'unknown_pricing' | 'auto_not_eligible';
  message: string;
}

/**
 * Single authoritative gate for "may this request be sent automatically?".
 * Unknown pricing blocks both auto and explicit selection (an unpriced model
 * can never be shown as a known cost). Auto additionally requires the model
 * to be flagged as eligible for automatic routing.
 */
export function evaluateAutoSendSafety(input: AutoSendSafetyInput): AutoSendSafetyDecision {
  const pricing = getModelPricing(input.modelTier);

  if (input.hasUnknownRate || pricing.isUnknown) {
    return {
      allowed: false,
      reason: 'unknown_pricing',
      message:
        `Cost safety: pricing for model '${input.modelTier}' is unknown, so Prismatix will not send this request. ` +
        'Pick a priced model manually or try again later.',
    };
  }

  if (input.isAuto && pricing.isEligibleForAutoRouting === false) {
    return {
      allowed: false,
      reason: 'auto_not_eligible',
      message:
        `Cost safety: model '${input.modelTier}' is not eligible for automatic routing. ` +
        'Choose it explicitly from the model menu if you want to use it.',
    };
  }

  return { allowed: true, message: '' };
}
