// src/components/ChatInterface.tsx
// Main chat interface with multi-file upload support and model selector

import React, { useEffect, useRef, useState } from 'react';
import { useContextManager } from '../hooks/useContextManager';
import { ContextWarning } from './ContextWarning';
import { ContextStatus } from './ContextStatus';
import { FileUpload } from './FileUpload';
import { BudgetGuard, evaluateBudget } from './BudgetGuard';
import { CostEstimator } from './CostEstimator';
import { CostBadge } from './CostBadge';
import { PrismatixPulse } from './PrismatixPulse';
import { SpendTracker } from './SpendTracker';
import { ThinkingProcess } from './ThinkingProcess';
import { DebateView } from './DebateView';
import { ModelSelectorDropdown } from './ModelSelectorDropdown';
import { AttachmentPreview } from './AttachmentPreview';
import '../styles/ChatInterface.css';
import { askPrismatix, getConversationId, resetConversation } from '../smartFetch';
import { useAutoScroll } from '../hooks/useAutoScroll';
import { readRouterStream } from '../hooks/useStreamHandler';
import {
  calculateFinalCost,
  calculatePreFlightCost,
  estimateTokenCount,
  type UsageEstimate,
} from '../costEngine';
import { calculateHistoryTokens } from '../utils';
import {
  uploadAttachment,
  uploadVideoAttachment,
  waitForVideoReady,
} from '../services/storageService';
import { fetchServerDailyTotal, recordCost } from '../services/financeTracker';
import type {
  FileUploadPayload,
  GeminiFlashThinkingLevel,
  Message,
  RouterModel,
} from '../types';
import { MODEL_CATALOG, MODEL_ORDER } from '../modelCatalog';
import type { User } from '@supabase/supabase-js';
import {
  getDebatePayload,
  hasReadyVideoAttachment,
  type DebateSelection,
  shouldShowDebateBadges,
} from '../debateMode';

interface ChatInterfaceProps {
  user: User | null;
  onSignOut: () => Promise<void>;
}

const DAILY_BUDGET_LIMIT_USD = 2.0;
const VIDEO_NAME_PATTERN = /\.(mp4|mov|avi|mkv|webm|m4v)$/i;

function shouldTreatAsVideoAttachment(file: FileUploadPayload): boolean {
  if (file.kind === 'video') return true;
  if (typeof file.mediaType === 'string' && file.mediaType.toLowerCase().startsWith('video/')) {
    return true;
  }
  return VIDEO_NAME_PATTERN.test(file.name || '');
}

