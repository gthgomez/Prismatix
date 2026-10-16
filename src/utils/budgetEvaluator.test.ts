import { describe, expect, it } from 'vitest';
import { evaluateBudget } from './budgetEvaluator';

describe('evaluateBudget', () => {
  it('blocks request when daily limit is exceeded', () => {
    const decision = evaluateBudget({
      estimateUsd: 1.5,
      dailyTotalUsd: 9.0,
      dailyLimitUsd: 10.0,
    });

    expect(decision.blocked).toBe(true);
    expect(decision.requiresConfirm).toBe(false);
    expect(decision.reason).toContain('Daily budget exceeded');
    expect(decision.reason).toContain('Try Gemini 3 Flash');
  });

  it('requires confirmation when estimate exceeds threshold (> $0.50) but within daily limit', () => {
    const decision = evaluateBudget({
      estimateUsd: 0.75,
      dailyTotalUsd: 2.0,
      dailyLimitUsd: 10.0,
    });

    expect(decision.blocked).toBe(false);
    expect(decision.requiresConfirm).toBe(true);
  });

  it('allows message immediately without confirmation when well within budget', () => {
    const decision = evaluateBudget({
      estimateUsd: 0.05,
      dailyTotalUsd: 1.0,
      dailyLimitUsd: 10.0,
    });

    expect(decision.blocked).toBe(false);
    expect(decision.requiresConfirm).toBe(false);
  });
});
