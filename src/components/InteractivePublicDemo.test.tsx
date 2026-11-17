import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractivePublicDemo } from './InteractivePublicDemo';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('InteractivePublicDemo', () => {
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

  it('renders default scenario, auto-routing explanation, and synthetic disclaimer in static mode', async () => {
    const root = createRoot(container!);
    await act(async () => {
      root.render(<InteractivePublicDemo autoplay={false} />);
    });

    expect(container?.textContent).toContain('Experience Adaptive Routing Interactive Preview');
    expect(container?.textContent).toContain('Prerecorded Interactive Preview · Synthetic Data');
    expect(container?.textContent).toContain('DeepSeek V4 Pro');
    expect(container?.textContent).toContain('Strong (high reasoning)');
    expect(container?.textContent).toContain('Synthetic Cost:');
    expect(container?.textContent).toContain('Calibrated OpenCode Tariff');
    // Content is pre-rendered for accessibility
    expect(container?.textContent).toContain('Resilient Event Processor Architecture');

    await act(async () => {
      root.unmount();
    });
  });

  it('switches scenarios when tab buttons are clicked', async () => {
    const root = createRoot(container!);
    await act(async () => {
      root.render(<InteractivePublicDemo autoplay={false} />);
    });

    const fastPathTab = container?.querySelector('button[role="tab"]:nth-of-type(2)') as HTMLButtonElement | null;
    expect(fastPathTab).not.toBeNull();

    await act(async () => {
      fastPathTab?.click();
    });

    expect(container?.textContent).toContain('Gemini 3.8 Flash');
    expect(container?.textContent).toContain('Economy (fast path)');
    expect(container?.textContent).toContain('Summarize the core difference between optimistic and pessimistic locking');

    await act(async () => {
      root.unmount();
    });
  });

  it('supports roving keyboard tabs, wrapping, Home/End, selected state, and focus reveal', async () => {
    const root = createRoot(container!);
    await act(async () => root.render(<InteractivePublicDemo autoplay={false} />));
    const tabs = Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    const reveal = vi.fn();
    tabs[1]!.scrollIntoView = reveal;
    tabs[0]!.focus();

    await act(async () => tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]!.tabIndex).toBe(0);
    expect(tabs[1]).toBe(document.activeElement);
    expect(reveal).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(container!.textContent).toContain('Gemini 3.8 Flash');

    await act(async () => tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    expect(tabs[2]!.getAttribute('aria-selected')).toBe('true');
    await act(async () => tabs[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    await act(async () => tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })));
    expect(tabs[2]!.getAttribute('aria-selected')).toBe('true');
    await act(async () => tabs[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })));
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(container!.textContent).toContain('Synthetic Data');
    await act(async () => root.unmount());
  });

  it('allows clicking Reset to clear and Replay to stream', async () => {
    const root = createRoot(container!);
    await act(async () => {
      root.render(<InteractivePublicDemo autoplay={false} />);
    });

    const buttons = Array.from(container?.querySelectorAll('.demo-control-btn') || []) as HTMLButtonElement[];
    const resetBtn = buttons.find((b) => b.textContent?.trim() === 'Reset');
    expect(resetBtn).toBeDefined();

    await act(async () => {
      resetBtn?.click();
    });

    expect(container?.textContent).toContain('(Click play to stream response...)');

    await act(async () => {
      root.unmount();
    });
  });
});
