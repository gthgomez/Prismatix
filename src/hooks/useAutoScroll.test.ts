// src/hooks/useAutoScroll.test.ts
import { describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAutoScroll, type UseAutoScrollResult } from './useAutoScroll';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function setupHook(thresholdPx = 32, buttonThresholdPx = 80) {
  const current = { result: null as unknown as UseAutoScrollResult };

  function TestComponent() {
    const res = useAutoScroll(thresholdPx, buttonThresholdPx);
    current.result = res;
    return React.createElement('div', {
      'data-stick': res.shouldStickToBottomRef.current ? '1' : '0',
      'data-btn': res.showScrollButton ? '1' : '0',
    });
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(React.createElement(TestComponent));
  });

  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };

  return {
    get result() {
      return current.result;
    },
    cleanup,
  };
}

describe('useAutoScroll', () => {
  it('initializes with shouldStickToBottom=true and showScrollButton=false', () => {
    const hook = setupHook();
    expect(hook.result.shouldStickToBottomRef.current).toBe(true);
    expect(hook.result.showScrollButton).toBe(false);
    hook.cleanup();
  });

  it('updates state when scrolled far from bottom', () => {
    const hook = setupHook(32, 80);

    const mockContainer = {
      scrollHeight: 1000,
      scrollTop: 200,
      clientHeight: 500, // distanceFromBottom = 300px > 80px
      scrollTo: vi.fn(),
    } as unknown as HTMLElement;

    act(() => {
      hook.result.updateStickyScrollState(mockContainer);
    });

    expect(hook.result.shouldStickToBottomRef.current).toBe(false);
    expect(hook.result.showScrollButton).toBe(true);

    // Scroll back near bottom (distanceFromBottom = 20px <= 32px)
    Object.assign(mockContainer, {
      scrollTop: 480,
    });

    act(() => {
      hook.result.updateStickyScrollState(mockContainer);
    });

    expect(hook.result.shouldStickToBottomRef.current).toBe(true);
    expect(hook.result.showScrollButton).toBe(false);

    hook.cleanup();
  });

  it('markUserInterruption unsets shouldStickToBottom', () => {
    const hook = setupHook();

    expect(hook.result.shouldStickToBottomRef.current).toBe(true);
    act(() => {
      hook.result.markUserInterruption();
    });
    expect(hook.result.shouldStickToBottomRef.current).toBe(false);

    hook.cleanup();
  });

  it('resetAutoScroll re-engages sticky scroll and hides scroll button', () => {
    const hook = setupHook();

    act(() => {
      hook.result.markUserInterruption();
    });
    expect(hook.result.shouldStickToBottomRef.current).toBe(false);

    act(() => {
      hook.result.resetAutoScroll();
    });
    expect(hook.result.shouldStickToBottomRef.current).toBe(true);
    expect(hook.result.showScrollButton).toBe(false);

    hook.cleanup();
  });

  it('scrollToBottom scrolls container to bottom and resets state', () => {
    const hook = setupHook();

    const scrollToMock = vi.fn();
    const mockContainer = {
      scrollHeight: 1200,
      scrollTo: scrollToMock,
    } as unknown as HTMLElement;

    act(() => {
      hook.result.markUserInterruption();
    });

    act(() => {
      hook.result.scrollToBottom(mockContainer, true);
    });

    expect(hook.result.shouldStickToBottomRef.current).toBe(true);
    expect(hook.result.showScrollButton).toBe(false);
    expect(scrollToMock).toHaveBeenCalledWith({
      top: 1200,
      behavior: 'smooth',
    });

    hook.cleanup();
  });
});
