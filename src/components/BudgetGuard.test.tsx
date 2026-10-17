import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BudgetGuard } from './BudgetGuard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('BudgetGuard component', () => {
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container) {
      document.body.removeChild(container);
      container = null;
    }
  });

  it('renders nothing when isOpen is false', async () => {
    const root = createRoot(container!);
    await act(async () => {
      root.render(
        <BudgetGuard
          isOpen={false}
          estimateUsd={0.75}
          dailyTotalUsd={2.0}
          dailyLimitUsd={10.0}
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      );
    });

    expect(container?.querySelector('.budget-guard-overlay')).toBeNull();
    expect(container?.querySelector('.budget-guard-modal')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('renders modal dialog with accessible labels, cost values, and triggers callbacks', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    const root = createRoot(container!);
    await act(async () => {
      root.render(
        <BudgetGuard
          isOpen={true}
          estimateUsd={0.75}
          dailyTotalUsd={2.0}
          dailyLimitUsd={10.0}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      );
    });

    const overlay = container?.querySelector('.budget-guard-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute('role')).toBe('dialog');
    expect(overlay?.getAttribute('aria-modal')).toBe('true');
    expect(overlay?.getAttribute('aria-labelledby')).toBe('budget-guard-title');

    const heading = container?.querySelector('#budget-guard-title');
    expect(heading?.textContent).toContain('High-Cost Message Warning');

    const modal = container?.querySelector('.budget-guard-modal');
    expect(modal?.textContent).toContain('$0.7500');
    expect(modal?.textContent).toContain('$2.7500');
    expect(modal?.textContent).toContain('$10.00');

    const cancelBtn = container?.querySelector('.budget-guard-btn-cancel') as HTMLButtonElement;
    const confirmBtn = container?.querySelector('.budget-guard-btn-confirm') as HTMLButtonElement;
    expect(cancelBtn).not.toBeNull();
    expect(confirmBtn).not.toBeNull();
    expect(document.activeElement).toBe(cancelBtn);

    await act(async () => {
      cancelBtn.click();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);

    await act(async () => {
      confirmBtn.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('dismisses modal on Escape key press', async () => {
    const onCancel = vi.fn();
    const root = createRoot(container!);

    await act(async () => {
      root.render(
        <BudgetGuard
          isOpen={true}
          estimateUsd={0.6}
          dailyTotalUsd={1.0}
          dailyLimitUsd={10.0}
          onCancel={onCancel}
          onConfirm={vi.fn()}
        />
      );
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onCancel).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('dismisses modal on overlay backdrop click, but not on inner modal click', async () => {
    const onCancel = vi.fn();
    const root = createRoot(container!);

    await act(async () => {
      root.render(
        <BudgetGuard
          isOpen={true}
          estimateUsd={0.6}
          dailyTotalUsd={1.0}
          dailyLimitUsd={10.0}
          onCancel={onCancel}
          onConfirm={vi.fn()}
        />
      );
    });

    const overlay = container?.querySelector('.budget-guard-overlay') as HTMLDivElement;
    const modal = container?.querySelector('.budget-guard-modal') as HTMLDivElement;

    await act(async () => {
      modal.click();
    });
    expect(onCancel).not.toHaveBeenCalled();

    await act(async () => {
      overlay.click();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('restores focus to previously active element upon closing', async () => {
    const triggerBtn = document.createElement('button');
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();
    expect(document.activeElement).toBe(triggerBtn);

    const root = createRoot(container!);
    await act(async () => {
      root.render(
        <BudgetGuard
          isOpen={true}
          estimateUsd={0.5}
          dailyTotalUsd={1.0}
          dailyLimitUsd={10.0}
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      );
    });

    const cancelBtn = container?.querySelector('.budget-guard-btn-cancel') as HTMLElement;
    expect(document.activeElement).toBe(cancelBtn);

    // Unmount modal (close)
    await act(async () => {
      root.unmount();
    });

    expect(document.activeElement).toBe(triggerBtn);
    triggerBtn.remove();
  });

  it('traps Tab focus within modal bounds in both directions', async () => {
    const root = createRoot(container!);
    await act(async () => {
      root.render(
        <BudgetGuard
          isOpen={true}
          estimateUsd={0.5}
          dailyTotalUsd={1.0}
          dailyLimitUsd={10.0}
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      );
    });

    const cancelBtn = container?.querySelector('.budget-guard-btn-cancel') as HTMLElement;
    const confirmBtn = container?.querySelector('.budget-guard-btn-confirm') as HTMLElement;
    expect(cancelBtn).not.toBeNull();
    expect(confirmBtn).not.toBeNull();

    // Focus last button and press Tab -> should wrap to first button (cancel)
    confirmBtn.focus();
    expect(document.activeElement).toBe(confirmBtn);

    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    window.dispatchEvent(tabEvent);
    expect(document.activeElement).toBe(cancelBtn);

    // Focus first button and press Shift+Tab -> should wrap to last button (confirm)
    cancelBtn.focus();
    const shiftTabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(shiftTabEvent);
    expect(document.activeElement).toBe(confirmBtn);

    await act(async () => {
      root.unmount();
    });
  });
});
