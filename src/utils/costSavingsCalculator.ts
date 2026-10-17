import type { ModelPricing } from '../pricingRegistry';
import { getPricingForModel } from '../pricingRegistry';

export const FRONTIER_BASELINE_MODEL = 'gpt-6-sol';

export interface CostSavingsInput {
  model?: string;
  costUsd?: number;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  content?: string;
}

export interface CostSavingsAnalysis {
  model: string;
  modelPricing: ModelPricing;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs?: number;
  tokensPerSec?: number;
  actualCostUsd: number;
  baselineModel: string;
  baselineCostUsd: number;
  savingsUsd: number;
  savingsPercent: number;
  isSettled: boolean;
}

export function computeCostSavings(input: CostSavingsInput): CostSavingsAnalysis {
  const model = input.model || 'gemini-3.8-flash';
  const pricing = getPricingForModel(model);
  const baselinePricing = getPricingForModel(FRONTIER_BASELINE_MODEL);

  const promptTokens = Math.max(0, input.promptTokens ?? 0);
  const completionTokens = Math.max(
    0,
    input.completionTokens ??
      (typeof input.content === 'string' && input.content.length > 0
        ? Math.ceil(input.content.length / 4)
        : 0),
  );
  const totalTokens = promptTokens + completionTokens;

  const actualCostUsd = Math.max(0, input.costUsd ?? 0);

  // Calculate what this turn would have cost with the frontier baseline model (gpt-6-sol)
  const baselineInputCost = (promptTokens / 1_000_000) * baselinePricing.inputRatePer1M;
  const baselineOutputCost = (completionTokens / 1_000_000) * baselinePricing.outputRatePer1M;
  const baselineCostUsd = Math.round((baselineInputCost + baselineOutputCost) * 1_000_000) / 1_000_000;

  const savingsUsd = Math.max(0, Math.round((baselineCostUsd - actualCostUsd) * 1_000_000) / 1_000_000);
  const savingsPercent =
    baselineCostUsd > 0
      ? Math.min(99.9, Math.max(0, Math.round(((baselineCostUsd - actualCostUsd) / baselineCostUsd) * 1000) / 10))
      : 0;

  let tokensPerSec: number | undefined;
  if (input.durationMs && input.durationMs > 200 && completionTokens > 0) {
    tokensPerSec = Math.round((completionTokens / (input.durationMs / 1000)) * 10) / 10;
  }

  return {
    model,
    modelPricing: pricing,
    promptTokens,
    completionTokens,
    totalTokens,
    durationMs: input.durationMs,
    tokensPerSec,
    actualCostUsd,
    baselineModel: FRONTIER_BASELINE_MODEL,
    baselineCostUsd,
    savingsUsd,
    savingsPercent,
    isSettled: input.costUsd !== undefined && input.costUsd >= 0,
  };
}
