import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CostBadge } from './CostBadge';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('CostBadge', () => {
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

  it('renders nothing when cost is missing or undefined', async () => {
    const root = createRoot(container!);
    await act(async () => {
      root.render(<CostBadge />);
    });

    expect(container?.innerHTML).toBe('');
    await act(async () => {
      root.unmount();
    });
  });

  it('renders estimated cost with proper label and class', async () => {
    const root = createRoot(container!);
    await act(async () => {
      root.render(
        <CostBadge
          cost={{ estimatedUsd: 0.00025, pricingVersion: 'test-v1' }}
          model='gemini-3.8-flash'
        />,
      );
    });

    const badge = container?.querySelector('.message-model-override');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('$0.0003 est');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders final cost and opens intelligence popover on click', async () => {
    const root = createRoot(container!);
    await act(async () => {
      root.render(
        <CostBadge
          cost={{
            finalUsd: 0.00018,
            pricingVersion: 'test-v1',
            promptTokens: 1200,
            completionTokens: 400,
            durationMs: 800,
          }}
          model='gemini-3.8-flash'
        />,
      );
    });

    const badge = container?.querySelector('.cost-badge-interactive') as HTMLSpanElement;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('$0.0002 final');
    expect(container?.querySelector('.cost-intelligence-popover')).toBeNull();

    // Click badge to open popover
    await act(async () => {
      badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const popover = container?.querySelector('.cost-intelligence-popover');
    expect(popover).not.toBeNull();
    expect(popover?.textContent).toContain('Cost & Performance');
    expect(popover?.textContent).toContain('Final Ledger');
    expect(popover?.textContent).toContain('1,200 tok');
    expect(popover?.textContent).toContain('400 tok');
    expect(popover?.textContent).toContain('500 t/s');

    // Press Escape to dismiss
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(container?.querySelector('.cost-intelligence-popover')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
