export interface BudgetDecision {
  blocked: boolean;
  requiresConfirm: boolean;
  reason?: string;
}

export function evaluateBudget(params: {
  estimateUsd: number;
  dailyTotalUsd: number;
  dailyLimitUsd: number;
}): BudgetDecision {
  const estimateUsd = Math.max(0, params.estimateUsd);
  const dailyTotalUsd = Math.max(0, params.dailyTotalUsd);
  const dailyLimitUsd = Math.max(0, params.dailyLimitUsd);

  if (dailyTotalUsd + estimateUsd > dailyLimitUsd) {
    return {
      blocked: true,
      requiresConfirm: false,
      reason: `Daily budget exceeded ($${dailyTotalUsd.toFixed(2)} + $${estimateUsd.toFixed(2)} > $${dailyLimitUsd.toFixed(2)}). Try Gemini 3 Flash.`,
    };
  }

  if (estimateUsd > 0.5) {
    return { blocked: false, requiresConfirm: true };
  }

  return { blocked: false, requiresConfirm: false };
}
