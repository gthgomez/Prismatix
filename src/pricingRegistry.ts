import type { RouterModel } from './types';

export interface ModelPricing {
  inputRatePer1M: number;
  outputRatePer1M: number;
  reasoningRatePer1M?: number;
  isEstimated: boolean;
}

export const PRICING_VERSION = '2026-03-20-v2';

export const PRICING_REGISTRY: Record<RouterModel, ModelPricing> = {
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
};
