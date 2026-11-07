// src/components/UrlIngestionModal.tsx
// F23: Secure URL ingestion & page reading modal.
// Validates web URLs with strict SSRF defense, fetches and extracts readable text,
// and inserts clean content into the chat composer.

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchAndParseUrl, validateUrlForSsrf, type ParsedUrlContent } from '../services/urlPageReader';

export interface UrlIngestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertContent: (content: string, url: string, title: string) => void;
}

export const UrlIngestionModal: React.FC<UrlIngestionModalProps> = ({
  isOpen,
  onClose,
  onInsertContent,
}) => {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<ParsedUrlContent | null>(null);

  if (!isOpen) return null;

  const handleFetch = async () => {
    setError(null);
    setParsedData(null);

    const trimmed = url.trim();
    if (!trimmed) {
      setError('Please enter a valid URL.');
      return;
    }

    const ssrfCheck = validateUrlForSsrf(trimmed);
    if (!ssrfCheck.valid) {
      setError(`SSRF Block: ${ssrfCheck.reason}`);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetchAndParseUrl(trimmed);
      if (res.success && res.data) {
        setParsedData(res.data);
      } else {
        setError(res.error || 'Failed to fetch and parse URL.');
      }
    } catch (err: any) {
      setError(err.message || 'Network exception while reading URL.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = () => {
    if (parsedData) {
      const formatted = `=== INGESTED WEB PAGE: "${parsedData.title}" (${parsedData.url}) ===\n\n${parsedData.textContent}\n\n=== END INGESTED CONTENT ===`;
      onInsertContent(formatted, parsedData.url, parsedData.title);
      onClose();
    }
  };

  const modalContent = (
    <div className='knowledge-modal-backdrop' onClick={onClose} role='dialog' aria-modal='true'>
      <div
        className='knowledge-modal-card url-ingestion-modal'
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '650px', width: '92%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className='knowledge-modal-header'>
          <h3>Read & Ingest Web Page</h3>
          <button
            type='button'
            className='knowledge-modal-close'
            onClick={onClose}
            aria-label='Close URL ingestion modal'
          >
            ✕
          </button>
        </div>

        <div className='knowledge-modal-body' style={{ overflowY: 'auto', flex: 1 }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-dim, #9ca3af)', marginBottom: '1rem' }}>
            Fetch any public web page into your conversation context. Strips navigation, ads, and scripts to extract clean text with strict SSRF defense.
          </p>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input
              type='url'
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder='https://example.com/article'
              disabled={isLoading}
              style={{
                flex: 1,
                padding: '0.5rem',
                background: 'var(--color-surface, #1f2937)',
                border: '1px solid var(--color-border, #374151)',
                borderRadius: '4px',
                color: 'inherit',
                fontSize: '0.85rem',
              }}
            />
            <button
              type='button'
              className='knowledge-btn-primary'
              disabled={isLoading || !url.trim()}
              onClick={handleFetch}
              style={{
                padding: '0.5rem 1rem',
                background: 'var(--color-primary, #4ecdc4)',
                color: '#0f172a',
                border: 'none',
                borderRadius: '4px',
                fontWeight: 600,
                cursor: isLoading || !url.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {isLoading ? 'Reading…' : 'Fetch Content'}
            </button>
          </div>

          {error && (
            <div
              className='knowledge-error-banner'
              role='alert'
              style={{
                padding: '0.6rem 0.8rem',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid #ef4444',
                borderRadius: '4px',
                color: '#fca5a5',
                fontSize: '0.8rem',
                marginBottom: '1rem',
              }}
            >
              ⚠️ {error}
            </div>
          )}

          {parsedData && (
            <div style={{ border: '1px solid var(--color-border, rgba(255,255,255,0.1))', borderRadius: '6px', padding: '1rem', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <h4 style={{ margin: 0 }}>{parsedData.title}</h4>
                <span style={{ fontSize: '0.75rem', color: '#4ecdc4', fontWeight: 600 }}>
                  ~{parsedData.estimatedTokens} tokens ({parsedData.charCount} chars)
                </span>
              </div>

              {parsedData.description && (
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-dim, #9ca3af)', marginBottom: '0.75rem', fontStyle: 'italic' }}>
                  {parsedData.description}
                </p>
              )}

              <div
                style={{
                  maxHeight: '220px',
                  overflowY: 'auto',
                  background: 'rgba(0,0,0,0.25)',
                  padding: '0.75rem',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  lineHeight: '1.4',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {parsedData.textContent.slice(0, 2000)}
                {parsedData.textContent.length > 2000 && '… (truncated preview)'}
              </div>
            </div>
          )}
        </div>

        <div className='knowledge-modal-actions' style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', padding: '1rem 1.5rem', borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))' }}>
          <button type='button' className='knowledge-btn-secondary' onClick={onClose} disabled={isLoading}>
            Cancel
          </button>
          {parsedData && (
            <button
              type='button'
              className='knowledge-btn-primary'
              onClick={handleApply}
              style={{
                padding: '0.45rem 1rem',
                background: 'var(--color-primary, #4ecdc4)',
                color: '#0f172a',
                border: 'none',
                borderRadius: '4px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Insert into Chat
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
