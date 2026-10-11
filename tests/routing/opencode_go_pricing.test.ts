import { afterEach, expect, it } from 'vitest';
import { configureOpenCodePricing, getModelPricing, PRICING_REGISTRY } from '../../supabase/functions/router/pricing_registry';

afterEach(() => configureOpenCodePricing('https://opencode.ai/zen/v1'));

it('uses Go peak rates for admission rather than the lower Zen tariff', () => {
  configureOpenCodePricing('https://opencode.ai/zen/go/v1');
  expect(getModelPricing('deepseek-v4-flash').outputRatePer1M).toBe(1.2);
  expect(getModelPricing('deepseek-v4-pro').outputRatePer1M).toBe(3.96);
  expect(getModelPricing('qwen-3.8-flash').outputRatePer1M).toBe(0.47);
  expect(getModelPricing('mimo-2.6-flash').outputRatePer1M).toBe(0.28);
  expect(getModelPricing('deepseek-v4-flash').isEstimated).toBe(true);
});

it('keeps the Zen tariff when Go is not selected and preserves unknown-price denial', () => {
  configureOpenCodePricing('https://opencode.ai/zen/v1');
  expect(getModelPricing('deepseek-v4-flash').outputRatePer1M)
    .toBe(PRICING_REGISTRY['deepseek-v4-flash']!.outputRatePer1M);
  expect(getModelPricing('unregistered-model').isUnknown).toBe(true);
});
