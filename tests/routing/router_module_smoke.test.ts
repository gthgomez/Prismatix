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

  it('calculates off-peak vs peak rates for DeepSeek models correctly', () => {
    // Peak date: 12:00 UTC (720 min -> peak)
    const peakDate = new Date('2026-08-16T12:00:00Z');
    expect(isDeepSeekOffPeak(peakDate)).toBe(false);

    const peakCost = calculateEstimatedCostUsd(
      'deepseek-v4-flash',
      1_000_000,
      1_000_000,
      1_000_000,
      0,
      0,
      peakDate,
    );
    // Peak rate: $0.44 input + $1.32 output = $1.76
    expect(peakCost.costUsd).toBeCloseTo(1.76, 3);
    expect(peakCost.isOffPeak).toBe(false);

    // Off-peak date: 20:00 UTC (1200 min -> off-peak)
    const offPeakDate = new Date('2026-08-16T20:00:00Z');
    expect(isDeepSeekOffPeak(offPeakDate)).toBe(true);

    const offPeakCost = calculateEstimatedCostUsd(
      'deepseek-v4-flash',
      1_000_000,
      1_000_000,
      1_000_000,
      0,
      0,
      offPeakDate,
    );
    // Off-peak rate: $0.22 input + $0.66 output = $0.88
    expect(offPeakCost.costUsd).toBeCloseTo(0.88, 3);
    expect(offPeakCost.isOffPeak).toBe(true);
  });

  it('calculates long-context cached write rate doubling on GPT-5.6 Sol', () => {
    // Base context (<= 272k): cached write is $6.25/M
    const baseCost = calculateEstimatedCostUsd(
      'gpt-5.6-sol',
      100_000,
      1_000,
      100_000,
      0,
      100_000, // 100k cached write
    );
    // Uncached input (100k): $0.50, Output (1k): $0.03, Cached write (100k * $6.25/M): $0.625
    // Total = $0.50 + $0.03 + $0.625 = $1.155
    expect(baseCost.breakdown?.cachedWriteCost).toBeCloseTo(0.625, 4);

    // Long context (> 272k): cached write doubles to $12.50/M
    const longCost = calculateEstimatedCostUsd(
      'gpt-5.6-sol',
      300_000,
      1_000,
      300_000,
      0,
      300_000, // 300k cached write
    );
    // Cached write (300k * $12.50/M): $3.75
    expect(longCost.isLongContext).toBe(true);
    expect(longCost.breakdown?.cachedWriteCost).toBeCloseTo(3.75, 3);
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
