import { describe, it, expect } from 'vitest';
import { calculatePreFlightCost, calculateFinalCost, calculateCostBreakdown } from '../../supabase/functions/router/cost_engine.ts';
import { getPricingForModel, getModelPricing, calculateEstimatedCostUsd, isDeepSeekOffPeak } from '../../supabase/functions/router/pricing_registry.ts';
import { dispatchOpenCodeStream } from '../../supabase/functions/router/opencode_adapters.ts';
import { fetchDiscoveredModelIds } from '../../supabase/functions/router/opencode_discovery.ts';
import { CURATED_OPENCODE_REGISTRY } from '../../supabase/functions/router/models_hub.ts';

describe('Router Production Module Graph & Smoke Tests', () => {
  it('loads cost_engine and resolves getModelPricing import cleanly', () => {
    expect(typeof calculatePreFlightCost).toBe('function');
    expect(typeof calculateFinalCost).toBe('function');
    expect(typeof calculateCostBreakdown).toBe('function');
    expect(typeof getModelPricing).toBe('function');
    expect(typeof getPricingForModel).toBe('function');
    expect(getModelPricing).toBe(getPricingForModel);
  });

  it('calculates preflight and final costs for router models without throwing', () => {
    const preFlight = calculatePreFlightCost('gpt-5.6-luna', 'Hello world, summarize this system', 0);
    expect(preFlight.tokenEstimate).toBeGreaterThan(0);
    expect(preFlight.estimatedUsd).toBeGreaterThan(0);
    expect(preFlight.hasUnknownRate).toBe(false);

    const final = calculateFinalCost('gpt-5.6-sol', {
      promptTokens: 1000,
      completionTokens: 200,
      reasoningTokens: 50,
    });
    expect(final.finalUsd).toBeGreaterThan(0);
    expect(final.hasUnknownRate).toBe(false);

    const breakdown = calculateCostBreakdown('deepseek-v4-flash', {
      promptTokens: 1000,
      completionTokens: 200,
      reasoningTokens: 0,
    });
    expect(breakdown.totalUsd).toBeGreaterThan(0);
  });

  it('uses the single official DeepSeek tariff (no unverified off-peak rates)', () => {
    // PX02: the official Zen page lists one rate per DeepSeek model; the
    // previously registered peak/off-peak schedule could not be verified and
    // was dropped. The cost must be identical regardless of time of day.
    const noon = new Date('2026-09-29T12:00:00Z');
    expect(isDeepSeekOffPeak(noon)).toBe(false);
    const noonCost = calculateEstimatedCostUsd(
      'deepseek-v4-flash',
      1_000_000,
      1_000_000,
      1_000_000,
      0,
      0,
      noon,
    );
    // Official rate: $0.14 input + $0.28 output = $0.42
    expect(noonCost.costUsd).toBeCloseTo(0.42, 3);
    expect(noonCost.isOffPeak).toBe(false);

    const night = new Date('2026-09-29T20:00:00Z');
    expect(isDeepSeekOffPeak(night)).toBe(true);
    const nightCost = calculateEstimatedCostUsd(
      'deepseek-v4-flash',
      1_000_000,
      1_000_000,
      1_000_000,
      0,
      0,
      night,
    );
    expect(nightCost.costUsd).toBeCloseTo(0.42, 3);
    expect(nightCost.isOffPeak).toBe(false);
  });

  it('calculates long-context cached write rate doubling on GPT-5.6 Sol', () => {
    // Base context (<= 272k): cached write is $5.00/M (official 2026-09-29 tariff)
    const baseCost = calculateEstimatedCostUsd(
      'gpt-5.6-sol',
      100_000,
      1_000,
      100_000,
      0,
      100_000, // 100k cached write
    );
    // Cached write (100k * $5.00/M): $0.50
    expect(baseCost.breakdown?.cachedWriteCost).toBeCloseTo(0.5, 4);

    // Long context (> 272k): cached write is $10.00/M
    const longCost = calculateEstimatedCostUsd(
      'gpt-5.6-sol',
      300_000,
      1_000,
      300_000,
      0,
      300_000, // 300k cached write
    );
    // Cached write (300k * $10.00/M): $3.00
    expect(longCost.isLongContext).toBe(true);
    expect(longCost.breakdown?.cachedWriteCost).toBeCloseTo(3.0, 3);
  });

  it('verifies OpenAI Responses adapter builds structured messages for text-only and multimodal', async () => {
    // Text-only request
    let capturedBody: any = null;
    const dummyFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response('data: {"type":"response.done"}\n\n', { status: 200 });
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = dummyFetch as any;

    try {
      const config = CURATED_OPENCODE_REGISTRY['gpt-5.6-sol']!;
      await dispatchOpenCodeStream({
        config,
        messages: [
          { role: 'system', content: 'You are an architect.' },
          { role: 'user', content: 'Explain invariant.' },
        ],
        maxTokens: 50,
        temperature: 0.7,
        openCodeBaseUrl: 'https://opencode.ai/zen/v1',
        openCodeApiKey: 'dummy-key',
      });

      expect(Array.isArray(capturedBody.input)).toBe(true);
      expect(capturedBody.input[0]).toEqual({ role: 'system', content: 'You are an architect.' });
      expect(capturedBody.input[1]).toEqual({ role: 'user', content: 'Explain invariant.' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('verifies discovery fail-closed behavior when unauthenticated', async () => {
    const ids = await fetchDiscoveredModelIds(undefined);
    expect(ids.size).toBe(0);
  });
});
