// src/components/ExportModal.tsx
// F10: Conversation export and portability modal with progress, provenance, and partial-failure reporting.

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  downloadFile,
  formatConversationJson,
  formatConversationMarkdown,
  formatBulkExportJson,
  sanitizeFilename,
  type ExportableConversation,
  type ExportProgress,
  type ExportResult,
} from '../services/conversationExport';
import '../styles/KnowledgeWorkspace.css';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentConversation: ExportableConversation | null;
  onFetchAllConversations?: (
    onProgress?: (progress: ExportProgress) => void,
    signal?: AbortSignal,
  ) => Promise<ExportResult | ExportableConversation[]>;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  currentConversation,
  onFetchAllConversations,
}) => {
  const [isExportingAll, setIsExportingAll] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progressInfo, setProgressInfo] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  if (!isOpen) return null;

  const handleExportCurrentMd = () => {
    if (!currentConversation) return;
    const md = formatConversationMarkdown(currentConversation);
    const filename = sanitizeFilename(currentConversation.title, 'md');
    downloadFile(md, filename, 'text/markdown;charset=utf-8');
    setStatusMessage('Exported chat as Markdown.');
    setTimeout(() => onClose(), 800);
  };

  const handleExportCurrentJson = () => {
    if (!currentConversation) return;
    const json = formatConversationJson(currentConversation);
    const filename = sanitizeFilename(currentConversation.title, 'json');
    downloadFile(json, filename, 'application/json;charset=utf-8');
    setStatusMessage('Exported chat as JSON.');
    setTimeout(() => onClose(), 800);
  };

  const handleCancelExport = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsExportingAll(false);
      setProgressInfo(null);
      setStatusMessage('Export cancelled.');
    }
  };

  const handleExportBulk = async () => {
    if (!onFetchAllConversations) return;
    setIsExportingAll(true);
    setStatusMessage(null);
    setErrorMessage(null);
    setProgressInfo('Discovering all conversations…');

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const res = await onFetchAllConversations((progress) => {
        if (progress.stage === 'listing') {
          setProgressInfo(`Found ${progress.conversationsLoaded} conversations…`);
        } else if (progress.stage === 'messages') {
          const totalStr = progress.totalConversations ? ` of ${progress.totalConversations}` : '';
          setProgressInfo(`Exporting messages: conversation ${progress.conversationsLoaded}${totalStr}…`);
        }
      }, abortController.signal);

      if (abortController.signal.aborted) {
        setStatusMessage('Export cancelled.');
        return;
      }

      const allChats: ExportableConversation[] = Array.isArray(res) ? res : res.conversations;
      const partialErrors = !Array.isArray(res) ? res.partialErrors : [];

      if (allChats.length === 0) {
        setStatusMessage('No conversations available to export.');
        return;
      }

      const json = formatBulkExportJson(allChats);
      const filename = sanitizeFilename('prismatix_all_chats', 'json');
      downloadFile(json, filename, 'application/json;charset=utf-8');

      if (partialErrors.length > 0) {
        setErrorMessage(
          `Exported ${allChats.length} conversations. Note: ${partialErrors.length} conversation(s) could not be loaded and were recorded in export errors.`
        );
      } else {
        setStatusMessage(`Successfully exported ${allChats.length} conversations archive.`);
        setTimeout(() => onClose(), 1500);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Bulk export failed');
    } finally {
      setIsExportingAll(false);
      setProgressInfo(null);
    }
  };

  const modalContent = (
    <div className='knowledge-modal-backdrop' onClick={onClose}>
      <div
        className='knowledge-modal-card'
        role='dialog'
        aria-label='Export Chat'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='knowledge-modal-header'>
          <h3>Export & Portability</h3>
          <button
            type='button'
            className='btn-secondary'
            style={{ border: 'none', padding: '0.2rem 0.5rem', fontSize: '1.2rem' }}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className='knowledge-modal-body'>
          {statusMessage && (
            <div
              style={{
                background: 'rgba(78, 205, 196, 0.15)',
                border: '1px solid rgba(78, 205, 196, 0.3)',
                color: 'var(--color-primary, #4ecdc4)',
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                fontSize: '0.85rem',
                marginBottom: '1rem',
              }}
            >
              ✓ {statusMessage}
            </div>
          )}

          {errorMessage && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                fontSize: '0.85rem',
                marginBottom: '1rem',
              }}
            >
              ⚠️ {errorMessage}
            </div>
          )}

          {progressInfo && (
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'var(--color-text-dim, #9ca3af)',
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                fontSize: '0.85rem',
                marginBottom: '1rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>⏳ {progressInfo}</span>
              {isExportingAll && (
                <button
                  type='button'
                  onClick={handleCancelExport}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#f87171',
                    borderRadius: '4px',
                    padding: '0.2rem 0.5rem',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          )}

          <div className='export-section'>
            <h4>Active Conversation</h4>
            <p className='export-desc'>
              Export the currently opened conversation including model provenance and execution receipts:
            </p>
            <div className='export-buttons-row'>
              <button
                type='button'
                className='btn-primary'
                onClick={handleExportCurrentMd}
                disabled={!currentConversation || isExportingAll}
              >
                Download Markdown (.md)
              </button>
              <button
                type='button'
                className='btn-secondary'
                onClick={handleExportCurrentJson}
                disabled={!currentConversation || isExportingAll}
              >
                Download JSON (.json)
              </button>
            </div>
          </div>

          <div className='export-section' style={{ marginTop: '1.5rem', borderTop: '1px solid var(--color-border, rgba(255, 255, 255, 0.1))', paddingTop: '1rem' }}>
            <h4>All Conversations Archive</h4>
            <p className='export-desc'>
              Paginates through and downloads your complete conversation history across all projects:
            </p>
            <button
              type='button'
              className='btn-secondary'
              onClick={handleExportBulk}
              disabled={isExportingAll}
              style={{ width: '100%' }}
            >
              {isExportingAll ? 'Exporting Archive…' : 'Export Full Account Archive (.json)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
