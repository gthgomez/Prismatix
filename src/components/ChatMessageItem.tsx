import React, { useEffect, useState } from 'react';
import type { Message, RouterModel } from '../types';
import { assistantModelPillDisplay, buildRouteExplanationRows } from '../modelDisplay';
import { RouteExplanationList } from './RouteExplanationList';
import { shouldShowDebateBadges } from '../debateMode';
import { CostBadge } from './CostBadge';
import { ThinkingProcess } from './ThinkingProcess';
import { FormattedMessage } from './FormattedMessage';
import { DebateView } from './DebateView';
import { PrismatixPulse } from './PrismatixPulse';
import { getCatalogEntry } from '../modelCatalog';
import { MessageActionToolbar } from './MessageActionToolbar';
import { extractTextContent } from '../utils';
import { chatMessageItemRenderLog } from './chatMessageItemRenderLog';

export interface ChatMessageItemProps {
  message: Message;
  index: number;
  isStreaming: boolean;
  isWaitingFirstToken: boolean;
  defaultModelColor: string;
  isMetadataExpanded: boolean;
  onToggleMetadata: (index: number) => void;
  registerRef?: (index: number, el: HTMLDivElement | null) => void;
  onCopy?: (index: number) => void;
  onRegenerate?: (index: number, modelOverride?: RouterModel) => void;
  onEditPrompt?: (index: number, newContent: string) => void;
  onFeedback?: (index: number, type: 'up' | 'down') => void;
  onBranch?: (index: number) => void;
  onSelectComparisonPreference?: (index: number, preferred: 'A' | 'B') => void;
  onOpenArtifact?: (index: number, content: string) => void;
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
  onCopy,
  onRegenerate,
  onEditPrompt,
  onFeedback,
  onBranch,
  onSelectComparisonPreference,
  onOpenArtifact,
}) => {
  if (import.meta.env.MODE === 'test') chatMessageItemRenderLog.push(index);
  const modelPillMeta = message.model ? assistantModelPillDisplay(message) : null;
  const isStreamingAssistant = isStreaming && message.role === 'assistant';
  const textContent = extractTextContent(message.content);

  const storedVersions = (Array.isArray(message.metadata?.versions) ? message.metadata.versions : []) as Array<{
    version: number;
    content: string;
    model?: string;
    model_used?: string;
    created_at?: string;
    timestamp?: number;
  }>;

  const allVersions = React.useMemo(() => {
    if (storedVersions.length === 0) return [];
    const last = storedVersions[storedVersions.length - 1];
    if (last && last.content !== textContent) {
      return [...storedVersions, { version: storedVersions.length + 1, content: textContent, model_used: message.model, model: message.model }];
    }
    return storedVersions;
  }, [storedVersions, textContent, message.model]);

  const [selectedVersionIdx, setSelectedVersionIdx] = useState<number>(() =>
    allVersions.length > 0 ? allVersions.length - 1 : 0
  );

  useEffect(() => {
    if (allVersions.length > 0) {
      setSelectedVersionIdx(allVersions.length - 1);
    }
  }, [allVersions.length]);

  const activeContent = allVersions.length > 0 && allVersions[selectedVersionIdx]
    ? allVersions[selectedVersionIdx].content
    : textContent;

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(activeContent);

  useEffect(() => {
    if (!isEditing) {
      setEditText(activeContent);
    }
  }, [activeContent, isEditing]);

  const handleSaveEdit = () => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    setIsEditing(false);
    onEditPrompt?.(index, trimmed);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditText(activeContent);
  };

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
          {allVersions.length > 1 && (
            <div className='message-version-switcher' style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--color-text-dim, #9ca3af)', marginLeft: '0.5rem' }}>
              <button
                type='button'
                aria-label='Previous response version'
                disabled={selectedVersionIdx <= 0}
                onClick={() => setSelectedVersionIdx((i) => Math.max(0, i - 1))}
                style={{
                  background: 'none',
                  border: 'none',
                  color: selectedVersionIdx <= 0 ? 'rgba(255,255,255,0.2)' : 'var(--color-primary, #4ecdc4)',
                  cursor: selectedVersionIdx <= 0 ? 'default' : 'pointer',
                  padding: '0 0.2rem',
                  fontSize: '0.85rem',
                  fontWeight: 'bold',
                }}
              >
                ‹
              </button>
              <span aria-label={`Version ${selectedVersionIdx + 1} of ${allVersions.length}`}>
                {selectedVersionIdx + 1} / {allVersions.length}
              </span>
              <button
                type='button'
                aria-label='Next response version'
                disabled={selectedVersionIdx >= allVersions.length - 1}
                onClick={() => setSelectedVersionIdx((i) => Math.min(allVersions.length - 1, i + 1))}
                style={{
                  background: 'none',
                  border: 'none',
                  color: selectedVersionIdx >= allVersions.length - 1 ? 'rgba(255,255,255,0.2)' : 'var(--color-primary, #4ecdc4)',
                  cursor: selectedVersionIdx >= allVersions.length - 1 ? 'default' : 'pointer',
                  padding: '0 0.2rem',
                  fontSize: '0.85rem',
                  fontWeight: 'bold',
                }}
              >
                ›
              </button>
            </div>
          )}
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
                      {message.debateDegraded && (
                        <div className='metadata-item'>
                          <span className='item-label'>Degraded</span>
                          <span className='item-value' style={{ color: 'var(--color-warning, #f59e0b)' }}>
                            {message.debateDegradedReason ? `Yes (${message.debateDegradedReason})` : 'Yes'}
                          </span>
                        </div>
                      )}
                      {message.debateProfile && (
                        <div className='metadata-item'>
                          <span className='item-label'>Debate</span>
                          <span className='item-value'>{message.debateProfile}</span>
                        </div>
                      )}
                      {message.debateExecutionMode && (
                        <div className='metadata-item'>
                          <span className='item-label'>Mode</span>
                          <span className='item-value'>
                            {message.debateExecutionMode === 'manual' ? 'Manual Peer Pairing' : 'Optimal Auto Pairing'}
                          </span>
                        </div>
                      )}
                      {message.debateTrigger && (
                        <div className='metadata-item'>
                          <span className='item-label'>Trigger</span>
                          <span className='item-value'>
                            {message.debateTrigger === 'auto' ? 'Auto (Complexity)' : message.debateTrigger}
                          </span>
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
          <CostBadge
            cost={message.cost}
            model={message.model}
            durationMs={message.thinkingDurationMs}
            content={typeof message.content === 'string' ? message.content : undefined}
            promptTokens={message.cost?.promptTokens}
            completionTokens={message.cost?.completionTokens}
          />
          {allVersions.length > 1 && (
            <div className='message-version-nav' role='navigation' aria-label='Response versions'>
              <button
                type='button'
                className='version-btn prev-version'
                disabled={selectedVersionIdx === 0}
                onClick={() => setSelectedVersionIdx((i) => Math.max(0, i - 1))}
                aria-label='Previous version'
                title='Previous version'
              >
                ‹
              </button>
              <span className='version-counter'>
                {selectedVersionIdx + 1} / {allVersions.length}
              </span>
              <button
                type='button'
                className='version-btn next-version'
                disabled={selectedVersionIdx === allVersions.length - 1}
                onClick={() => setSelectedVersionIdx((i) => Math.min(allVersions.length - 1, i + 1))}
                aria-label='Next version'
                title='Next version'
              >
                ›
              </button>
            </div>
          )}
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

        {message.role === 'assistant' && Boolean(message.thinkingLog?.length) && (
          <ThinkingProcess
            thoughts={message.thinkingLog}
            elapsedMs={message.thinkingDurationMs}
            isStreaming={isStreamingAssistant}
          />
        )}

        {message.role === 'user' && isEditing ? (
          <div className='message-inline-edit'>
            <textarea
              className='message-inline-edit-textarea'
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  handleCancelEdit();
                } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSaveEdit();
                }
              }}
              rows={Math.min(8, Math.max(2, editText.split('\n').length))}
              aria-label='Edit prompt'
              autoFocus
            />
            <div className='message-inline-edit-actions'>
              <button
                type='button'
                className='message-inline-edit-cancel'
                onClick={handleCancelEdit}
              >
                Cancel
              </button>
              <button
                type='button'
                className='message-inline-edit-save'
                onClick={handleSaveEdit}
                disabled={!editText.trim()}
              >
                Save &amp; Submit
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className='message-text'>
              <FormattedMessage
                content={activeContent}
                isStreaming={isStreamingAssistant}
                showCursor={isStreamingAssistant}
              />
            </div>

            {(() => {
              const imageGen = message.metadata?.imageGeneration as
                | { imageUrl?: string; prompt?: string; modelId?: string; costUsd?: number }
                | undefined;
              if (!imageGen?.imageUrl) return null;
              return (
                <div
                  className='generated-image-card'
                  style={{
                    margin: '0.75rem 0',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    background: '#141416',
                  }}
                >
                  <img
                    src={imageGen.imageUrl}
                    alt={imageGen.prompt || 'Generated image'}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '400px',
                      objectFit: 'contain',
                      display: 'block',
                      background: '#09090b',
                      margin: '0 auto',
                    }}
                  />
                  <div
                    style={{
                      padding: '0.5rem 0.75rem',
                      background: 'rgba(0, 0, 0, 0.35)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                      🎨 {imageGen.modelId} • ${imageGen.costUsd?.toFixed(4) ?? '0.0000'}
                    </span>
                    <a
                      href={imageGen.imageUrl}
                      download='prismatix-generated-image.png'
                      target='_blank'
                      rel='noopener noreferrer'
                      style={{ fontSize: '0.75rem', color: '#4ECDC4', textDecoration: 'none', fontWeight: 500 }}
                    >
                      Download
                    </a>
                  </div>
                </div>
              );
            })()}

            {message.role === 'assistant' && message.debateDegraded && (
              <div
                className='debate-degraded-banner'
                role='status'
                aria-live='polite'
                style={{
                  margin: '0.5rem 0',
                  padding: '0.35rem 0.6rem',
                  borderRadius: '4px',
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  color: '#f59e0b',
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                <span aria-hidden='true'>⚠️</span>
                <span>
                  Debate mode degraded to standard response{message.debateDegradedReason ? `: ${message.debateDegradedReason}` : ''}.
                </span>
              </div>
            )}

            {message.role === 'assistant' && message.debateParticipants && message.debateParticipants.length > 0 && (
              <DebateView
                participants={message.debateParticipants}
                executionMode={message.debateExecutionMode}
                profile={message.debateProfile}
              />
            )}

            {message.citations && message.citations.length > 0 && (
              <div className='message-citations-container'>
                <div className='message-citations-header'>
                  <span>🔍 Sources ({message.citations.length})</span>
                </div>
                <div className='message-citations-list'>
                  {message.citations.map((c) => (
                    <a
                      key={c.id}
                      href={c.url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='citation-pill'
                      title={c.snippet}
                    >
                      <span className='citation-num'>[{c.id}]</span>
                      <span className='citation-domain'>{c.domain}</span>
                      <span className='citation-title'>
                        {c.title.length > 28 ? `${c.title.slice(0, 25)}…` : c.title}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {message.comparisonResults && (
              <div className='comparison-results-container'>
                <div className={`comparison-column model-a ${message.comparisonResults.preferred === 'A' ? 'is-preferred' : ''}`}>
                  <div className='comparison-header'>
                    <span className='comparison-model-badge'>{message.comparisonResults.modelA.model}</span>
                    {message.comparisonResults.modelA.cost !== undefined && (
                      <span className='comparison-cost'>${message.comparisonResults.modelA.cost.toFixed(4)}</span>
                    )}
                  </div>
                  <div className='comparison-content'>
                    <FormattedMessage content={message.comparisonResults.modelA.content} />
                  </div>
                  <div className='comparison-footer' style={{ marginTop: '0.5rem', paddingTop: '0.4rem', borderTop: '1px solid var(--color-border, rgba(255, 255, 255, 0.08))' }}>
                    <button
                      type='button'
                      onClick={() => onSelectComparisonPreference?.(index, 'A')}
                      style={{
                        padding: '0.25rem 0.6rem',
                        fontSize: '0.75rem',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        border: '1px solid',
                        borderColor: message.comparisonResults.preferred === 'A' ? 'var(--color-primary, #4ecdc4)' : 'rgba(255, 255, 255, 0.15)',
                        background: message.comparisonResults.preferred === 'A' ? 'rgba(78, 205, 196, 0.2)' : 'transparent',
                        color: message.comparisonResults.preferred === 'A' ? 'var(--color-primary, #4ecdc4)' : 'var(--color-text-dim, #9ca3af)',
                        fontWeight: message.comparisonResults.preferred === 'A' ? 600 : 400,
                      }}
                    >
                      {message.comparisonResults.preferred === 'A' ? '✓ Preferred model' : 'Prefer this model'}
                    </button>
                  </div>
                </div>
                <div className={`comparison-column model-b ${message.comparisonResults.preferred === 'B' ? 'is-preferred' : ''}`}>
                  <div className='comparison-header'>
                    <span className='comparison-model-badge'>{message.comparisonResults.modelB.model}</span>
                    {message.comparisonResults.modelB.cost !== undefined && (
                      <span className='comparison-cost'>${message.comparisonResults.modelB.cost.toFixed(4)}</span>
                    )}
                  </div>
                  <div className='comparison-content'>
                    <FormattedMessage content={message.comparisonResults.modelB.content} />
                  </div>
                  <div className='comparison-footer' style={{ marginTop: '0.5rem', paddingTop: '0.4rem', borderTop: '1px solid var(--color-border, rgba(255, 255, 255, 0.08))' }}>
                    <button
                      type='button'
                      onClick={() => onSelectComparisonPreference?.(index, 'B')}
                      style={{
                        padding: '0.25rem 0.6rem',
                        fontSize: '0.75rem',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        border: '1px solid',
                        borderColor: message.comparisonResults.preferred === 'B' ? 'var(--color-primary, #4ecdc4)' : 'rgba(255, 255, 255, 0.15)',
                        background: message.comparisonResults.preferred === 'B' ? 'rgba(78, 205, 196, 0.2)' : 'transparent',
                        color: message.comparisonResults.preferred === 'B' ? 'var(--color-primary, #4ecdc4)' : 'var(--color-text-dim, #9ca3af)',
                        fontWeight: message.comparisonResults.preferred === 'B' ? 600 : 400,
                      }}
                    >
                      {message.comparisonResults.preferred === 'B' ? '✓ Preferred model' : 'Prefer this model'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {isWaitingFirstToken && isStreamingAssistant && (
              <div className='message-thinking-loader'>
                <PrismatixPulse
                  color={message.model ? getCatalogEntry(message.model).color : defaultModelColor}
                  showLogo
                />
              </div>
            )}

            {/* Message Action Toolbar (Copy, Edit, Regenerate, Feedback) */}
            {(!isWaitingFirstToken || !isStreamingAssistant) && (
              <MessageActionToolbar
                role={message.role}
                content={activeContent}
                isStreaming={isStreamingAssistant}
                onCopy={() => onCopy?.(index)}
                onEdit={() => {
                  setEditText(activeContent);
                  setIsEditing(true);
                }}
                onRegenerate={(override) => onRegenerate?.(index, override)}
                onBranch={onBranch ? () => onBranch(index) : undefined}
                feedback={message.feedback}
                onFeedback={(type) => onFeedback?.(index, type)}
                hasArtifacts={message.role === 'assistant' && activeContent.includes('```')}
                onOpenArtifact={onOpenArtifact ? () => onOpenArtifact(index, activeContent) : undefined}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
});

ChatMessageItem.displayName = 'ChatMessageItem';
