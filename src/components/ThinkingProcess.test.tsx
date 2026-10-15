// src/components/ThinkingProcess.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ThinkingProcess } from './ThinkingProcess';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container.remove();
  root = null;
  vi.restoreAllMocks();
});

function render(ui: React.ReactNode): Root {
  const r = createRoot(container);
  act(() => {
    r.render(ui);
  });
  return r;
}

describe('ThinkingProcess', () => {
  it('returns null when thoughts are empty and not streaming', () => {
    root = render(<ThinkingProcess thoughts={[]} isStreaming={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when thoughts are empty even if isStreaming is true', () => {
    root = render(<ThinkingProcess thoughts={[]} isStreaming={true} />);
    expect(container.firstChild).toBeNull();
  });

  it('keeps streaming timer running without tearing down interval on token updates', () => {
    vi.useFakeTimers();
    try {
      root = render(
        <ThinkingProcess
          thoughts={['Initial thought']}
          elapsedMs={1000}
          isStreaming={true}
        />,
      );

      const header = container.querySelector<HTMLButtonElement>('.thinking-process-header');
      expect(header).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Update with new token chunk and new elapsedMs
      act(() => {
        root!.render(
          <ThinkingProcess
            thoughts={['Initial thought', ' continuing...']}
            elapsedMs={1500}
            isStreaming={true}
          />,
        );
      });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Streaming header displays live ticking elapsed time
      expect(header?.textContent).toMatch(/Thinking \(\d+\.\d+s\)/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders thinking process header with elapsed time and toggles content', () => {
    root = render(
      <ThinkingProcess
        thoughts={['Step 1: Analyze problem', '\nStep 2: Formulate solution']}
        elapsedMs={3500}
        isStreaming={false}
      />,
    );

    const header = container.querySelector<HTMLButtonElement>('.thinking-process-header');
    expect(header).not.toBeNull();
    expect(header?.textContent).toContain('Thought process (3.5s)');

    // Initially collapsed when not streaming
    expect(container.querySelector('.thinking-process-content')).toBeNull();

    // Click to expand
    act(() => {
      header?.click();
    });

    const content = container.querySelector('.thinking-process-content');
    expect(content).not.toBeNull();
    expect(content?.textContent).toContain('Step 1: Analyze problem');

    // Click again to collapse
    act(() => {
      header?.click();
    });
    expect(container.querySelector('.thinking-process-content')).toBeNull();
  });

  it('renders live pulsating beacon when streaming', () => {
    root = render(
      <ThinkingProcess
        thoughts={['Reasoning step...']}
        isStreaming={true}
      />,
    );

    const beacon = container.querySelector('.thinking-beacon');
    expect(beacon).not.toBeNull();
    expect(container.querySelector('.thinking-title')?.textContent).toContain('Thinking');

    // Automatically expanded during streaming
    const content = container.querySelector('.thinking-process-content');
    expect(content).not.toBeNull();
  });

  it('copies thoughts to clipboard on copy click', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    root = render(
      <ThinkingProcess
        thoughts={['Analyzing query...', '\nVerifying constraints']}
        elapsedMs={1200}
        isStreaming={true}
      />,
    );

    const copyBtn = container.querySelector<HTMLElement>('.thinking-copy-btn');
    expect(copyBtn).not.toBeNull();
    expect(copyBtn?.tagName).toBe('BUTTON');

    const header = container.querySelector<HTMLButtonElement>('.thinking-process-header');
    expect(header).not.toBeNull();
    expect(header?.contains(copyBtn)).toBe(false);

    await act(async () => {
      copyBtn?.click();
    });

    expect(writeTextMock).toHaveBeenCalledWith('Analyzing query...\nVerifying constraints');
    expect(copyBtn?.textContent).toContain('Copied');
  });
});
