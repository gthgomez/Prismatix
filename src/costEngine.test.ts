import { describe, expect, it } from 'vitest';
import { PRICING_REGISTRY, PRICING_VERSION } from './pricingRegistry';
import {
  calculateCostBreakdown,
  calculateFinalCost,
  calculatePreFlightCost,
  estimateTokenCount,
} from './costEngine';

describe('estimateTokenCount', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  it('returns 0 for falsy input', () => {
    // @ts-expect-error testing runtime edge case
    expect(estimateTokenCount(null)).toBe(0);
  });

  it('returns a positive number for any non-empty text', () => {
    expect(estimateTokenCount('hello world')).toBeGreaterThan(0);
  });

  it('produces higher estimates for longer text', () => {
    const short = estimateTokenCount('hello world');
    const long = estimateTokenCount('hello world '.repeat(100));
    expect(long).toBeGreaterThan(short);
  });

  it('single word produces at least 1 token', () => {
    expect(estimateTokenCount('hello')).toBeGreaterThanOrEqual(1);
  });
});

describe('calculatePreFlightCost', () => {
  it('returns the correct pricing version', () => {
    const result = calculatePreFlightCost('haiku-4.5', 'hello world');
    expect(result.pricingVersion).toBe(PRICING_VERSION);
  });

  it('adds image token overhead per image', () => {
    const noImages = calculatePreFlightCost('haiku-4.5', 'describe this image', 0);
    const withImage = calculatePreFlightCost('haiku-4.5', 'describe this image', 1);
    // Each image adds 1600 tokens → expect noticeably higher token count
    expect(withImage.promptTokens - noImages.promptTokens).toBe(1600);
  });

  it('negative imageCount is treated as 0', () => {
    const noImages = calculatePreFlightCost('haiku-4.5', 'hello', 0);
    const negImages = calculatePreFlightCost('haiku-4.5', 'hello', -3);
    expect(negImages.promptTokens).toBe(noImages.promptTokens);
  });

  it('projectedOutputTokens is at least 64', () => {
    // Very short query should still yield at least 64 output tokens
    const result = calculatePreFlightCost('haiku-4.5', 'hi');
    expect(result.projectedOutputTokens).toBeGreaterThanOrEqual(64);
  });

  it('estimatedUsd is non-negative', () => {
    const result = calculatePreFlightCost('gemini-2.5-flash', 'analyze this codebase');
    expect(result.estimatedUsd).toBeGreaterThanOrEqual(0);
  });

  it('more expensive model produces higher cost for the same input', () => {
    const cheap = calculatePreFlightCost('gemini-2.5-flash', 'write me an essay');
    const expensive = calculatePreFlightCost('opus-4.6', 'write me an essay');
    expect(expensive.estimatedUsd).toBeGreaterThan(cheap.estimatedUsd);
  });

  it('uses the correct input rate for haiku-4.5', () => {
    const pricing = PRICING_REGISTRY['haiku-4.5'];
    const result = calculatePreFlightCost('haiku-4.5', 'hello world', 0);
    const expectedInput = (result.promptTokens / 1_000_000) * pricing.inputRatePer1M;
    const expectedOutput = (result.projectedOutputTokens / 1_000_000) * pricing.outputRatePer1M;
    const expectedTotal = Math.round((expectedInput + expectedOutput) * 1_000_000) / 1_000_000;
    expect(result.estimatedUsd).toBe(expectedTotal);
  });
});

describe('calculateFinalCost', () => {
  it('returns the correct pricing version', () => {
    const result = calculateFinalCost('sonnet-4.6', { promptTokens: 100, completionTokens: 50 });
    expect(result.pricingVersion).toBe(PRICING_VERSION);
  });

  it('finalUsd is 0 when all token counts are 0', () => {
    const result = calculateFinalCost('haiku-4.5', { promptTokens: 0, completionTokens: 0 });
    expect(result.finalUsd).toBe(0);
  });

  it('clamps negative token counts to 0', () => {
    const result = calculateFinalCost('haiku-4.5', { promptTokens: -100, completionTokens: -50 });
    expect(result.finalUsd).toBe(0);
  });

  it('includes reasoning tokens in cost', () => {
    const withoutReasoning = calculateFinalCost('gemini-2.5-flash', {
      promptTokens: 1000,
      completionTokens: 500,
    });
    const withReasoning = calculateFinalCost('gemini-2.5-flash', {
      promptTokens: 1000,
      completionTokens: 500,
      reasoningTokens: 1000,
    });
    expect(withReasoning.finalUsd).toBeGreaterThan(withoutReasoning.finalUsd);
  });

  it('uses outputRatePer1M as fallback when reasoningRatePer1M is undefined', () => {
    // haiku-4.5 has no reasoningRatePer1M — should not throw
    const result = calculateFinalCost('haiku-4.5', {
      promptTokens: 1000,
      completionTokens: 500,
      reasoningTokens: 200,
    });
    expect(result.finalUsd).toBeGreaterThan(0);
  });

  it('computes correct cost for known values', () => {
    // sonnet-4.6: input $3/M, output $15/M
    // 1M prompt + 1M completion = $3 + $15 = $18
    const result = calculateFinalCost('sonnet-4.6', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    });
    expect(result.finalUsd).toBeCloseTo(18, 4);
  });
});

describe('calculateCostBreakdown', () => {
  it('returns zero costs for zero usage', () => {
    const result = calculateCostBreakdown('haiku-4.5', {
      promptTokens: 0,
      completionTokens: 0,
    });
    expect(result.inputCost).toBe(0);
    expect(result.outputCost).toBe(0);
    expect(result.thinkingCost).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  it('totalCost equals sum of component costs', () => {
    const result = calculateCostBreakdown('gemini-2.5-flash', {
      promptTokens: 5000,
      completionTokens: 2000,
      thinkingTokens: 1000,
    });
    const sum = Math.round((result.inputCost + result.outputCost + result.thinkingCost) * 1_000_000) / 1_000_000;
    expect(result.totalCost).toBe(sum);
  });

  it('thinkingCost is 0 when thinkingTokens not provided', () => {
    const result = calculateCostBreakdown('sonnet-4.6', {
      promptTokens: 1000,
      completionTokens: 500,
    });
    expect(result.thinkingCost).toBe(0);
  });

  it('returns the correct pricing version', () => {
    const result = calculateCostBreakdown('opus-4.6', { promptTokens: 100, completionTokens: 50 });
    expect(result.pricingVersion).toBe(PRICING_VERSION);
  });
});
