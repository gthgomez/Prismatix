import type { RouterModel } from './types';

export interface ModelPricing {
  inputRatePer1M: number;
  outputRatePer1M: number;
  reasoningRatePer1M?: number;
  cachedReadRatePer1M?: number;
  cachedWriteRatePer1M?: number;
  longContextThreshold?: number;
  longContextInputRatePer1M?: number;
  longContextOutputRatePer1M?: number;
  isEstimated: boolean;
  isUnknown?: boolean;
  isEligibleForAutoRouting?: boolean;
}

export const PRICING_VERSION = '2026-08-16-v5';

export const PRICING_REGISTRY: Record<RouterModel, ModelPricing> = {
  // OpenCode Curated Models (Official Zen Rates 2026)
  'deepseek-v4-flash': {
    inputRatePer1M: 0.14,
    outputRatePer1M: 0.28,
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-5.6-luna': {
    inputRatePer1M: 0.20,
    outputRatePer1M: 1.20,
    longContextThreshold: 272000,
    longContextInputRatePer1M: 0.40,
    longContextOutputRatePer1M: 1.80,
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'deepseek-v4-pro': {
    inputRatePer1M: 1.74,
    outputRatePer1M: 3.48,
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'grok-4.6': {
    inputRatePer1M: 2.00,
    outputRatePer1M: 6.00,
    cachedReadRatePer1M: 1.00,
    longContextThreshold: 200000,
    longContextInputRatePer1M: 4.00,
    longContextOutputRatePer1M: 12.00,
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-sonnet-5': {
    inputRatePer1M: 2.00,
    outputRatePer1M: 10.00,
    cachedReadRatePer1M: 0.20,
    cachedWriteRatePer1M: 2.50,
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-5.6-terra': {
    inputRatePer1M: 2.00,
    outputRatePer1M: 12.00,
    longContextThreshold: 272000,
    longContextInputRatePer1M: 4.00,
    longContextOutputRatePer1M: 18.00,
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-opus-5': {
    inputRatePer1M: 5.00,
    outputRatePer1M: 25.00,
    cachedReadRatePer1M: 0.50,
    cachedWriteRatePer1M: 6.25,
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-5.6-sol': {
    inputRatePer1M: 5.00,
    outputRatePer1M: 30.00,
    longContextThreshold: 272000,
    longContextInputRatePer1M: 10.00,
    longContextOutputRatePer1M: 45.00,
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-3.7-flash': {
    inputRatePer1M: 1.50,
    outputRatePer1M: 7.50,
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-haiku-4-5': {
    inputRatePer1M: 1.00,
    outputRatePer1M: 5.00,
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },

  // Free/Experimental models
  'deepseek-v4-flash-free': {
    inputRatePer1M: 0.0,
    outputRatePer1M: 0.0,
    isEstimated: false,
    isEligibleForAutoRouting: false,
  },
  'mimo-v2.5-free': {
    inputRatePer1M: 0.0,
    outputRatePer1M: 0.0,
    isEstimated: false,
    isEligibleForAutoRouting: false,
  },

  // Legacy fallback models
  'haiku-4.5': {
    inputRatePer1M: 1.0,
    outputRatePer1M: 5.0,
    isEstimated: true,
  },
  'sonnet-4.6': {
    inputRatePer1M: 3.0,
    outputRatePer1M: 15.0,
    isEstimated: true,
  },
  'opus-4.6': {
    inputRatePer1M: 15.0,
    outputRatePer1M: 75.0,
    isEstimated: true,
  },
  'gpt-5.4-mini': {
    inputRatePer1M: 0.75,
    outputRatePer1M: 4.50,
    isEstimated: false,
  },
  'gemini-3-flash': {
    inputRatePer1M: 0.50,
    outputRatePer1M: 3.00,
    isEstimated: false,
  },
  'gemini-2.5-flash': {
    inputRatePer1M: 0.15,
    outputRatePer1M: 0.60,
    reasoningRatePer1M: 0.35,
    isEstimated: true,
  },
  'nemotron-3-super': {
    inputRatePer1M: 0.10,
    outputRatePer1M: 0.50,
    isEstimated: false,
  },
  'gemini-3.1-pro': {
    inputRatePer1M: 1.25,
    outputRatePer1M: 10.0,
    isEstimated: true,
  },
  'llama-4-scout': {
    inputRatePer1M: 0.06,
    outputRatePer1M: 0.30,
    isEstimated: false,
  },
  'qwen3-235b': {
    inputRatePer1M: 0.071,
    outputRatePer1M: 0.10,
    isEstimated: false,
  },
  'llama-3.3-70b-turbo': {
    inputRatePer1M: 0.012,
    outputRatePer1M: 0.03,
    isEstimated: false,
  },
  'mistral-small-24b': {
    inputRatePer1M: 0.04,
    outputRatePer1M: 0.08,
    isEstimated: false,
  },
  'qwen3-32b': {
    inputRatePer1M: 0.07,
    outputRatePer1M: 0.28,
    isEstimated: false,
  },
  'deepseek-v3': {
    inputRatePer1M: 0.20,
    outputRatePer1M: 0.77,
    isEstimated: false,
  },
  'glm-4.7-flash': {
    inputRatePer1M: 0.06,
    outputRatePer1M: 0.40,
    isEstimated: false,
  },
  'qwen3.5-4b': {
    inputRatePer1M: 0.03,
    outputRatePer1M: 0.15,
    isEstimated: false,
  },
  'qwen3.5-9b': {
    inputRatePer1M: 0.04,
    outputRatePer1M: 0.20,
    isEstimated: false,
  },
  'step-3.5-flash': {
    inputRatePer1M: 0.10,
    outputRatePer1M: 0.30,
    isEstimated: false,
  },
  'llama-3.1-8b-turbo': {
    inputRatePer1M: 0.02,
    outputRatePer1M: 0.03,
    isEstimated: false,
  },
  'mistral-nemo': {
    inputRatePer1M: 0.02,
    outputRatePer1M: 0.04,
    isEstimated: false,
  },
  'nemotron-nano-30b': {
    inputRatePer1M: 0.10,
    outputRatePer1M: 0.16,
    isEstimated: false,
  },
};
