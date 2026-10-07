// model_tariff.ts — SINGLE SOURCE for model pricing across client and router.
// Edit rates HERE ONLY; src/pricingRegistry.ts and
// supabase/functions/router/pricing_registry.ts re-export this module. The
// pricing_freshness test guards version/date freshness, and the PX02
// X-Prismatix-Tariff release header lets the client detect deploy-time skew.
// asOfDate policy: first-party rates carry the audit date; anything else is
// isEstimated: true until verified.

export const MODEL_TARIFF_VERSION = '2026-10-06-v8' as const;

export interface TariffEntry {
  asOfDate?: number | string | boolean;
  cachedReadRatePer1M?: number | string | boolean;
  cachedWriteRatePer1M?: number | string | boolean;
  inputRatePer1M?: number | string | boolean;
  isEligibleForAutoRouting?: number | string | boolean;
  isEstimated?: number | string | boolean;
  longContextCachedReadRatePer1M?: number | string | boolean;
  longContextCachedWriteRatePer1M?: number | string | boolean;
  longContextInputRatePer1M?: number | string | boolean;
  longContextOutputRatePer1M?: number | string | boolean;
  longContextThreshold?: number | string | boolean;
  offPeakCachedReadRatePer1M?: number | string | boolean;
  offPeakInputRatePer1M?: number | string | boolean;
  offPeakOutputRatePer1M?: number | string | boolean;
  outputRatePer1M?: number | string | boolean;
  reasoningRatePer1M?: number | string | boolean;
  sourceRef?: number | string | boolean;
}

