// src/components/ExportModal.tsx
// F10: Conversation export and portability modal.

import React, { useState } from 'react';
import {
  downloadFile,
  formatConversationJson,
  formatConversationMarkdown,
  formatBulkExportJson,
  sanitizeFilename,
  type ExportableConversation,
} from '../services/conversationExport';
import '../styles/KnowledgeWorkspace.css';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentConversation: ExportableConversation | null;
  onFetchAllConversations?: () => Promise<ExportableConversation[]>;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  currentConversation,
  onFetchAllConversations,
}) => {
  const [isExportingAll, setIsExportingAll] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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

  const handleExportBulk = async () => {
    if (!onFetchAllConversations) return;
    setIsExportingAll(true);
    setStatusMessage('Preparing archive of all chats…');

    try {
      const allChats = await onFetchAllConversations();
      const json = formatBulkExportJson(allChats);
      const filename = sanitizeFilename('prismatix_all_chats', 'json');
      downloadFile(json, filename, 'application/json;charset=utf-8');
      setStatusMessage(`Exported ${allChats.length} conversations.`);
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExportingAll(false);
    }
  };

  return (
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
              }}
            >
              {statusMessage}
            </div>
          )}

          {currentConversation && (
            <>
              <div
                className='export-option-card'
                onClick={handleExportCurrentMd}
                role='button'
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleExportCurrentMd()}
              >
                <div className='export-option-info'>
                  <span className='export-option-title'>Markdown (.md)</span>
                  <span className='export-option-desc'>
                    Formatted with headings, model provenance, timestamps, and cost receipts.
                  </span>
                </div>
                <span>📥</span>
              </div>

              <div
                className='export-option-card'
                onClick={handleExportCurrentJson}
                role='button'
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleExportCurrentJson()}
              >
                <div className='export-option-info'>
                  <span className='export-option-title'>JSON (.json)</span>
                  <span className='export-option-desc'>
                    Machine-readable export with full message structure and token breakdown.
                  </span>
                </div>
                <span>📥</span>
              </div>
            </>
          )}

          {onFetchAllConversations && (
            <div
              className='export-option-card'
              onClick={handleExportBulk}
              role='button'
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && handleExportBulk()}
              style={{ opacity: isExportingAll ? 0.6 : 1 }}
            >
              <div className='export-option-info'>
                <span className='export-option-title'>All Conversations Archive (JSON)</span>
                <span className='export-option-desc'>
                  Export all account conversations, project workspaces, and receipts in one file.
                </span>
              </div>
              <span>📦</span>
            </div>
          )}
        </div>

        <div className='knowledge-modal-footer'>
          <button type='button' className='btn-secondary' onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
