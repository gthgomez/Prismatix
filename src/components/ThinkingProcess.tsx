// src/components/ThinkingProcess.tsx
// Dynamic reasoning stream disclosure with live pulse beacon, elapsed timer,
// structured thought trace, and copy action.

import React, { useEffect, useRef, useState } from 'react';

export interface ThinkingProcessProps {
  thoughts?: string[];
  elapsedMs?: number;
  isStreaming?: boolean;
}

export const ThinkingProcess: React.FC<ThinkingProcessProps> = ({
  thoughts = [],
  elapsedMs,
  isStreaming = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(isStreaming);
  const [userToggled, setUserToggled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [streamSeconds, setStreamSeconds] = useState(0);

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamStartRef = useRef<number>(Date.now());
  const elapsedMsRef = useRef(elapsedMs);
  elapsedMsRef.current = elapsedMs;
  const contentRef = useRef<HTMLPreElement | null>(null);

  // Live timer while streaming reasoning tokens
  useEffect(() => {
    if (!isStreaming) return;

    streamStartRef.current = Date.now() - (elapsedMsRef.current ?? 0);
    const interval = setInterval(() => {
      const elapsed = (Date.now() - streamStartRef.current) / 1000;
      setStreamSeconds(elapsed);
    }, 100);

    return () => clearInterval(interval);
  }, [isStreaming]);

  // Sync final or updated duration when not streaming
  useEffect(() => {
    if (!isStreaming && elapsedMs !== undefined) {
      setStreamSeconds(elapsedMs / 1000);
    }
  }, [isStreaming, elapsedMs]);

  // When streaming starts, auto-expand if user hasn't explicitly interacted
  useEffect(() => {
    if (isStreaming && !userToggled) {
      setIsExpanded(true);
    }
  }, [isStreaming, userToggled]);

  // Auto-scroll the thought log to bottom while streaming
  useEffect(() => {
    if (isStreaming && isExpanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [thoughts, isStreaming, isExpanded]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  if (!thoughts.length) return null;

  const displaySeconds = streamSeconds > 0
    ? `${streamSeconds.toFixed(1)}s`
    : elapsedMs
    ? `${(elapsedMs / 1000).toFixed(1)}s`
    : null;

  const toggleAccordion = () => {
    setUserToggled(true);
    setIsExpanded((prev) => !prev);
  };

  const handleCopyThoughts = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(thoughts.join(''));
      }
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy thinking process trace:', err);
    }
  };

  return (
    <div className={`thinking-process ${isExpanded ? 'expanded' : 'collapsed'} ${isStreaming ? 'is-streaming' : ''}`}>
      <div className='thinking-process-header-bar'>
        <button
          type='button'
          className='thinking-process-header'
          onClick={toggleAccordion}
          aria-expanded={isExpanded}
          aria-label={isStreaming ? 'Streaming thinking process' : 'Toggle thinking process'}
        >
          <span className='thinking-header-left'>
            {isStreaming ? (
              <span className='thinking-beacon' aria-hidden='true' />
            ) : (
              <svg
                className='thinking-icon'
                width='14'
                height='14'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                aria-hidden='true'
              >
                <circle cx='12' cy='12' r='10' />
                <path d='M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' />
                <line x1='12' y1='17' x2='12.01' y2='17' />
              </svg>
            )}
            <span className='thinking-title'>
              {isStreaming ? 'Thinking' : 'Thought process'}
              {displaySeconds ? ` (${displaySeconds})` : ''}
            </span>
          </span>

          <span className='thinking-header-right'>
            <svg
              className={`thinking-chevron ${isExpanded ? 'open' : ''}`}
              width='12'
              height='12'
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
          </span>
        </button>

        {isExpanded && thoughts.length > 0 && (
          <div className='thinking-header-actions'>
            <button
              type='button'
              className={`thinking-copy-btn ${copied ? 'is-copied' : ''}`}
              onClick={handleCopyThoughts}
              title={copied ? 'Copied thoughts' : 'Copy thoughts'}
              aria-label={copied ? 'Copied thoughts' : 'Copy thoughts'}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>

      {isExpanded && (
        <pre className='thinking-process-content' ref={contentRef} tabIndex={0}>
          {thoughts.join('')}
        </pre>
      )}
    </div>
  );
};

ThinkingProcess.displayName = 'ThinkingProcess';
