// src/components/MessageActionToolbar.tsx
// Toolbar for message actions: Copy, Edit Prompt (user), Regenerate & Feedback (assistant)

import React, { useEffect, useRef, useState } from 'react';
import type { RouterModel } from '../types';
import { defaultTTSPlaybackService, isTTSSupported, type TTSPlaybackState } from '../services/ttsPlaybackService';

export interface QuickModelOption {
  value: RouterModel | 'auto';
  label: string;
  badge?: string;
}

const REGENERATE_QUICK_MODELS: QuickModelOption[] = [
  { value: 'auto', label: 'Auto Route', badge: 'Smart' },
  { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', badge: 'Fast' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', badge: 'Fast' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', badge: 'Reason' },
  { value: 'gpt-6-sol', label: 'GPT-6 Sol', badge: 'Frontier' },
];

export interface MessageActionToolbarProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  onCopy?: () => void;
  // User actions
  onEdit?: () => void;
  onBranch?: () => void;
  // Assistant actions
  onRegenerate?: (modelOverride?: RouterModel) => void;
  feedback?: 'up' | 'down';
  onFeedback?: (type: 'up' | 'down') => void;
  onOpenArtifact?: () => void;
  hasArtifacts?: boolean;
}

export const MessageActionToolbar: React.FC<MessageActionToolbarProps> = ({
  role,
  content,
  isStreaming = false,
  onCopy,
  onEdit,
  onBranch,
  onRegenerate,
  feedback,
  onFeedback,
  onOpenArtifact,
  hasArtifacts = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [ttsState, setTtsState] = useState<TTSPlaybackState>('idle');
  const menuRef = useRef<HTMLDivElement>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      if (role === 'assistant' && (ttsState === 'playing' || ttsState === 'paused')) {
        defaultTTSPlaybackService.stop();
      }
    };
  }, [role, ttsState]);

  const handleTtsToggle = () => {
    if (ttsState === 'playing') {
      defaultTTSPlaybackService.pause();
      setTtsState('paused');
    } else if (ttsState === 'paused') {
      defaultTTSPlaybackService.resume();
      setTtsState('playing');
    } else {
      setTtsState('playing');
      const success = defaultTTSPlaybackService.speak(content, {
        onStart: () => setTtsState('playing'),
        onPause: () => setTtsState('paused'),
        onResume: () => setTtsState('playing'),
        onEnd: () => setTtsState('idle'),
        onError: () => setTtsState('idle'),
      });
      if (!success) setTtsState('idle');
    }
  };

  const handleTtsStop = () => {
    defaultTTSPlaybackService.stop();
    setTtsState('idle');
  };

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      }
      setCopied(true);
      onCopy?.();
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      console.warn('Failed to copy message content to clipboard:', err);
    }
  };

  const handleRegenerateClick = () => {
    if (isStreaming || !onRegenerate) return;
    setIsMenuOpen(false);
    onRegenerate();
  };

  const handleSelectModel = (modelValue: RouterModel | 'auto') => {
    if (isStreaming || !onRegenerate) return;
    setIsMenuOpen(false);
    onRegenerate(modelValue === 'auto' ? undefined : modelValue);
  };

  return (
    <div className={`message-action-toolbar message-action-toolbar-${role}`} role='toolbar' aria-label={`${role} message actions`}>
      {/* Copy Action */}
      <button
        type='button'
        className={`message-action-btn ${copied ? 'is-copied' : ''}`}
        onClick={handleCopy}
        title={copied ? 'Copied to clipboard' : role === 'user' ? 'Copy prompt' : 'Copy response'}
        aria-label={copied ? 'Copied to clipboard' : role === 'user' ? 'Copy prompt' : 'Copy response'}
      >
        {copied ? (
          <>
            <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
              <polyline points='20 6 9 17 4 12' />
            </svg>
            <span className='action-btn-label'>Copied</span>
          </>
        ) : (
          <>
            <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
              <rect x='9' y='9' width='13' height='13' rx='2' ry='2' />
              <path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' />
            </svg>
            <span className='action-btn-label'>{role === 'user' ? 'Copy' : 'Copy'}</span>
          </>
        )}
      </button>

      {/* Branch Action */}
      {onBranch && (
        <button
          type='button'
          className='message-action-btn message-branch-btn'
          onClick={onBranch}
          title='Branch conversation from here'
          aria-label='Branch conversation from here'
        >
          <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
            <line x1='6' y1='3' x2='6' y2='15' />
            <circle cx='18' cy='6' r='3' />
            <circle cx='6' cy='18' r='3' />
            <path d='M18 9a9 9 0 0 1-9 9' />
          </svg>
          <span className='action-btn-label'>Branch</span>
        </button>
      )}

      {/* User Edit Action */}
      {role === 'user' && onEdit && (
        <button
          type='button'
          className='message-action-btn message-edit-btn'
          onClick={onEdit}
          title='Edit prompt'
          aria-label='Edit prompt'
        >
          <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
            <path d='M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' />
            <path d='M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' />
          </svg>
          <span className='action-btn-label'>Edit</span>
        </button>
      )}

      {/* Assistant Actions */}
      {role === 'assistant' && (
        <>
          {onRegenerate && (
            <div className='regenerate-btn-group' ref={menuRef}>
              <button
                type='button'
                className='message-action-btn message-regenerate-btn'
                onClick={handleRegenerateClick}
                disabled={isStreaming}
                title={isStreaming ? 'Generating response...' : 'Regenerate response'}
                aria-label='Regenerate response'
              >
                <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                  <polyline points='1 4 1 10 7 10' />
                  <polyline points='23 20 23 14 17 14' />
                  <path d='M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15' />
                </svg>
                <span className='action-btn-label'>Regenerate</span>
              </button>

              <button
                type='button'
                className='message-action-btn message-regenerate-menu-btn'
                onClick={() => setIsMenuOpen((prev) => !prev)}
                disabled={isStreaming}
                aria-expanded={isMenuOpen}
                aria-haspopup='menu'
                title='Regenerate with different model'
                aria-label='Regenerate with different model'
              >
                <svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                  <polyline points='6 9 12 15 18 9' />
                </svg>
              </button>

              {isMenuOpen && (
                <div className='regenerate-model-dropdown' role='menu' aria-label='Choose model to regenerate with'>
                  <div className='regenerate-dropdown-header'>Regenerate with:</div>
                  {REGENERATE_QUICK_MODELS.map((opt) => (
                    <button
                      key={opt.value}
                      type='button'
                      className='regenerate-dropdown-item'
                      role='menuitem'
                      onClick={() => handleSelectModel(opt.value)}
                    >
                      <span className='model-opt-name'>{opt.label}</span>
                      {opt.badge && <span className='model-opt-badge'>{opt.badge}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {onFeedback && (
            <div className='feedback-btn-group'>
              <button
                type='button'
                className={`message-action-btn feedback-btn ${feedback === 'up' ? 'is-active' : ''}`}
                onClick={() => onFeedback('up')}
                title={feedback === 'up' ? 'Remove positive feedback' : 'Good response'}
                aria-label={feedback === 'up' ? 'Remove positive feedback' : 'Good response'}
                aria-pressed={feedback === 'up'}
              >
                <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                  <path d='M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3' />
                </svg>
              </button>

              <button
                type='button'
                className={`message-action-btn feedback-btn ${feedback === 'down' ? 'is-active' : ''}`}
                onClick={() => onFeedback('down')}
                title={feedback === 'down' ? 'Remove negative feedback' : 'Bad response'}
                aria-label={feedback === 'down' ? 'Remove negative feedback' : 'Bad response'}
                aria-pressed={feedback === 'down'}
              >
                <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                  <path d='M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3' />
                </svg>
              </button>
            </div>
          )}

          {/* Read Aloud / TTS Control */}
          {isTTSSupported() && (
            <div className='tts-btn-group' style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
              <button
                type='button'
                className={`message-action-btn tts-play-btn ${ttsState === 'playing' ? 'is-playing' : ''}`}
                onClick={handleTtsToggle}
                disabled={isStreaming}
                title={
                  ttsState === 'playing'
                    ? 'Pause read aloud'
                    : ttsState === 'paused'
                    ? 'Resume read aloud'
                    : 'Read aloud response (Native TTS)'
                }
                aria-label={
                  ttsState === 'playing'
                    ? 'Pause read aloud'
                    : ttsState === 'paused'
                    ? 'Resume read aloud'
                    : 'Read aloud response'
                }
              >
                {ttsState === 'playing' ? (
                  <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                    <rect x='6' y='4' width='4' height='16' />
                    <rect x='14' y='4' width='4' height='16' />
                  </svg>
                ) : (
                  <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                    <polygon points='11 5 6 9 2 9 2 15 6 15 11 19 11 5' />
                    <path d='M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07' />
                  </svg>
                )}
                <span className='action-btn-label'>
                  {ttsState === 'playing' ? 'Pause' : ttsState === 'paused' ? 'Resume' : 'Listen'}
                </span>
              </button>

              {(ttsState === 'playing' || ttsState === 'paused') && (
                <button
                  type='button'
                  className='message-action-btn tts-stop-btn'
                  onClick={handleTtsStop}
                  title='Stop read aloud'
                  aria-label='Stop read aloud'
                >
                  <svg width='11' height='11' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
                    <rect x='4' y='4' width='16' height='16' rx='2' />
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* Artifact View Button */}
          {hasArtifacts && onOpenArtifact && (
            <button
              type='button'
              className='message-action-btn message-artifact-btn'
              onClick={onOpenArtifact}
              title='View and edit extracted artifacts'
              aria-label='View and edit extracted artifacts'
            >
              <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
                <path d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' />
                <polyline points='3.27 6.96 12 12.01 20.73 6.96' />
                <line x1='12' y1='22.08' x2='12' y2='12' />
              </svg>
              <span className='action-btn-label'>Artifact</span>
            </button>
          )}
        </>
      )}
    </div>
  );
};

MessageActionToolbar.displayName = 'MessageActionToolbar';