function normalizeAttachmentKind(file: FileUploadPayload): FileUploadPayload {
  if (!shouldTreatAsVideoAttachment(file)) {
    return file;
  }
  return {
    ...file,
    kind: 'video',
    isImage: false,
    mediaType: file.mediaType || file.file?.type || 'video/mp4',
    status: file.status || 'pending_upload',
    uploadProgress: file.uploadProgress ?? 0,
  };
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ user, onSignOut }) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isWaitingFirstToken, setIsWaitingFirstToken] = useState(false);
  const [currentModel, setCurrentModel] = useState<RouterModel>('gemini-2.5-flash');
  const [currentComplexity, setCurrentComplexity] = useState<number>(50);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [manualModelOverride, setManualModelOverride] = useState<RouterModel | null>(null);
  const [geminiFlashThinkingLevel, setGeminiFlashThinkingLevel] = useState<
    GeminiFlashThinkingLevel
  >('high');
  const [budgetConfirm, setBudgetConfirm] = useState<{
    estimateUsd: number;
    dailyTotalUsd: number;
  } | null>(null);
  const [currentUsage, setCurrentUsage] = useState<UsageEstimate | null>(null);
  const [costModel, setCostModel] = useState<RouterModel>('gemini-2.5-flash');
  const [sessionCostTotal, setSessionCostTotal] = useState(0);
  const [spendRefreshKey, setSpendRefreshKey] = useState(0);
  const [showCostEstimator, setShowCostEstimator] = useState(false);
  const [finalMessageCost, setFinalMessageCost] = useState<number | null>(null);
  const [debateSelection, setDebateSelection] = useState<DebateSelection>('off');
  const [sendValidationError, setSendValidationError] = useState<string | null>(null);
  const [expandedMetadataIdx, setExpandedMetadataIdx] = useState<number | null>(null);

  const [draftAttachments, setDraftAttachments] = useState<FileUploadPayload[]>([]);
  const hasPendingVideoUploads = draftAttachments.some(
    (file) => file.kind === 'video' && file.status !== 'ready',
  );
  const hasReadyVideo = hasReadyVideoAttachment(draftAttachments);

  // Context Manager
  const {
    contextStatus,
    shouldShowWarning,
    createNewChatWithContext,
  } = useContextManager(messages, true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const chatMessagesRef = useRef<HTMLElement | null>(null);
  const {
    shouldStickToBottomRef,
    updateStickyScrollState,
    markUserInterruption,
    resetAutoScroll,
  } = useAutoScroll(32);
  const waitingFirstTokenRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const modelSelectorRef = useRef<HTMLDivElement>(null);
  const costEstimatorHideTimeoutRef = useRef<number | null>(null);

  // Scroll only when a new message bubble is created, and only if user is near bottom.
  useEffect(() => {
    if (messages.length === 0) return;
    if (!shouldStickToBottomRef.current) return;
    const lastMessage = messageRefs.current[messages.length - 1];
    if (lastMessage) {
      lastMessage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Keep attachment preview visible when user is already at bottom.
  useEffect(() => {
    if (!shouldStickToBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [draftAttachments.length]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(e.target as Node)) {
        setShowModelSelector(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (sendValidationError) {
      setSendValidationError(null);
    }
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  const updateDraftAttachment = (
    targetClientId: string,
    updater: (file: FileUploadPayload) => FileUploadPayload,
  ) => {
    setDraftAttachments((prev) =>
      prev.map((file) => (file.clientId === targetClientId ? updater(file) : file))
    );
  };

  const startVideoUpload = async (file: FileUploadPayload) => {
    if (!file.file || file.kind !== 'video' || !file.clientId) return;
    const conversationId = getConversationId();

    try {
      updateDraftAttachment(file.clientId, (current) => ({
        ...current,
        status: 'pending_upload',
        uploadProgress: 0,
        errorCode: undefined,
      }));

      const uploaded = await uploadVideoAttachment(
        file.file,
        conversationId,
        (progressPercent) => {
          updateDraftAttachment(file.clientId!, (current) => ({
            ...current,
            uploadProgress: progressPercent,
            status: progressPercent >= 100 ? 'uploaded' : 'pending_upload',
          }));
        },
      );

      updateDraftAttachment(file.clientId, (current) => ({
        ...current,
        videoAssetId: uploaded.assetId,
        status: 'processing',
      }));

      const finalStatus = await waitForVideoReady(uploaded.assetId, (statusUpdate) => {
        updateDraftAttachment(file.clientId!, (current) => ({
          ...current,
          videoAssetId: uploaded.assetId,
          status: statusUpdate.status,
          durationMs: statusUpdate.durationMs || current.durationMs,
          uploadProgress: Math.max(current.uploadProgress || 0, statusUpdate.progress || 0),
          errorCode: statusUpdate.error?.code || undefined,
        }));
      });

      if (finalStatus.status !== 'ready') {
        updateDraftAttachment(file.clientId, (current) => ({
          ...current,
          status: finalStatus.status,
          errorCode: finalStatus.error?.code || 'video_processing_failed',
        }));
      }
    } catch (error) {
      console.error('[ChatInterface] Video upload failed:', error);
      updateDraftAttachment(file.clientId, (current) => ({
        ...current,
        status: 'failed',
        errorCode: error instanceof Error ? error.message : 'video_upload_failed',
      }));
    }
  };

  const handleFileSelect = (file: FileUploadPayload) => {
    const normalizedFile = normalizeAttachmentKind(file);
    const kindLabel = normalizedFile.kind || (normalizedFile.isImage ? 'image' : 'text');
    console.log('[ChatInterface] File added:', normalizedFile.name, kindLabel);
    if (sendValidationError) {
      setSendValidationError(null);
    }
    setDraftAttachments((prev) => [...prev, normalizedFile]);
    if (normalizedFile.kind === 'video') {
      void startVideoUpload(normalizedFile);
    }
    inputRef.current?.focus();
  };

  const handleMultipleFiles = (files: FileUploadPayload[]) => {
    console.log('[ChatInterface] Multiple files added:', files.length);
    if (sendValidationError) {
      setSendValidationError(null);
    }
    const normalizedFiles = files.map(normalizeAttachmentKind);
    setDraftAttachments((prev) => [...prev, ...normalizedFiles]);
    normalizedFiles.forEach((file) => {
      if (file.kind === 'video') {
        void startVideoUpload(file);
      }
    });
    inputRef.current?.focus();
  };

  const removeAttachment = (index: number) => {
    setDraftAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Clear all attachments
  const clearAllAttachments = () => {
    setDraftAttachments([]);
  };

  // Handle model selection
  const handleModelSelect = (model: RouterModel) => {
    setManualModelOverride(model);
    setCurrentModel(model);
    setShowModelSelector(false);
  };

  // Clear manual override (let router decide)
  const clearModelOverride = () => {
    setManualModelOverride(null);
    setShowModelSelector(false);
  };

  const clearCostEstimatorHideTimer = () => {
    if (costEstimatorHideTimeoutRef.current !== null) {
      window.clearTimeout(costEstimatorHideTimeoutRef.current);
      costEstimatorHideTimeoutRef.current = null;
    }
  };

  const scheduleCostEstimatorHide = (delayMs = 3000) => {
    clearCostEstimatorHideTimer();
    costEstimatorHideTimeoutRef.current = window.setTimeout(() => {
      setShowCostEstimator(false);
      setCurrentUsage(null);
      setFinalMessageCost(null);
      costEstimatorHideTimeoutRef.current = null;
    }, delayMs);
  };

  useEffect(() => {
    return () => clearCostEstimatorHideTimer();
  }, []);

  const handleSend = async (skipBudgetCheck = false) => {
    // Allow send if there's text OR attachments
    const hasContent = input.trim() || draftAttachments.length > 0;
    if (!hasContent || isStreaming || hasPendingVideoUploads) return;
    if (debateSelection === 'video_ui' && !hasReadyVideo) {
      setSendValidationError('Video UI debate requires at least one ready video attachment.');
      return;
    }
    setSendValidationError(null);
    resetAutoScroll();

    // Build query text
    const hasImages = draftAttachments.some((f) => f.isImage);
    const hasTextFiles = draftAttachments.some((f) => !f.isImage && f.kind !== 'video');

    let queryText = input.trim();

    // If no text but has attachments, use default prompts
    if (!queryText) {
      const hasVideos = draftAttachments.some((f) => f.kind === 'video');
      if (hasImages && hasTextFiles && hasVideos) {
        queryText = 'Analyze these videos, files, and images.';
      } else if (hasVideos && hasImages) {
        queryText = 'Analyze this video and related images.';
      } else if (hasVideos && hasTextFiles) {
        queryText = 'Analyze this video with the attached text files.';
      } else if (hasVideos) {
        queryText = draftAttachments.length === 1 ? 'Analyze this video.' : 'Analyze these videos.';
      } else if (hasImages && hasTextFiles) {
        queryText = 'Analyze these files and images.';
      } else if (hasImages) {
        queryText = draftAttachments.length === 1 ? 'Analyze this image.' : 'Analyze these images.';
      } else if (hasTextFiles) {
        queryText = 'Process these files.';
      }
    }

    const estimatedModel = manualModelOverride || currentModel;
    const historyText = messages.map((msg) => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return `${msg.role}: ${content}`;
    }).join('\n');
    const imageCount = draftAttachments.filter((file) => file.isImage).length;
    const preflight = calculatePreFlightCost(
      estimatedModel,
      `${historyText}\nuser: ${queryText}`,
      imageCount,
    );
    const promptTokenEstimate = preflight.promptTokens;

    if (!skipBudgetCheck) {
      // Fetch from server first so budget cannot be bypassed by clearing localStorage or opening a new tab.
      // Falls back to localStorage total if the server is unreachable.
      const dailyTotalUsd = await fetchServerDailyTotal();
      const budgetDecision = evaluateBudget({
        estimateUsd: preflight.estimatedUsd,
        dailyTotalUsd,
        dailyLimitUsd: DAILY_BUDGET_LIMIT_USD,
      });

      if (budgetDecision.blocked) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `⚠️ ${budgetDecision.reason || 'Daily budget limit reached.'}`,
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      if (budgetDecision.requiresConfirm) {
        setBudgetConfirm({
          estimateUsd: preflight.estimatedUsd,
          dailyTotalUsd,
        });
        return;
      }
    }

    // Build display content for user message
    const attachmentSummary = draftAttachments.length > 0
      ? `[${draftAttachments.length} file${draftAttachments.length > 1 ? 's' : ''} attached]`
      : '';

    const firstImage = draftAttachments.find((f) => f.isImage);
    const userMessage: Message = {
      role: 'user',
      content: input.trim() || attachmentSummary,
      timestamp: Date.now(),
      ...(firstImage?.imageData && {
        imageData: firstImage.imageData,
        mediaType: firstImage.mediaType,
      }),
      attachments: draftAttachments.length > 0 ? [...draftAttachments] : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);

    // Clear inputs
    setInput('');
    const attachmentsToProcess = [...draftAttachments];
    setDraftAttachments([]);
    if (inputRef.current) inputRef.current.style.height = 'auto';

    setIsStreaming(true);
    setIsWaitingFirstToken(true);
    waitingFirstTokenRef.current = true;
    clearCostEstimatorHideTimer();
    setShowCostEstimator(true);
    setFinalMessageCost(null);
    setCostModel(estimatedModel);
    setCurrentUsage({
      promptTokens: promptTokenEstimate,
      completionTokens: 0,
      thinkingTokens: 0,
    });

    try {
      const storageUrls: string[] = [];
      if (user) {
        const imageAttachments = attachmentsToProcess.filter(a => a.isImage && a.imageData);
        const uploadResults = await Promise.allSettled(
          imageAttachments.map(a => uploadAttachment(a, user.id))
        );
        for (const result of uploadResults) {
          if (result.status === 'fulfilled' && result.value) {
            storageUrls.push(result.value);
          } else if (result.status === 'rejected') {
            console.warn('[ChatInterface] Storage upload failed (non-blocking):', result.reason);
          }
        }
      }

      // Pass array of attachments to the Prismatix router fetch utility.
      const result = await askPrismatix(
        queryText,
        messages,
        attachmentsToProcess,
        manualModelOverride,
        geminiFlashThinkingLevel,
        getDebatePayload(debateSelection),
      );

      if (!result) throw new Error('Failed to get response from router');

      const {
        stream,
        model,
        provider,
        complexityScore,
        modelId,
        modelOverride: appliedOverride,
        geminiFlashThinkingLevel: appliedGeminiThinkingLevel,
        costEstimateUsd,
        costPricingVersion,
        debateActive,
        debateProfile,
        debateTrigger,
        debateModel,
        debateCostNote,
      } = result;

      if (!manualModelOverride) {
        setCurrentModel(model);
      }
      setCostModel(model);
      setCurrentComplexity(complexityScore);

      const streamStartMs = Date.now();

      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: '',
        model,
        provider,
        modelId,
        modelOverride: appliedOverride,
        geminiFlashThinkingLevel: appliedGeminiThinkingLevel,
        debateActive,
        debateProfile,
        debateTrigger,
        debateModel,
        debateCostNote,
        thinkingLog: [],
        cost: costEstimateUsd !== undefined
          ? {
            estimatedUsd: costEstimateUsd,
            pricingVersion: costPricingVersion,
          }
          : undefined,
        timestamp: Date.now(),
      }]);

      const { assistantContent, thinkingLog, streamedFinalUsd, debateParticipants } = await readRouterStream(
        stream,
        promptTokenEstimate,
        {
          onFirstToken: () => {
            waitingFirstTokenRef.current = false;
            setIsWaitingFirstToken(false);
          },
          onUsageUpdate: (usage) => {
            setCurrentUsage(usage);
          },
          onContentUpdate: (content, log) => {
            setMessages((prev) => {
              const updated = [...prev];
              const lastMessage = updated[updated.length - 1];
              if (lastMessage) {
                const nextCost = lastMessage.cost
                  ? { ...lastMessage.cost }
                  : costEstimateUsd !== undefined
                  ? { estimatedUsd: costEstimateUsd, pricingVersion: costPricingVersion }
                  : undefined;
                updated[updated.length - 1] = {
                  ...lastMessage,
                  content,
                  thinkingLog: log,
                  thinkingDurationMs: Date.now() - streamStartMs,
                  cost: nextCost,
                };
              }
              return updated;
            });
            if (shouldStickToBottomRef.current) {
              messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
            }
          },
        },
      );

      const promptTokens = calculateHistoryTokens(messages) +
        estimateTokenCount(queryText) +
        attachmentsToProcess.filter((file) => file.isImage).length * 1600;
      const completionTokens = estimateTokenCount(assistantContent);
      const computedCost = calculateFinalCost(model, { promptTokens, completionTokens });
      const finalUsd = streamedFinalUsd ?? computedCost.finalUsd;
      setFinalMessageCost(finalUsd);

      if (finalUsd > 0) {
        recordCost({
          model,
          cost: finalUsd,
          pricingVersion: costPricingVersion || computedCost.pricingVersion,
        });
        setSessionCostTotal((prev) => prev + finalUsd);
      }
      setSpendRefreshKey((prev) => prev + 1);

      setMessages((prev) => {
        const updated = [...prev];
        const lastMessage = updated[updated.length - 1];
        if (lastMessage?.role === 'assistant') {
          updated[updated.length - 1] = {
            ...lastMessage,
            cost: {
              estimatedUsd: costEstimateUsd,
              finalUsd,
              pricingVersion: costPricingVersion || computedCost.pricingVersion,
            },
            thinkingLog: [...thinkingLog],
            thinkingDurationMs: Date.now() - streamStartMs,
            ...(debateParticipants && debateParticipants.length > 0
              ? { debateParticipants }
              : {}),
          };
        }
        return updated;
      });
      scheduleCostEstimatorHide(3000);
    } catch (error) {
      console.error('Stream error:', error);
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `⚠️ Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
        timestamp: Date.now(),
      }]);
      scheduleCostEstimatorHide(1500);
    } finally {
      setIsStreaming(false);
      setIsWaitingFirstToken(false);
      waitingFirstTokenRef.current = false;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleBudgetCancel = () => {
    setBudgetConfirm(null);
  };

  const handleBudgetConfirmSend = () => {
    setBudgetConfirm(null);
    void handleSend(true);
  };

  const handleReset = () => {
    if (confirm('Reset conversation? This will clear all messages.')) {
      setMessages([]);
      resetConversation();
      setCurrentModel('gemini-2.5-flash');
      setCurrentComplexity(50);
      setDraftAttachments([]);
      setManualModelOverride(null);
      setGeminiFlashThinkingLevel('high');
      setDebateSelection('off');
      setBudgetConfirm(null);
      setCurrentUsage(null);
      setSessionCostTotal(0);
      setCostModel('gemini-2.5-flash');
      setShowCostEstimator(false);
      setFinalMessageCost(null);
      clearCostEstimatorHideTimer();
      resetAutoScroll();
      setIsWaitingFirstToken(false);
      waitingFirstTokenRef.current = false;
    }
  };

  const handleSignOut = async () => {
    setShowUserMenu(false);
    await onSignOut();
  };

  const getUserDisplay = () => {
    if (!user) return '';
    return user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
  };

  const modelConfig = MODEL_CATALOG[currentModel];

  return (
    <div className='chat-container'>
      {/* Header */}
      <header className='chat-header'>
        <div className='header-content'>
          <div className='header-title'>
            <h1>Prismatix</h1>
            <span className='header-subtitle'>Adaptive Model Orchestration</span>
          </div>
          <div className='header-actions'>
            {contextStatus && <ContextStatus contextStatus={contextStatus} />}
            <SpendTracker refreshKey={spendRefreshKey} />

            {/* Model Selector - CLICKABLE */}
            <div className='model-selector-container' ref={modelSelectorRef}>
              <button
                type='button'
                className='model-indicator-button'
                onClick={() => setShowModelSelector(!showModelSelector)}
                style={{ '--model-color': modelConfig.color } as React.CSSProperties}
                title={manualModelOverride
                  ? `Manual: ${modelConfig.name}`
                  : `Auto: ${modelConfig.name}`}
              >
                <span className='model-icon'>{modelConfig.icon}</span>
                <span className='model-name'>{modelConfig.name}</span>
                {manualModelOverride && <span className='manual-badge'>Manual</span>}
                {debateSelection !== 'off' && <span className='debate-badge'>Debate</span>}
                <svg
                  className={`dropdown-chevron ${showModelSelector ? 'open' : ''}`}
                  width='12'
                  height='12'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='3'
                >
                  <polyline points='6 9 12 15 18 9' />
                </svg>
              </button>

              {/* Model Dropdown */}
              {showModelSelector && (
                <ModelSelectorDropdown
                  currentModel={currentModel}
                  currentComplexity={currentComplexity}
                  manualModelOverride={manualModelOverride}
                  geminiFlashThinkingLevel={geminiFlashThinkingLevel}
                  debateSelection={debateSelection}
                  sendValidationError={sendValidationError}
                  onModelSelect={handleModelSelect}
                  onClearOverride={clearModelOverride}
                  onGeminiThinkingChange={setGeminiFlashThinkingLevel}
                  onDebateChange={(sel) => {
                    setDebateSelection(sel);
                    if (sendValidationError) setSendValidationError(null);
                  }}
                  onClearValidationError={() => setSendValidationError(null)}
                />
              )}
            </div>

            <button
              type='button'
              onClick={handleReset}
              className='header-button'
              title='Reset conversation'
            >
              <svg
                width='18'
                height='18'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
              >
                <path d='M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' />
                <path d='M21 3v5h-5' />
                <path d='M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' />
                <path d='M3 21v-5h5' />
              </svg>
            </button>

            {/* User Menu */}
            <div className='user-menu-container' ref={userMenuRef}>
              <button
                type='button'
                onClick={() => setShowUserMenu(!showUserMenu)}
                className='user-button'
                title={user?.email || 'User menu'}
              >
                <span className='user-avatar'>
                  {getUserDisplay().charAt(0).toUpperCase()}
                </span>
              </button>

              {showUserMenu && (
                <div className='user-dropdown'>
                  <div className='user-info'>
                    <span className='user-name'>{getUserDisplay()}</span>
                    <span className='user-email'>{user?.email}</span>
                  </div>
                  <div className='dropdown-divider' />
                  <button type='button' onClick={handleSignOut} className='dropdown-item'>
                    <svg
                      width='16'
                      height='16'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='2'
                    >
                      <path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' />
                      <polyline points='16 17 21 12 16 7' />
                      <line x1='21' y1='12' x2='9' y2='12' />
                    </svg>
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Context Warning */}
      {shouldShowWarning && contextStatus && (
        <ContextWarning
          contextStatus={contextStatus}
          onNewChat={() => {
            createNewChatWithContext();
            setMessages([]);
            resetConversation();
          }}
        />
      )}

      {/* Messages Area */}
      <main
        className='chat-messages'
        ref={(el) => {
          chatMessagesRef.current = el;
        }}
        onScroll={(e) => updateStickyScrollState(e.currentTarget)}
        onTouchMove={markUserInterruption}
        onWheel={markUserInterruption}
      >
        {messages.length === 0
          ? (
            <div className='empty-state'>
              <div className='empty-icon'>🤖</div>
              <h2>Welcome, {getUserDisplay()}!</h2>
              <p>
                Prismatix will automatically select the best model based on your query complexity
              </p>
              <div className='model-grid'>
                {MODEL_ORDER.map((key) => {
                  const config = MODEL_CATALOG[key];
                  return (
                    <div
                      key={key}
                      className='model-card'
                      style={{ '--card-color': config.color } as React.CSSProperties}
                    >
                      <span className='card-icon'>{config.icon}</span>
                      <span className='card-name'>{config.shortName}</span>
                      <span className='card-desc'>{config.description}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )
          : (
            <div className='messages-list'>
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`message message-${msg.role}`}
                  ref={(el) => {
                    messageRefs.current[idx] = el;
                  }}
                >
                  <div className='message-avatar'>
                    {msg.role === 'user' ? '👤' : '🤖'}
                  </div>
                  <div className='message-content'>
                    <div className='message-header'>
                      <span className='message-role'>
                        {msg.role === 'user' ? 'You' : 'Assistant'}
                      </span>
                      {msg.model && (
                        <div className='message-metadata-container'>
                          <button
                            type='button'
                            className={`message-model-pill ${expandedMetadataIdx === idx ? 'expanded' : ''}`}
                            onClick={() => setExpandedMetadataIdx(expandedMetadataIdx === idx ? null : idx)}
                            title={msg.modelId || msg.model}
                          >
                            <span className='pill-text'>{msg.modelId || msg.model}</span>
                            <span className='info-icon'>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="16" x2="12" y2="12" />
                                <line x1="12" y1="8" x2="12.01" y2="8" />
                              </svg>
                            </span>
                          </button>
                          
                          {expandedMetadataIdx === idx && (
                            <div className='metadata-popover'>
                              {msg.provider && (
                                <div className='metadata-item'>
                                  <span className='item-label'>Provider</span>
                                  <span className='item-value'>{msg.provider}</span>
                                </div>
                              )}
                              {msg.modelOverride && msg.modelOverride !== 'auto' && (
                                <div className='metadata-item'>
                                  <span className='item-label'>Override</span>
                                  <span className='item-value'>Manual</span>
                                </div>
                              )}
                              {msg.geminiFlashThinkingLevel && (
                                <div className='metadata-item'>
                                  <span className='item-label'>Thinking</span>
                                  <span className='item-value'>{msg.geminiFlashThinkingLevel}</span>
                                </div>
                              )}
                              {msg.role === 'assistant' && shouldShowDebateBadges(msg) && (
                                <div className='metadata-debate-details'>
                                  <div className='metadata-divider' />
                                  {msg.debateProfile && (
                                    <div className='metadata-item'>
                                      <span className='item-label'>Debate</span>
                                      <span className='item-value'>{msg.debateProfile}</span>
                                    </div>
                                  )}
                                  {msg.debateTrigger && (
                                    <div className='metadata-item'>
                                      <span className='item-label'>Trigger</span>
                                      <span className='item-value'>{msg.debateTrigger}</span>
                                    </div>
                                  )}
                                  {msg.debateModel && (
                                    <div className='metadata-item'>
                                      <span className='item-label'>Synth</span>
                                      <span className='item-value'>{msg.debateModel}</span>
                                    </div>
                                  )}
                                  {msg.debateCostNote && (
                                    <div className='metadata-item'>
                                      <span className='item-label'>Cost Note</span>
                                      <span className='item-value'>{msg.debateCostNote}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      <CostBadge cost={msg.cost} />
                      <span className='message-time'>
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    {/* Render images if present */}
                    {msg.imageData && (
                      <div className='message-image-container'>
                        <img
                          src={`data:${msg.mediaType || 'image/png'};base64,${msg.imageData}`}
                          alt='Uploaded content'
                          className='message-image'
                        />
                      </div>
                    )}
                    {/* Show attachment count if multiple */}
                    {msg.attachments && msg.attachments.length > 1 && (
                      <div className='message-attachments-badge'>
                        📎 {msg.attachments.length} files attached
                      </div>
                    )}
                    {msg.role === 'assistant' && (
                      <ThinkingProcess
                        thoughts={msg.thinkingLog}
                        elapsedMs={msg.thinkingDurationMs}
                      />
                    )}
                    <div className='message-text'>
                      {typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}
                      {isStreaming && idx === messages.length - 1 && msg.role === 'assistant' && (
                        <span className='cursor-blink'>▊</span>
                      )}
                    </div>
                    {msg.role === 'assistant' && msg.debateParticipants && msg.debateParticipants.length > 0 && (
                      <DebateView participants={msg.debateParticipants} />
                    )}
                    {isWaitingFirstToken && isStreaming && idx === messages.length - 1 &&
                      msg.role === 'assistant' && (
                      <div className='message-thinking-loader'>
                        <PrismatixPulse
                          color={msg.model ? MODEL_CATALOG[msg.model].color : modelConfig.color}
                          showLogo
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
      </main>

      {/* Input Area */}
      <div className='chat-input-container'>
        <div className='input-wrapper'>
          <AttachmentPreview
            attachments={draftAttachments}
            onRemove={removeAttachment}
            onClearAll={clearAllAttachments}
          />

          {/* Input Row */}
          <div className='input-row'>
            <FileUpload
              onFileContent={handleFileSelect}
              onMultipleFiles={handleMultipleFiles}
              disabled={isStreaming}
              maxFiles={10}
            />
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={draftAttachments.length > 0
                ? hasPendingVideoUploads
                  ? 'Video is processing... sending is disabled until ready.'
                  : 'Add a message (optional)...'
                : 'Ask anything... (Shift+Enter for new line)'}
              className='chat-input'
              disabled={isStreaming}
              rows={1}
            />
            <button
              type='button'
              onClick={() => {
                void handleSend();
              }}
              disabled={(!input.trim() && draftAttachments.length === 0) || isStreaming || hasPendingVideoUploads}
              className='send-button'
              title={hasPendingVideoUploads ? 'Video processing in progress' : 'Send message'}
            >
              {isWaitingFirstToken ? <div className='loading-spinner' /> : (
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
          </div>
          {sendValidationError && (
            <div className='send-validation-error'>
              {sendValidationError}
            </div>
          )}
        </div>
      </div>

      <BudgetGuard
        isOpen={!!budgetConfirm}
        estimateUsd={budgetConfirm?.estimateUsd || 0}
        dailyTotalUsd={budgetConfirm?.dailyTotalUsd || 0}
        dailyLimitUsd={DAILY_BUDGET_LIMIT_USD}
        onCancel={handleBudgetCancel}
        onConfirm={handleBudgetConfirmSend}
      />

      <CostEstimator
        model={costModel}
        usage={currentUsage}
        isVisible={showCostEstimator}
        isStreaming={isStreaming}
        totalCost={sessionCostTotal}
        finalCostUsd={finalMessageCost}
      />
    </div>
  );
};
