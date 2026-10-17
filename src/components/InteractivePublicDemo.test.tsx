import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
