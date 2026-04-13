import type { RouterModel } from './router_logic.ts';

export interface ModelPricing {
  inputRatePer1M: number;
  outputRatePer1M: number;
  reasoningRatePer1M?: number;
  asOfDate: string;
  sourceRef: string;
  isEstimated: boolean;
}

export const PRICING_VERSION = '2026-03-20-v2';

// Conservative, model-key-aligned pricing table for budget estimation and UX guidance.
export const PRICING_REGISTRY: Record<RouterModel, ModelPricing> = {
  'haiku-4.5': {
    inputRatePer1M: 1.0,
    outputRatePer1M: 5.0,
    asOfDate: '2026-02-12',
    sourceRef: 'anthropic-docs',
    isEstimated: true,
  },
  'sonnet-4.6': {
    inputRatePer1M: 3.0,
    outputRatePer1M: 15.0,
    asOfDate: '2026-02-21',
    sourceRef: 'anthropic-docs',
    isEstimated: true,
  },
  'opus-4.6': {
    inputRatePer1M: 15.0,
    outputRatePer1M: 75.0,
    asOfDate: '2026-02-21',
    sourceRef: 'anthropic-docs',
    isEstimated: true,
  },
  'gpt-5.4-mini': {
    inputRatePer1M: 0.75,
    outputRatePer1M: 4.50,
    asOfDate: '2026-03-20',
    sourceRef: 'openai-pricing',
    isEstimated: false,
  },
  'gemini-3-flash': {
    inputRatePer1M: 0.50,
    outputRatePer1M: 3.00,
    asOfDate: '2026-03-20',
    sourceRef: 'google-pricing',
    isEstimated: false,
  },
  'gemini-2.5-flash': {
    inputRatePer1M: 0.15,
    outputRatePer1M: 0.60,
    reasoningRatePer1M: 0.35,
    asOfDate: '2026-03-20',
    sourceRef: 'google-pricing',
    isEstimated: true,
  },
  'nemotron-3-super': {
    inputRatePer1M: 0.10,
    outputRatePer1M: 0.50,
    asOfDate: '2026-03-20',
    sourceRef: 'nvidia-nim-pricing',
    isEstimated: false,
  },
  'gemini-3.1-pro': {
    inputRatePer1M: 1.25,
    outputRatePer1M: 10.0,
    asOfDate: '2026-02-21',
    sourceRef: 'google-pricing',
    isEstimated: true,
  },
  'llama-4-scout': {
    inputRatePer1M: 0.06,
    outputRatePer1M: 0.30,
    asOfDate: '2026-04-10',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
  },
  'qwen3-235b': {
    inputRatePer1M: 0.20,
    outputRatePer1M: 0.60,
    asOfDate: '2026-04-10',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
  },
  // DeepInfra cheap batch
  'llama-3.3-70b-turbo': {
    inputRatePer1M: 0.012,
    outputRatePer1M: 0.03,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
  },
  'mistral-small-24b': {
    inputRatePer1M: 0.04,
    outputRatePer1M: 0.08,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
  },
  'qwen3-32b': {
    inputRatePer1M: 0.07,
    outputRatePer1M: 0.28,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
  },
  'deepseek-v3': {
    inputRatePer1M: 0.22,
    outputRatePer1M: 0.89,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
  },
  // DeepInfra debate-tier challengers
  'glm-4.7-flash': {
    inputRatePer1M: 0.06,
    outputRatePer1M: 0.40,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
  },
  'qwen3.5-4b': {
    inputRatePer1M: 0.03,
    outputRatePer1M: 0.15,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
  },
  'qwen3.5-9b': {
    inputRatePer1M: 0.04,
    outputRatePer1M: 0.20,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
  },
  'step-3.5-flash': {
    inputRatePer1M: 0.10,
    outputRatePer1M: 0.30,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
  },
  'llama-3.1-8b-turbo': {
    inputRatePer1M: 0.02,
    outputRatePer1M: 0.03,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
  },
  'mistral-nemo': {
    inputRatePer1M: 0.02,
    outputRatePer1M: 0.04,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
  },
  'nemotron-nano-30b': {
    inputRatePer1M: 0.10,
    outputRatePer1M: 0.16,
    asOfDate: '2026-04-13',
    sourceRef: 'deepinfra-pricing',
    isEstimated: false,
  },
};

export function getModelPricing(modelTier: RouterModel): ModelPricing | undefined {
  return PRICING_REGISTRY[modelTier];
}
