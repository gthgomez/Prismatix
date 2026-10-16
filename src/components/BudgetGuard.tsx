import React from 'react';
export type { BudgetDecision } from '../utils/budgetEvaluator';

export interface BudgetGuardProps {
  isOpen: boolean;
  estimateUsd: number;
  dailyTotalUsd: number;
  dailyLimitUsd: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export const BudgetGuard: React.FC<BudgetGuardProps> = ({
  isOpen,
  estimateUsd,
  dailyTotalUsd,
  dailyLimitUsd,
  onCancel,
  onConfirm,
}) => {
  if (!isOpen) return null;

  return (
    <div className='budget-guard-overlay' role='dialog' aria-modal='true' aria-labelledby='budget-guard-title'>
      <div className='budget-guard-modal'>
        <h3 id='budget-guard-title'>⚠️ High-Cost Message Warning</h3>
        <p>This request is estimated at <strong>${estimateUsd.toFixed(4)}</strong>.</p>
        <p>Daily spend after send: ${(dailyTotalUsd + estimateUsd).toFixed(4)} / ${dailyLimitUsd.toFixed(2)}</p>
        <div className='budget-guard-actions'>
          <button type='button' className='budget-guard-btn-cancel' onClick={onCancel}>Cancel</button>
          <button type='button' className='budget-guard-btn-confirm' onClick={onConfirm}>Send Anyway</button>
        </div>
      </div>
    </div>
  );
};
