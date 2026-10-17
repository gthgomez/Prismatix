// src/components/ScrollToBottomButton.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ScrollToBottomButton } from './ScrollToBottomButton';

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

describe('ScrollToBottomButton', () => {
  it('renders nothing when visible is false', () => {
    root = render(
      <ScrollToBottomButton
        visible={false}
        onClick={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders standard jump button when visible is true and not streaming', () => {
    const onClick = vi.fn();
    root = render(
      <ScrollToBottomButton
        visible={true}
        isStreaming={false}
        onClick={onClick}
      />,
    );

    const btn = container.querySelector<HTMLButtonElement>('.scroll-to-bottom-btn');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toContain('Jump to latest');
    expect(btn?.classList.contains('is-streaming')).toBe(false);

    act(() => {
      btn?.click();
    });
    expect(onClick).toHaveBeenCalled();
  });

  it('renders pulse dot and streaming label when isStreaming is true', () => {
    const onClick = vi.fn();
    root = render(
      <ScrollToBottomButton
        visible={true}
        isStreaming={true}
        onClick={onClick}
      />,
    );

    const btn = container.querySelector<HTMLButtonElement>('.scroll-to-bottom-btn');
    expect(btn).not.toBeNull();
    expect(btn?.classList.contains('is-streaming')).toBe(true);
    expect(btn?.textContent).toContain('Streaming response...');

    const pulse = container.querySelector('.scroll-stream-pulse');
    expect(pulse).not.toBeNull();
  });
});
