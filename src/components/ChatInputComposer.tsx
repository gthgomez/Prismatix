// src/components/ChatInputComposer.tsx
// Input composer area for ChatInterface: textarea, attachments, upload, send/stop controls

import React from 'react';
import { AttachmentPreview } from './AttachmentPreview';
import { FileUpload } from './FileUpload';
import type { FileUploadPayload } from '../types';
import type { ComposerSendValidationView } from '../sendValidationPresentation';
import type { DebateSelection } from '../debateMode';
import type { PromptStarter, SendBlockedReason, StreamOutcomeState } from './chatTypes';
export type { PromptStarter };

export interface ChatInputComposerProps {
  input: string;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  isWaitingFirstToken: boolean;
  sendBlockedReason: SendBlockedReason;
  sendBlockedTitles: Record<string, string>;
  hasPendingVideoUploads: boolean;
  draftAttachments: FileUploadPayload[];
  onRemoveAttachment: (index: number) => void;
  onClearAllAttachments: () => void;
  onFileSelect: (payload: FileUploadPayload) => void;
  onMultipleFiles: (payloads: FileUploadPayload[]) => void;
  manualModelOverride: string | null;
  modelConfigName: string;
  modelConfigColor: string;
  debateSelection: DebateSelection;
  openRoutingDebateMenu: () => void;
  showPromptStarters: boolean;
  promptStarters: PromptStarter[];
  onSelectPromptStarter: (prompt: string) => void;
  streamOutcome: StreamOutcomeState | null;
  contextExcludedCount: number;
  duplicateNotice: string | null;
  composerValidationView: ComposerSendValidationView | null;
}

