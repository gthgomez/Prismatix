import type { MutableRefObject } from 'react';
import { useRef } from 'react';

interface UseAutoScrollResult {
  shouldStickToBottomRef: MutableRefObject<boolean>;
  updateStickyScrollState: (container: HTMLElement | null) => void;
  markUserInterruption: () => void;
  resetAutoScroll: () => void;
}

export function useAutoScroll(thresholdPx = 32): UseAutoScrollResult {
  const shouldStickToBottomRef = useRef(true);

  const updateStickyScrollState = (container: HTMLElement | null) => {
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom <= thresholdPx;
  };

  const markUserInterruption = () => {
    shouldStickToBottomRef.current = false;
  };

  const resetAutoScroll = () => {
    shouldStickToBottomRef.current = true;
  };

  return {
    shouldStickToBottomRef,
    updateStickyScrollState,
    markUserInterruption,
    resetAutoScroll,
  };
}