export const MODEL_TARIFF: Record<string, TariffEntry> = {
  'claude-3-5-haiku': {
    inputRatePer1M: 0.8,
    outputRatePer1M: 4.0,
    asOfDate: '2026-04-13',
    sourceRef: 'anthropic-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-3-5-sonnet': {
    inputRatePer1M: 3.0,
    outputRatePer1M: 15.0,
    asOfDate: '2026-04-13',
    sourceRef: 'anthropic-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-3-opus': {
    inputRatePer1M: 15.0,
    outputRatePer1M: 75.0,
    asOfDate: '2026-04-13',
    sourceRef: 'anthropic-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-haiku-4-5': {
    inputRatePer1M: 1.0,
    outputRatePer1M: 5.0,
    cachedReadRatePer1M: 0.1,
    cachedWriteRatePer1M: 1.25,
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-opus-5': {
    inputRatePer1M: 5.0,
    outputRatePer1M: 25.0,
    cachedReadRatePer1M: 0.5,
    cachedWriteRatePer1M: 6.25,
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-opus-5-5': {
    inputRatePer1M: 4.0,
    outputRatePer1M: 20.0,
    cachedReadRatePer1M: 0.4,
    cachedWriteRatePer1M: 5.0,
    asOfDate: '2026-10-06',
    sourceRef: 'anthropic-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-sonnet-5': {
    inputRatePer1M: 2.0,
    outputRatePer1M: 10.0,
    cachedReadRatePer1M: 0.2,
    cachedWriteRatePer1M: 2.5,
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'claude-sonnet-5-5': {
    inputRatePer1M: 2.0,
    outputRatePer1M: 10.0,
    cachedReadRatePer1M: 0.2,
    cachedWriteRatePer1M: 2.5,
    asOfDate: '2026-10-06',
    sourceRef: 'anthropic-official',
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
  // Rate card pending first-party verification; estimated at V4 Flash tier.
  'deepseek-v4-1-flash': {
    inputRatePer1M: 0.44,
    outputRatePer1M: 1.32,
    cachedReadRatePer1M: 0.014,
    asOfDate: '2026-10-06',
    sourceRef: 'deepseek-estimate',
    isEstimated: true,
    isEligibleForAutoRouting: true,
  },
  // DeepSeek V4 Flash: peak rate is the conservative routing ceiling; the
  // off-peak window (16:30-08:30 UTC, see isDeepSeekOffPeak) bills roughly half.
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
  'deepseek-v4-flash-free': {
    inputRatePer1M: 0.0,
    outputRatePer1M: 0.0,
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-free',
    isEstimated: false,
    isEligibleForAutoRouting: false,
  },
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
  'gemini-2.0-flash': {
    inputRatePer1M: 0.1,
    outputRatePer1M: 0.4,
    asOfDate: '2026-04-13',
    sourceRef: 'google-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-2.5-flash': {
    inputRatePer1M: 0.075,
    outputRatePer1M: 0.3,
    asOfDate: '2026-04-13',
    sourceRef: 'google-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-2.5-pro': {
    inputRatePer1M: 1.25,
    outputRatePer1M: 5.0,
    asOfDate: '2026-04-13',
    sourceRef: 'google-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-3-flash': {
    inputRatePer1M: 0.075,
    outputRatePer1M: 0.3,
    asOfDate: '2026-04-13',
    sourceRef: 'google-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-3.1-pro': {
    inputRatePer1M: 1.25,
    outputRatePer1M: 5.0,
    asOfDate: '2026-04-13',
    sourceRef: 'google-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gemini-3.7-flash': {
    inputRatePer1M: 1.5,
    outputRatePer1M: 7.5,
    cachedReadRatePer1M: 0.05,
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  // Gemini 3.8 Flash: intro rates effective through 2026-12-31; scheduled to
  // double on 2027-01-01 — re-verify before that date.
  'gemini-3.8-flash': {
    inputRatePer1M: 0.75,
    outputRatePer1M: 3.75,
    cachedReadRatePer1M: 0.075,
    asOfDate: '2026-10-06',
    sourceRef: 'google-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-4o': {
    inputRatePer1M: 2.5,
    outputRatePer1M: 10.0,
    asOfDate: '2026-04-13',
    sourceRef: 'openai-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-4o-mini': {
    inputRatePer1M: 0.15,
    outputRatePer1M: 0.6,
    asOfDate: '2026-04-13',
    sourceRef: 'openai-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-5.6-luna': {
    inputRatePer1M: 0.2,
    outputRatePer1M: 1.2,
    cachedReadRatePer1M: 0.02,
    cachedWriteRatePer1M: 0.25,
    longContextThreshold: 272000,
    longContextInputRatePer1M: 0.4,
    longContextOutputRatePer1M: 1.8,
    longContextCachedReadRatePer1M: 0.04,
    longContextCachedWriteRatePer1M: 0.5,
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-5.6-sol': {
    inputRatePer1M: 5.0,
    outputRatePer1M: 30.0,
    cachedReadRatePer1M: 0.5,
    cachedWriteRatePer1M: 6.25,
    longContextThreshold: 272000,
    longContextInputRatePer1M: 10.0,
    longContextOutputRatePer1M: 45.0,
    longContextCachedReadRatePer1M: 1.0,
    longContextCachedWriteRatePer1M: 12.5,
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-5.6-terra': {
    inputRatePer1M: 2.0,
    outputRatePer1M: 12.0,
    cachedReadRatePer1M: 0.2,
    cachedWriteRatePer1M: 2.5,
    longContextThreshold: 272000,
    longContextInputRatePer1M: 4.0,
    longContextOutputRatePer1M: 18.0,
    longContextCachedReadRatePer1M: 0.4,
    longContextCachedWriteRatePer1M: 5.0,
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-6-luna': {
    inputRatePer1M: 0.1,
    outputRatePer1M: 0.5,
    cachedReadRatePer1M: 0.0125,
    cachedWriteRatePer1M: 0.125,
    asOfDate: '2026-10-06',
    sourceRef: 'openai-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'gpt-6-sol': {
    inputRatePer1M: 2.0,
    outputRatePer1M: 10.0,
    cachedReadRatePer1M: 0.2,
    cachedWriteRatePer1M: 2.5,
    asOfDate: '2026-10-06',
    sourceRef: 'openai-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'grok-4.6': {
    inputRatePer1M: 2.0,
    outputRatePer1M: 6.0,
    cachedReadRatePer1M: 0.5,
    longContextThreshold: 200000,
    longContextInputRatePer1M: 4.0,
    longContextOutputRatePer1M: 12.0,
    longContextCachedReadRatePer1M: 1.0,
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-official',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'haiku-4.5': {
    inputRatePer1M: 0.8,
    outputRatePer1M: 4.0,
    asOfDate: '2026-04-13',
    sourceRef: 'anthropic-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'mimo-v2.5-free': {
    inputRatePer1M: 0.0,
    outputRatePer1M: 0.0,
    asOfDate: '2026-08-16',
    sourceRef: 'opencode-zen-free',
    isEstimated: false,
    isEligibleForAutoRouting: false,
  },
  'o3-mini': {
    inputRatePer1M: 1.1,
    outputRatePer1M: 4.4,
    reasoningRatePer1M: 4.4,
    asOfDate: '2026-04-13',
    sourceRef: 'openai-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'opus-4.6': {
    inputRatePer1M: 15.0,
    outputRatePer1M: 75.0,
    asOfDate: '2026-04-13',
    sourceRef: 'anthropic-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
  'sonnet-4.6': {
    inputRatePer1M: 3.0,
    outputRatePer1M: 15.0,
    asOfDate: '2026-04-13',
    sourceRef: 'anthropic-pricing',
    isEstimated: false,
    isEligibleForAutoRouting: true,
  },
};
