// src/components/DocumentComparisonModal.tsx
// F25: Multi-document analysis & comparison modal.
// Allows users to compare two text/markdown/code documents, inspect vocabulary overlap and length deltas,
// and insert structured comparative analysis prompts into the chat composer.

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { generateDocumentComparison, type DocumentComparisonResult } from '../services/multiDocComparison';

export interface DocumentComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertPrompt: (promptText: string) => void;
}

export const DocumentComparisonModal: React.FC<DocumentComparisonModalProps> = ({
  isOpen,
  onClose,
  onInsertPrompt,
}) => {
  const [docAName, setDocAName] = useState('Document A (Draft / Old)');
  const [docAContent, setDocAContent] = useState('');
  const [docBName, setDocBName] = useState('Document B (Revision / New)');
  const [docBContent, setDocBContent] = useState('');

  const [comparisonResult, setComparisonResult] = useState<DocumentComparisonResult | null>(null);

  if (!isOpen) return null;

  const handleCompare = () => {
    if (!docAContent.trim() || !docBContent.trim()) return;

    const result = generateDocumentComparison(
      { name: docAName.trim() || 'Document A', content: docAContent },
      { name: docBName.trim() || 'Document B', content: docBContent },
    );
    setComparisonResult(result);
  };

  const handleInsert = () => {
    if (comparisonResult) {
      onInsertPrompt(comparisonResult.comparativePrompt);
      onClose();
    }
  };

  const modalContent = (
    <div className='knowledge-modal-backdrop' onClick={onClose} role='dialog' aria-modal='true'>
      <div
        className='knowledge-modal-card document-comparison-modal'
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '800px', width: '92%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className='knowledge-modal-header'>
          <h3>Multi-Document Comparison & Analysis</h3>
          <button
            type='button'
            className='knowledge-modal-close'
            onClick={onClose}
            aria-label='Close comparison modal'
          >
            ✕
          </button>
        </div>

        <div className='knowledge-modal-body' style={{ overflowY: 'auto', flex: 1 }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-dim, #9ca3af)', marginBottom: '1rem' }}>
            Compare specifications, contracts, code revisions, or requirements documents side-by-side. Inspect vocabulary overlap and synthesize key divergences.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                Document A Name
              </label>
              <input
                type='text'
                value={docAName}
                onChange={(e) => setDocAName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.45rem',
                  marginBottom: '0.5rem',
                  background: 'var(--color-surface, #1f2937)',
                  border: '1px solid var(--color-border, #374151)',
                  borderRadius: '4px',
                  color: 'inherit',
                  fontSize: '0.85rem',
                }}
              />
              <textarea
                value={docAContent}
                onChange={(e) => setDocAContent(e.target.value)}
                placeholder='Paste Document A text or code here…'
                rows={8}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  background: 'var(--color-surface, #1f2937)',
                  border: '1px solid var(--color-border, #374151)',
                  borderRadius: '4px',
                  color: 'inherit',
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                Document B Name
              </label>
              <input
                type='text'
                value={docBName}
                onChange={(e) => setDocBName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.45rem',
                  marginBottom: '0.5rem',
                  background: 'var(--color-surface, #1f2937)',
                  border: '1px solid var(--color-border, #374151)',
                  borderRadius: '4px',
                  color: 'inherit',
                  fontSize: '0.85rem',
                }}
              />
              <textarea
                value={docBContent}
                onChange={(e) => setDocBContent(e.target.value)}
                placeholder='Paste Document B text or code here…'
                rows={8}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  background: 'var(--color-surface, #1f2937)',
                  border: '1px solid var(--color-border, #374151)',
                  borderRadius: '4px',
                  color: 'inherit',
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <button
              type='button'
              className='knowledge-btn-primary'
              disabled={!docAContent.trim() || !docBContent.trim()}
              onClick={handleCompare}
              style={{
                padding: '0.45rem 1rem',
                background: 'var(--color-primary, #4ecdc4)',
                color: '#0f172a',
                border: 'none',
                borderRadius: '4px',
                fontWeight: 600,
                cursor: !docAContent.trim() || !docBContent.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              Analyze & Compare
            </button>
          </div>

          {comparisonResult && (
            <div style={{ border: '1px solid var(--color-border, rgba(255,255,255,0.1))', borderRadius: '6px', padding: '1rem', background: 'rgba(255,255,255,0.02)' }}>
              <h4 style={{ margin: '0 0 0.5rem 0' }}>Comparison Metrics</h4>
              <p style={{ fontSize: '0.85rem', color: '#4ecdc4', fontWeight: 600 }}>{comparisonResult.summary}</p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.8rem' }}>
                <div style={{ background: 'rgba(255,255,255,0.04)', padding: '0.5rem', borderRadius: '4px' }}>
                  <span style={{ color: 'var(--color-text-dim, #9ca3af)', display: 'block' }}>Vocabulary Overlap</span>
                  <strong style={{ fontSize: '1rem' }}>{Math.round(comparisonResult.metrics.jaccardSimilarity * 100)}%</strong>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.04)', padding: '0.5rem', borderRadius: '4px' }}>
                  <span style={{ color: 'var(--color-text-dim, #9ca3af)', display: 'block' }}>Document A Size</span>
                  <strong style={{ fontSize: '1rem' }}>{comparisonResult.metrics.docALength} chars</strong>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.04)', padding: '0.5rem', borderRadius: '4px' }}>
                  <span style={{ color: 'var(--color-text-dim, #9ca3af)', display: 'block' }}>Document B Size</span>
                  <strong style={{ fontSize: '1rem' }}>{comparisonResult.metrics.docBLength} chars</strong>
                </div>
              </div>

              {comparisonResult.metrics.docAUniqueKeywords.length > 0 && (
                <div style={{ marginTop: '0.75rem', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--color-text-dim, #9ca3af)' }}>Unique to {comparisonResult.metrics.docAName}: </span>
                  <code>{comparisonResult.metrics.docAUniqueKeywords.join(', ')}</code>
                </div>
              )}

              {comparisonResult.metrics.docBUniqueKeywords.length > 0 && (
                <div style={{ marginTop: '0.4rem', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--color-text-dim, #9ca3af)' }}>Unique to {comparisonResult.metrics.docBName}: </span>
                  <code>{comparisonResult.metrics.docBUniqueKeywords.join(', ')}</code>
                </div>
              )}
            </div>
          )}
        </div>

        <div className='knowledge-modal-actions' style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', padding: '1rem 1.5rem', borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))' }}>
          <button type='button' className='knowledge-btn-secondary' onClick={onClose}>
            Close
          </button>
          {comparisonResult && (
            <button
              type='button'
              className='knowledge-btn-primary'
              onClick={handleInsert}
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
              Insert Comparative Prompt into Chat
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