export const ChatInputComposer: React.FC<ChatInputComposerProps> = ({
  input,
  inputRef,
  onChange,
  onKeyDown,
  onSend,
  onStop,
  isStreaming,
  isWaitingFirstToken,
  sendBlockedReason,
  sendBlockedTitles,
  hasPendingVideoUploads,
  draftAttachments,
  onRemoveAttachment,
  onClearAllAttachments,
  onFileSelect,
  onMultipleFiles,
  manualModelOverride,
  modelConfigName,
  modelConfigColor,
  debateSelection,
  openRoutingDebateMenu,
  showPromptStarters,
  promptStarters,
  onSelectPromptStarter,
  streamOutcome,
  contextExcludedCount,
  duplicateNotice,
  composerValidationView,
}) => {
  return (
    <div className='chat-input-container'>
      <div className='input-wrapper'>
        <AttachmentPreview
          attachments={draftAttachments}
          onRemove={onRemoveAttachment}
          onClearAll={onClearAllAttachments}
        />

        {/* Input Row */}
        <div className='input-row glass-surface' data-glass-variant='floating' data-glass-mode='glass'>
          <FileUpload
            onFileContent={onFileSelect}
            onMultipleFiles={onMultipleFiles}
            disabled={isStreaming}
            maxFiles={10}
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={onChange}
            onKeyDown={onKeyDown}
            placeholder={
              draftAttachments.length > 0
                ? hasPendingVideoUploads
                  ? 'Video is processing... sending is disabled until ready.'
                  : 'Add a message (optional)...'
                : 'Ask anything…'
            }
            aria-label='Message Prismatix'
            className='chat-input'
            disabled={isStreaming}
            rows={1}
          />
          <button
            type='button'
            onClick={onSend}
            disabled={sendBlockedReason !== null}
            className='send-button'
            data-state={sendBlockedReason ?? 'ready'}
            aria-label={sendBlockedTitles[sendBlockedReason ?? 'ready']}
            title={sendBlockedTitles[sendBlockedReason ?? 'ready']}
          >
            {isWaitingFirstToken ? (
              <div className='loading-spinner' />
            ) : (
              <svg
                width='20'
                height='20'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
              >
                <line x1='22' y1='2' x2='11' y2='13' />
                <polygon points='22 2 15 22 11 13 2 9 22 2' />
              </svg>
            )}
          </button>
          {isStreaming && (
            <button
              type='button'
              onClick={onStop}
              className='stop-button'
              title='Stop generating'
              aria-label='Stop generating'
            >
              <svg
                width='18'
                height='18'
                viewBox='0 0 24 24'
                fill='currentColor'
                stroke='currentColor'
                strokeWidth='2'
              >
                <rect x='6' y='6' width='12' height='12' rx='2' />
              </svg>
            </button>
          )}
        </div>

        {/* Routing context at the point of composing */}
        {manualModelOverride && (
          <div className='composer-routing-context'>
            <button
              type='button'
              className='composer-routing-chip'
              onClick={openRoutingDebateMenu}
              title={`Routing & debate — manual override: ${modelConfigName}`}
            >
              <span className='composer-routing-chip-label'>Routing</span>
              <span className='composer-routing-chip-value' style={{ color: modelConfigColor }}>
                {modelConfigName}
              </span>
              <span className='composer-routing-chip-tag'>Manual</span>
              {debateSelection !== 'off' && (
                <span className='composer-routing-chip-tag debate'>Debate</span>
              )}
            </button>
          </div>
        )}
        {!manualModelOverride && debateSelection !== 'off' && (
          <div className='composer-routing-context'>
            <button
              type='button'
              className='composer-routing-chip'
              onClick={openRoutingDebateMenu}
              title='Routing & debate — model chosen automatically, debate framing enabled'
            >
              <span className='composer-routing-chip-label'>Routing</span>
              <span className='composer-routing-chip-value'>Auto</span>
              <span className='composer-routing-chip-tag debate'>Debate</span>
            </button>
          </div>
        )}

        {showPromptStarters && (
          <div className='prompt-starters-section' aria-label='Suggested starting points'>
            <div className='prompt-starters-grid'>
              {promptStarters.map((starter) => (
                <button
                  key={starter.title}
                  type='button'
                  className='prompt-starter-chip'
                  onClick={() => onSelectPromptStarter(starter.prompt)}
                >
                  <span className='starter-chip-title'>{starter.title}</span>
                  <span aria-hidden='true'>↗</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {streamOutcome && (
          <div className='stream-outcome' role='status' aria-live='polite'>
            <span>
              {streamOutcome.status === 'cancelled'
                ? 'Response stopped'
                : streamOutcome.settlementState === 'settled'
                ? 'Usage recorded'
                : streamOutcome.settlementState === 'released'
                ? 'Reservation released'
                : 'Usage recording pending'}
            </span>
            <details className='receipt-details'>
              <summary>Receipt details</summary>
              <div>
                Settlement: {streamOutcome.settlementState ?? 'pending'}
                {streamOutcome.executionId && <span>Execution: {streamOutcome.executionId}</span>}
              </div>
            </details>
          </div>
        )}

        {/* PX07: bounded-context indicator — older messages are excluded */}
        {contextExcludedCount > 0 && (
          <div className='context-out-of-window-indicator' role='status'>
            {contextExcludedCount} older message
            {contextExcludedCount === 1 ? ' is' : 's are'} outside the current context.
          </div>
        )}

        {/* PX07: duplicate_request — the turn already exists; no re-dispatch */}
        {duplicateNotice && (
          <div className='duplicate-request-notice' role='status' aria-live='polite'>
            {duplicateNotice}
          </div>
        )}

        {composerValidationView && (
          <div className='send-validation-error' role='alert' aria-live='polite'>
            <p className='send-validation-summary'>{composerValidationView.summary}</p>
            {composerValidationView.detail && (
              <p className='send-validation-detail'>{composerValidationView.detail}</p>
            )}
            {composerValidationView.showRoutingCta && (
              <button
                type='button'
                className='send-validation-routing-cta'
                onClick={openRoutingDebateMenu}
              >
                Open routing & debate
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
