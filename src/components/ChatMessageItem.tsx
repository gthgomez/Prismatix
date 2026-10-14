// src/components/ChatMessageItem.tsx
// Memoized individual message item in the chat transcript

import React from 'react';
import type { Message } from '../types';
import { assistantModelPillDisplay, buildRouteExplanationRows } from '../modelDisplay';
import { RouteExplanationList } from './RouteExplanationList';
import { shouldShowDebateBadges } from '../debateMode';
import { CostBadge } from './CostBadge';
import { ThinkingProcess } from './ThinkingProcess';
import { FormattedMessage } from './FormattedMessage';
import { DebateView } from './DebateView';
import { PrismatixPulse } from './PrismatixPulse';
import { getCatalogEntry } from '../modelCatalog';

export interface ChatMessageItemProps {
  message: Message;
  index: number;
  isStreaming: boolean;
  isWaitingFirstToken: boolean;
  defaultModelColor: string;
  isMetadataExpanded: boolean;
  onToggleMetadata: (index: number) => void;
  registerRef?: (index: number, el: HTMLDivElement | null) => void;
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = React.memo(({
  message,
  index,
  isStreaming,
  isWaitingFirstToken,
  defaultModelColor,
  isMetadataExpanded,
  onToggleMetadata,
  registerRef,
}) => {
  const modelPillMeta = message.model ? assistantModelPillDisplay(message) : null;
  const isStreamingAssistant = isStreaming && message.role === 'assistant';

  return (
    <div
      className={`message message-${message.role}`}
      ref={(el) => registerRef?.(index, el)}
    >
      <div className='message-avatar'>
        <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' aria-hidden='true'>
          {message.role === 'user' ? (
            <>
              <circle cx='12' cy='8' r='4' />
              <path d='M4 21v-2a8 8 0 0 1 16 0v2' />
            </>
          ) : (
            <>
              <rect x='4' y='7' width='16' height='13' rx='3' />
              <path d='M12 3v4m-4 6h1m6 0h1m-7 4h6' />
            </>
          )}
        </svg>
      </div>

      <div className='message-content'>
        <div className='message-header'>
          <span className='message-role'>
            {message.role === 'user' ? 'You' : 'Assistant'}
          </span>
          {message.model && (
            <div className='message-metadata-container'>
              <button
                type='button'
                className={`message-model-pill ${isMetadataExpanded ? 'expanded' : ''}`}
                onClick={() => onToggleMetadata(index)}
                title={modelPillMeta?.title}
              >
                <span className='pill-text'>{modelPillMeta?.label}</span>
                <span className='info-icon'>
                  <svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='3'>
                    <circle cx='12' cy='12' r='10' />
                    <line x1='12' y1='16' x2='12' y2='12' />
                    <line x1='12' y1='8' x2='12.01' y2='8' />
                  </svg>
                </span>
              </button>

              {isMetadataExpanded && (
                <div className='metadata-popover'>
                  {message.provider && (
                    <div className='metadata-item'>
                      <span className='item-label'>Provider</span>
                      <span className='item-value'>{message.provider}</span>
                    </div>
                  )}
                  {message.modelId && (
                    <div className='metadata-item'>
                      <span className='item-label'>API ID</span>
                      <span className='item-value metadata-value-break'>{message.modelId}</span>
                    </div>
                  )}
                  {message.modelOverride && message.modelOverride !== 'auto' && (
                    <div className='metadata-item'>
                      <span className='item-label'>Override</span>
                      <span className='item-value'>Manual</span>
                    </div>
                  )}
                  {message.geminiFlashThinkingLevel && (
                    <div className='metadata-item'>
                      <span className='item-label'>Thinking</span>
                      <span className='item-value'>{message.geminiFlashThinkingLevel}</span>
                    </div>
                  )}
                  {message.role === 'assistant' && (
                    <RouteExplanationList {...buildRouteExplanationRows(message)} />
                  )}
                  {message.role === 'assistant' && shouldShowDebateBadges(message) && (
                    <div className='metadata-debate-details'>
                      <div className='metadata-divider' />
                      {message.debateProfile && (
                        <div className='metadata-item'>
                          <span className='item-label'>Debate</span>
                          <span className='item-value'>{message.debateProfile}</span>
                        </div>
                      )}
                      {message.debateTrigger && (
                        <div className='metadata-item'>
                          <span className='item-label'>Trigger</span>
                          <span className='item-value'>{message.debateTrigger}</span>
                        </div>
                      )}
                      {message.debateModel && (
                        <div className='metadata-item'>
                          <span className='item-label'>Synth</span>
                          <span className='item-value'>{message.debateModel}</span>
                        </div>
                      )}
                      {message.debateCostNote && (
                        <div className='metadata-item'>
                          <span className='item-label'>Cost Note</span>
                          <span className='item-value'>{message.debateCostNote}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <CostBadge cost={message.cost} />
          <span className='message-time'>
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
        </div>

        {/* Render images if present */}
        {message.imageData && (
          <div className='message-image-container'>
            <img
              src={`data:${message.mediaType || 'image/png'};base64,${message.imageData}`}
              alt='Uploaded content'
              className='message-image'
            />
          </div>
        )}

        {/* Restored image attachments from signed URLs / files / videos */}
        {!message.imageData && message.attachments && (
          <div className='message-attachments-row'>
            {message.attachments.map((attachment, attachmentIndex) => {
              if (attachment.isImage && attachment.storageUrl) {
                return (
                  <div className='message-image-container' key={attachmentIndex}>
                    <img
                      src={attachment.storageUrl}
                      alt={attachment.name || 'Uploaded content'}
                      className='message-image'
                    />
                  </div>
                );
              }
              if (attachment.isImage) {
                return (
                  <div className='message-image-placeholder' key={attachmentIndex}>
                    🖼 image unavailable
                  </div>
                );
              }
              if (attachment.kind === 'video') {
                return (
                  <div className='message-video-placeholder' key={attachmentIndex}>
                    🎞 video attachment
                  </div>
                );
              }
              if (attachment.kind === 'text') {
                const size = attachment.size ?? attachment.sizeBytes;
                return (
                  <div className='message-file-chip' key={attachmentIndex}>
                    📄 {attachment.name}
                    {typeof size === 'number'
                      ? ` · ${size < 1024 ? `${size} B` : `${Math.round(size / 1024)} KB`}`
                      : ''}
                  </div>
                );
              }
              return null;
            })}
          </div>
        )}

        {/* Show attachment count if multiple */}
        {message.attachments && message.attachments.length > 1 && (
          <div className='message-attachments-badge'>
            📎 {message.attachments.length} files attached
          </div>
        )}

        {message.role === 'assistant' && (
          <ThinkingProcess
            thoughts={message.thinkingLog}
            elapsedMs={message.thinkingDurationMs}
          />
        )}

        <div className='message-text'>
          <FormattedMessage
            content={typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}
            isStreaming={isStreamingAssistant}
            showCursor={isStreamingAssistant}
          />
        </div>

        {message.role === 'assistant' && message.debateParticipants && message.debateParticipants.length > 0 && (
          <DebateView participants={message.debateParticipants} />
        )}

        {isWaitingFirstToken && isStreamingAssistant && (
          <div className='message-thinking-loader'>
            <PrismatixPulse
              color={message.model ? getCatalogEntry(message.model).color : defaultModelColor}
              showLogo
            />
          </div>
        )}
      </div>
    </div>
  );
});

ChatMessageItem.displayName = 'ChatMessageItem';
