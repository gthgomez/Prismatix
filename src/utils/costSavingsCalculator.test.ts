import { describe, expect, it } from 'vitest';
import { computeCostSavings, FRONTIER_BASELINE_MODEL } from './costSavingsCalculator';

describe('costSavingsCalculator', () => {
  it('identifies the frontier baseline model', () => {
    expect(FRONTIER_BASELINE_MODEL).toBe('gpt-6-sol');
  });

  it('computes savings correctly when using an economy model', () => {
    const analysis = computeCostSavings({
      model: 'gemini-3.8-flash',
      costUsd: 0.0002,
      promptTokens: 1000,
      completionTokens: 500,
      durationMs: 1000,
    });

    expect(analysis.model).toBe('gemini-3.8-flash');
    expect(analysis.promptTokens).toBe(1000);
    expect(analysis.completionTokens).toBe(500);
    expect(analysis.totalTokens).toBe(1500);
    expect(analysis.actualCostUsd).toBe(0.0002);
    expect(analysis.baselineCostUsd).toBeGreaterThan(0.0002);
    expect(analysis.savingsUsd).toBeGreaterThan(0);
    expect(analysis.savingsPercent).toBeGreaterThan(50);
    expect(analysis.tokensPerSec).toBe(500);
    expect(analysis.isSettled).toBe(true);
  });

  it('approximates completion tokens from content if completionTokens is omitted', () => {
    const text = 'a'.repeat(400); // 100 tokens approx
    const analysis = computeCostSavings({
      model: 'deepseek-v4-pro',
      costUsd: 0.001,
      promptTokens: 200,
      content: text,
      durationMs: 2000,
    });

    expect(analysis.completionTokens).toBe(100);
    expect(analysis.totalTokens).toBe(300);
    expect(analysis.tokensPerSec).toBe(50);
  });

  it('handles zero or missing values gracefully without NaN', () => {
    const analysis = computeCostSavings({});

    expect(analysis.promptTokens).toBe(0);
    expect(analysis.completionTokens).toBe(0);
    expect(analysis.totalTokens).toBe(0);
    expect(analysis.actualCostUsd).toBe(0);
    expect(analysis.baselineCostUsd).toBe(0);
    expect(analysis.savingsUsd).toBe(0);
    expect(analysis.savingsPercent).toBe(0);
    expect(analysis.tokensPerSec).toBeUndefined();
    expect(analysis.isSettled).toBe(false);
  });
});
