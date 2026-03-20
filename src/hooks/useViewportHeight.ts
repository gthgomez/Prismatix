import { useEffect } from 'react';

const KEYBOARD_OPEN_THRESHOLD_PX = 80;

export function useViewportHeight(): void {
  useEffect(() => {
    const applyViewportMetrics = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const vh = viewportHeight * 0.01;
      document.documentElement.style.setProperty('--app-vh', `${vh}px`);

      const keyboardOffset = window.visualViewport
        ? Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop)
        : 0;
      document.documentElement.style.setProperty('--kb-offset', `${keyboardOffset}px`);
      document.documentElement.classList.toggle('keyboard-open', keyboardOffset > KEYBOARD_OPEN_THRESHOLD_PX);
    };

    applyViewportMetrics();

    window.addEventListener('resize', applyViewportMetrics, { passive: true });
    window.addEventListener('orientationchange', applyViewportMetrics);
    window.visualViewport?.addEventListener('resize', applyViewportMetrics);
    window.visualViewport?.addEventListener('scroll', applyViewportMetrics);

    return () => {
      window.removeEventListener('resize', applyViewportMetrics);
      window.removeEventListener('orientationchange', applyViewportMetrics);
      window.visualViewport?.removeEventListener('resize', applyViewportMetrics);
      window.visualViewport?.removeEventListener('scroll', applyViewportMetrics);
    };
  }, []);
}
