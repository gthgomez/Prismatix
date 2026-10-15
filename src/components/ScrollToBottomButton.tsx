// src/components/ScrollToBottomButton.tsx
// Floating button positioned in chat viewport allowing users to jump to the bottom
// with live pulse indicator when assistant is streaming tokens.

import React from 'react';

export interface ScrollToBottomButtonProps {
  visible: boolean;
  isStreaming?: boolean;
  onClick: () => void;
}

export const ScrollToBottomButton: React.FC<ScrollToBottomButtonProps> = ({
  visible,
  isStreaming = false,
  onClick,
}) => {
  if (!visible) return null;

  return (
    <div className='scroll-to-bottom-wrapper' role='region' aria-label='Scroll navigation'>
      <button
        type='button'
        className={`scroll-to-bottom-btn ${isStreaming ? 'is-streaming' : ''}`}
        onClick={onClick}
        aria-label={isStreaming ? 'Streaming response — click to scroll to bottom' : 'Scroll to newest message'}
        title={isStreaming ? 'Streaming response — click to scroll to bottom' : 'Scroll to newest message'}
      >
        {isStreaming ? (
          <>
            <span className='scroll-stream-pulse' aria-hidden='true' />
            <span className='scroll-btn-label'>Streaming response...</span>
            <svg
              className='scroll-chevron'
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2.5'
              strokeLinecap='round'
              strokeLinejoin='round'
              aria-hidden='true'
            >
              <polyline points='6 9 12 15 18 9' />
            </svg>
          </>
        ) : (
          <>
            <span className='scroll-btn-label'>Jump to latest</span>
            <svg
              className='scroll-chevron'
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2.5'
              strokeLinecap='round'
              strokeLinejoin='round'
              aria-hidden='true'
            >
              <polyline points='6 9 12 15 18 9' />
            </svg>
          </>
        )}
      </button>
    </div>
  );
};

ScrollToBottomButton.displayName = 'ScrollToBottomButton';
