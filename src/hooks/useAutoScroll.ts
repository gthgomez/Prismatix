import type { MutableRefObject } from 'react';
import { useCallback, useRef, useState } from 'react';

export interface UseAutoScrollResult {
  shouldStickToBottomRef: MutableRefObject<boolean>;
  showScrollButton: boolean;
  updateStickyScrollState: (container: HTMLElement | null) => void;
  markUserInterruption: () => void;
  resetAutoScroll: () => void;
  scrollToBottom: (container?: HTMLElement | null, smooth?: boolean) => void;
}

export function useAutoScroll(thresholdPx = 32, buttonThresholdPx = 80): UseAutoScrollResult {
  const shouldStickToBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const updateStickyScrollState = useCallback((container: HTMLElement | null) => {
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottom = distanceFromBottom <= thresholdPx;
    shouldStickToBottomRef.current = isAtBottom;
    setShowScrollButton(distanceFromBottom > buttonThresholdPx);
  }, [thresholdPx, buttonThresholdPx]);

  const markUserInterruption = useCallback(() => {
    shouldStickToBottomRef.current = false;
  }, []);

  const resetAutoScroll = useCallback(() => {
    shouldStickToBottomRef.current = true;
    setShowScrollButton(false);
  }, []);

  const scrollToBottom = useCallback((container?: HTMLElement | null, smooth = true) => {
    shouldStickToBottomRef.current = true;
    setShowScrollButton(false);
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, []);

  return {
    shouldStickToBottomRef,
    showScrollButton,
    updateStickyScrollState,
    markUserInterruption,
    resetAutoScroll,
    scrollToBottom,
  };
}

