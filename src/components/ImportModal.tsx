// src/components/ImportModal.tsx
// F16: Conversation import modal with preview, schema validation, and safe execution.

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import {
  previewConversationImport,
  executeConversationImport,
  type ImportPreview,
  type ImportResult,
} from '../services/conversationImport';
import '../styles/KnowledgeWorkspace.css';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImportComplete,
}) => {
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [skipExisting, setSkipExisting] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      setFileContent(content);
      const prev = previewConversationImport(content);
      setPreview(prev);
      setResult(null);
    };
    reader.readAsText(file);
  };

  const handleExecuteImport = async () => {
    if (!fileContent || !preview?.valid) return;

    setIsImporting(true);
    try {
      const res = await executeConversationImport(supabase, fileContent, {
        skipExisting,
      });
      setResult(res);
      if (res.success) {
        onImportComplete();
      }
    } catch (err) {
      setResult({
        success: false,
        importedConversations: 0,
        importedMessages: 0,
        skippedConversations: 0,
        errors: [(err as Error).message],
      });
    } finally {
      setIsImporting(false);
    }
  };

  const modalContent = (
    <div className='knowledge-modal-backdrop' onClick={onClose} role='dialog' aria-modal='true'>
      <div
        className='knowledge-modal-card import-modal'
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '600px', width: '90%' }}
      >
        <div className='knowledge-modal-header'>
          <h3>Import Conversations</h3>
          <button
            type='button'
            className='knowledge-modal-close'
            onClick={onClose}
            aria-label='Close import dialog'
          >
            ✕
          </button>
        </div>

        <div className='knowledge-modal-body'>
          {!result ? (
            <>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-dim, #9ca3af)', marginBottom: '1rem' }}>
                Import conversations from Prismatix JSON, OpenAI / ChatGPT exports, or Claude. Historical costs will be labeled as imported
                and will not affect billing.
              </p>

              <div style={{ marginBottom: '1.25rem' }}>
                <input
                  type='file'
                  accept='.json,application/json'
                  onChange={handleFileChange}
                  id='conversation-import-file'
                  style={{ display: 'none' }}
                />
                <label
                  htmlFor='conversation-import-file'
                  className='knowledge-btn'
                  style={{
                    display: 'inline-block',
                    padding: '0.6rem 1rem',
                    background: 'var(--color-surface, #2d3748)',
                    border: '1px dashed var(--color-border-strong, #4a5568)',
                    borderRadius: 'var(--radius-md, 6px)',
                    cursor: 'pointer',
                    textAlign: 'center',
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                >
                  {preview ? '✓ Choose a different JSON file' : '📁 Select Prismatix JSON Export File'}
                </label>
              </div>

              {preview && !preview.valid && (
                <div
                  className='knowledge-error-banner'
                  style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '0.75rem', borderRadius: '4px', marginBottom: '1rem' }}
                >
                  ⚠️ {preview.error}
                </div>
              )}

              {preview && preview.valid && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      padding: '0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.85rem',
                      marginBottom: '0.75rem',
                    }}
                  >
                    <strong>Preview:</strong> {preview.totalConversations} conversation{preview.totalConversations !== 1 ? 's' : ''}, {preview.totalMessages} message{preview.totalMessages !== 1 ? 's' : ''}
                    {preview.projects.length > 0 && ` across ${preview.projects.length} project(s)`}
                  </div>

                  <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid var(--color-border, #374151)', borderRadius: '4px' }}>
                    {preview.conversations.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          padding: '0.4rem 0.6rem',
                          borderBottom: '1px solid var(--color-border, #374151)',
                          fontSize: '0.8rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
                          {c.title}
                        </span>
                        <span style={{ color: 'var(--color-text-dim, #9ca3af)', fontSize: '0.75rem' }}>
                          {c.messageCount} msg{c.messageCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type='checkbox'
                      id='skip-existing-check'
                      checked={skipExisting}
                      onChange={(e) => setSkipExisting(e.target.checked)}
                    />
                    <label htmlFor='skip-existing-check' style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
                      Skip conversations that already exist in your account
                    </label>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: '1rem 0' }}>
              <div
                style={{
                  padding: '1rem',
                  borderRadius: '6px',
                  background: result.success ? 'rgba(78, 205, 196, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: result.success ? '#4ecdc4' : '#ef4444',
                  marginBottom: '1rem',
                }}
              >
                <h4>{result.success ? '✓ Import Completed' : '⚠️ Import Encountered Issues'}</h4>
                <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                  Successfully imported <strong>{result.importedConversations}</strong> conversation(s) and{' '}
                  <strong>{result.importedMessages}</strong> message(s).
                  {result.skippedConversations > 0 && ` Skipped ${result.skippedConversations} existing conversation(s).`}
                </p>
                {result.errors.length > 0 && (
                  <ul style={{ fontSize: '0.8rem', marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
                    {result.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        <div className='knowledge-modal-actions'>
          <button type='button' className='knowledge-btn-secondary' onClick={onClose} disabled={isImporting}>
            {result ? 'Done' : 'Cancel'}
          </button>
          {!result && preview?.valid && (
            <button
              type='button'
              className='knowledge-btn-primary'
              onClick={handleExecuteImport}
              disabled={isImporting}
            >
              {isImporting ? 'Importing…' : 'Start Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
