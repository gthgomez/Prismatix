import type { RouterModel } from './types';
import { getPricingForModel, PRICING_VERSION } from './pricingRegistry';
import { resolvePeerChallengers } from './modelBenchmarks';

const TOKENS_PER_MILLION = 1_000_000;

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  // ~4 chars per token is the standard tiktoken approximation and handles code well.
  return Math.ceil(text.length / 4);
}

export interface PreFlightCostResult {
  promptTokens: number;
  projectedOutputTokens: number;
  estimatedUsd: number;
  pricingVersion: string;
  /** True when the pricing registry has no known rate for this model. */
  hasUnknownRate: boolean;
}

export interface FinalCostResult {
  finalUsd: number;
  pricingVersion: string;
  hasUnknownRate: boolean;
}

export interface UsageEstimate {
  promptTokens: number;
  completionTokens: number;
  thinkingTokens?: number;
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  thinkingCost: number;
  totalCost: number;
  pricingVersion: string;
  /** True when the pricing registry has no known rate for this model. */
  hasUnknownRate: boolean;
}

/**
 * Fail-closed display policy: an unknown rate is never shown as $0.00.
 * Callers surface hasUnknownRate instead of trusting the numeric estimate.
 */

export function calculatePreFlightCost(
  model: RouterModel,
  contextText: string,
  imageCount = 0,
): PreFlightCostResult {
  const pricing = getPricingForModel(model);
  const promptTokens = estimateTokenCount(contextText) + Math.max(0, imageCount) * 1600;
  const projectedOutputTokens = Math.max(64, Math.ceil(promptTokens * 0.35));

  if (pricing.isUnknown) {
    return {
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
    promptTokens,
    projectedOutputTokens,
    estimatedUsd: roundUsd(inputCost + outputCost),
    pricingVersion: PRICING_VERSION,
    hasUnknownRate: false,
  };
}

export function calculateDebatePreFlightCost(
  profile: 'general' | 'code' | 'video_ui',
  primaryModel: RouterModel,
  contextText: string,
  imageCount = 0,
): PreFlightCostResult {
  const proposerCost = calculatePreFlightCost(primaryModel, contextText, 0);
  const challengerTiers: RouterModel[] = profile === 'video_ui'
    ? ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.8-flash']
    : (resolvePeerChallengers({ primaryModel, count: 2 }).challengers as RouterModel[]);

  let challengersEstimatedUsd = 0;
  let challengersPromptTokens = 0;
  let hasUnknownRate = proposerCost.hasUnknownRate;

  for (const cTier of challengerTiers) {
    const cCost = calculatePreFlightCost(
      cTier,
      `${contextText}\nproposer draft: ${'x'.repeat(proposerCost.projectedOutputTokens * 4)}`,
      0,
    );
    challengersEstimatedUsd += cCost.estimatedUsd;
    challengersPromptTokens += cCost.promptTokens;
    hasUnknownRate = hasUnknownRate || cCost.hasUnknownRate;
  }

  const synthesisCost = calculatePreFlightCost(
    primaryModel,
    `${contextText}\nproposer draft: ${'x'.repeat(proposerCost.projectedOutputTokens * 4)}\ncritique: ${'x'.repeat(proposerCost.projectedOutputTokens * 4)}`,
    imageCount,
  );
  hasUnknownRate = hasUnknownRate || synthesisCost.hasUnknownRate;

  return {
    promptTokens: proposerCost.promptTokens + challengersPromptTokens + synthesisCost.promptTokens,
    projectedOutputTokens: proposerCost.projectedOutputTokens + synthesisCost.projectedOutputTokens,
    estimatedUsd: roundUsd(proposerCost.estimatedUsd + challengersEstimatedUsd + synthesisCost.estimatedUsd),
    pricingVersion: PRICING_VERSION,
    hasUnknownRate,
  };
}

export function calculateFinalCost(
  model: RouterModel,
  usage: { promptTokens: number; completionTokens: number; reasoningTokens?: number },
): FinalCostResult {
  const pricing = getPricingForModel(model);
  if (pricing.isUnknown) {
    return { finalUsd: 0, pricingVersion: PRICING_VERSION, hasUnknownRate: true };
  }
  const reasoningRate = pricing.reasoningRatePer1M ?? pricing.outputRatePer1M;

  const inputCost = (Math.max(0, usage.promptTokens) / TOKENS_PER_MILLION) * pricing.inputRatePer1M;
  const outputCost = (Math.max(0, usage.completionTokens) / TOKENS_PER_MILLION) * pricing.outputRatePer1M;
  const reasoningCost = (Math.max(0, usage.reasoningTokens || 0) / TOKENS_PER_MILLION) *
    reasoningRate;

  return {
    finalUsd: roundUsd(inputCost + outputCost + reasoningCost),
    pricingVersion: PRICING_VERSION,
    hasUnknownRate: false,
  };
}

export function calculateCostBreakdown(
  model: RouterModel,
  usage: UsageEstimate,
): CostBreakdown {
  const pricing = getPricingForModel(model);
  if (pricing.isUnknown) {
    return {
      inputCost: 0,
      outputCost: 0,
      thinkingCost: 0,
      totalCost: 0,
      pricingVersion: PRICING_VERSION,
      hasUnknownRate: true,
    };
  }
  const reasoningRate = pricing.reasoningRatePer1M ?? pricing.outputRatePer1M;

  const inputCost = roundUsd(
    (Math.max(0, usage.promptTokens) / TOKENS_PER_MILLION) * pricing.inputRatePer1M,
  );
  const outputCost = roundUsd(
    (Math.max(0, usage.completionTokens) / TOKENS_PER_MILLION) * pricing.outputRatePer1M,
  );
  const thinkingCost = roundUsd(
    (Math.max(0, usage.thinkingTokens || 0) / TOKENS_PER_MILLION) * reasoningRate,
  );

  return {
    inputCost,
    outputCost,
    thinkingCost,
    totalCost: roundUsd(inputCost + outputCost + thinkingCost),
    pricingVersion: PRICING_VERSION,
    hasUnknownRate: false,
  };
}
