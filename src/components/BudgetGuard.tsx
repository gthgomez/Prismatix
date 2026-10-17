import React, { useEffect, useRef } from 'react';
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
  const modalRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelBtnRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onCancelRef.current();
        return;
      }
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === modalRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className='budget-guard-overlay'
      role='dialog'
      aria-modal='true'
      aria-labelledby='budget-guard-title'
      onClick={onCancel}
    >
      <div
        ref={modalRef}
        className='budget-guard-modal'
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id='budget-guard-title'>
          <span aria-hidden='true'>⚠️ </span>High-Cost Message Warning
        </h3>
        <p>This request is estimated at <strong>${estimateUsd.toFixed(4)}</strong>.</p>
        <p>Daily spend after send: ${(dailyTotalUsd + estimateUsd).toFixed(4)} / ${dailyLimitUsd.toFixed(2)}</p>
        <div className='budget-guard-actions'>
          <button
            ref={cancelBtnRef}
            type='button'
            className='budget-guard-btn-cancel'
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type='button'
            className='budget-guard-btn-confirm'
            onClick={onConfirm}
          >
            Send Anyway
          </button>
        </div>
      </div>
    </div>
  );
};
