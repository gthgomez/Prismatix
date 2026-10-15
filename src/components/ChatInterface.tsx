// src/components/ChatInterface.tsx
// Main chat interface with multi-file upload support and model selector

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isHistoricModel } from '../../supabase/functions/_shared/model_lifecycle';
import { useContextManager } from '../hooks/useContextManager';
import {
  isCatalogSkewed,
  subscribeCatalogSkew,
  getServerTariffVersion,
  CLIENT_TARIFF_VERSION,
} from '../catalogSkew';
import { ContextWarning } from './ContextWarning';
import { ContextStatus } from './ContextStatus';
import { BudgetGuard, evaluateBudget } from './BudgetGuard';
import { CostEstimator } from './CostEstimator';
import { SpendTracker } from './SpendTracker';
import { ModelSelectorDropdown } from './ModelSelectorDropdown';
import { ConversationSidebar } from './ConversationSidebar';
import { ChatBackdrop } from './ChatBackdrop';
import { ChatMessageItem } from './ChatMessageItem';
import { ScrollToBottomButton } from './ScrollToBottomButton';
import { ChatInputComposer } from './ChatInputComposer';
import {
  type StreamOutcomeState,
  type PromptStarter,
  SEND_BLOCKED_TITLES,
} from './chatTypes';
import '../styles/ChatInterface.css';
import {
  askPrismatix,
  DuplicateRequestError,
  getConversationId,
  resetConversation,
  setConversationId,
} from '../smartFetch';
import { supabase } from '../lib/supabase';
import {
  deleteConversation,
  listConversations,
  loadConversation,
  renameConversation,
  selectContextHistory,
  signAttachment,
  type ConversationSummary,
  type LoadedMessage,
} from '../services/conversationService';
import {
  NEW_CHAT_SELECTION,
  planInitialConversation,
  readSelectedConversation,
  streamUpdateAppliesToActive,
  writeSelectedConversation,
} from '../services/conversationState';
import type { AttachmentRef } from '../../supabase/functions/_shared/conversation_attachments';
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
import { MODEL_HIGHLIGHTS, MODEL_ORDER, getCatalogEntry } from '../modelCatalog';
import { filterVisibleModels, isModelVisible } from '../providerRegistry';
import { useProviderPlugins } from '../hooks/useProviderPlugins';
import { useModelPickerPreferences } from '../hooks/useModelPickerPreferences';
import { ProviderSettings } from './ProviderSettings';
import { MemorySettings } from './MemorySettings';
import {
  getComposerSendValidationView,
  VIDEO_UI_DEBATE_SEND_ERROR,
} from '../sendValidationPresentation';
import type { User } from '@supabase/supabase-js';
import {
  getDebatePayload,
  hasReadyVideoAttachment,
  type DebateSelection,
} from '../debateMode';

interface ChatInterfaceProps {
  user: User | null;
  onSignOut: () => Promise<void>;
}

const DAILY_BUDGET_LIMIT_USD = 2.0;
const VIDEO_NAME_PATTERN = /\.(mp4|mov|avi|mkv|webm|m4v)$/i;
const CHATS_HIDDEN_KEY = 'prismatix.sidebar.chatsHidden';

const PROMPT_STARTERS: PromptStarter[] = [
  {
    title: 'Build something',
    prompt: 'Help me turn an idea into a practical build plan. Start by asking what I want to create.',
  },
  {
    title: 'Compare ideas',
    prompt: 'Help me compare two approaches to a problem. Ask about my options and what matters most before recommending one.',
  },
  {
    title: 'Understand a topic',
    prompt: 'Help me understand a topic step by step, using clear explanations and concrete examples. Ask what I want to learn.',
  },
];

function shouldTreatAsVideoAttachment(file: FileUploadPayload): boolean {
  if (file.kind === 'video') return true;
  if (typeof file.mediaType === 'string' && file.mediaType.toLowerCase().startsWith('video/')) {
    return true;
  }
  return VIDEO_NAME_PATTERN.test(file.name || '');
}

// Router/edge error codes arrive as terse message strings; map the known ones
// to user-actionable text instead of surfacing raw codes like "not_entitled".
function describeStreamError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const code = raw.replace(/^Error:\s*/i, '').trim();
  switch (code) {
    case 'not_entitled':
      return 'Your account doesn\u2019t have access to this feature yet. If you just signed up, sign out and back in once \u2014 if it still fails, contact support.';
    case 'entitlement_unavailable':
      return 'We couldn\u2019t verify your account access right now. Please try again in a moment.';
    case 'DuplicateRequestError':
    case 'duplicate_request':
      return 'That exact request was already sent just now. Edit your message slightly and send again.';
    default:
      return raw ? `Error: ${raw}` : 'Unknown error occurred';
  }
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
  const [currentModel, setCurrentModel] = useState<RouterModel>('gemini-3.8-flash');
  const [currentComplexity, setCurrentComplexity] = useState<number>(50);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  // Server/client tariff skew (PX02 release identity): subtle hint only.
  const [catalogSkewed, setCatalogSkewed] = useState(isCatalogSkewed());
  useEffect(() => subscribeCatalogSkew(() => setCatalogSkewed(isCatalogSkewed())), []);
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
  const [routerPricingVersion, setRouterPricingVersion] = useState<string | undefined>(undefined);
  const [debateSelection, setDebateSelection] = useState<DebateSelection>('off');
  const [sendValidationError, setSendValidationError] = useState<string | null>(null);
  const [expandedMetadataIdx, setExpandedMetadataIdx] = useState<number | null>(null);
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [showMemorySettings, setShowMemorySettings] = useState(false);
  const [lastRecall, setLastRecall] = useState<{ conversationId: string; hits: number } | null>(null);

  // Provider plug-ins (PX12): which providers are on for this user.
  const providerPlugins = useProviderPlugins(user?.id);
  const enabledProviders = providerPlugins.enabledProviders;

  // Single authoritative model preferences store (favorites, hidden models, provider tabs)
  const modelPreferences = useModelPickerPreferences(user?.id);

  // If the active model's provider is turned off OR the manual override model was hidden by the user,
  // fall back to Auto with a visible default so we never send to a hidden/disabled provider or model.
  useEffect(() => {
    if (providerPlugins.loading) return;

    const isCurrentVisible = isModelVisible(currentModel, { enabledProviders });
    const isOverrideHidden = manualModelOverride !== null && modelPreferences.hiddenModels.includes(manualModelOverride);

    if (isCurrentVisible && !isOverrideHidden && (manualModelOverride !== null || !isHistoricModel(currentModel))) {
      return;
    }

    const unhiddenHighlights = filterVisibleModels(MODEL_HIGHLIGHTS, { enabledProviders })
      .filter((id) => !modelPreferences.hiddenModels.includes(id));
    const unhiddenOrder = filterVisibleModels(MODEL_ORDER, { enabledProviders })
      .filter((id) => !isHistoricModel(id) && !modelPreferences.hiddenModels.includes(id));

    const fallback = unhiddenHighlights[0] ?? unhiddenOrder[0];
    setManualModelOverride(null);
    if (fallback) setCurrentModel(fallback);
  }, [
    providerPlugins.loading,
    enabledProviders,
    currentModel,
    manualModelOverride,
    modelPreferences.hiddenModels,
  ]);

  const [draftAttachments, setDraftAttachments] = useState<FileUploadPayload[]>([]);
  const hasPendingVideoUploads = draftAttachments.some(
    (file) => file.kind === 'video' && file.status !== 'ready',
  );
  const hasReadyVideo = hasReadyVideoAttachment(draftAttachments);

  // PX07 conversation continuity state.
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Past-chats visibility, persisted per browser. Hidden means the list is
  // collapsed; the header history button brings it back.
  const [chatsHidden, setChatsHidden] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(CHATS_HIDDEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [contextExcludedCount, setContextExcludedCount] = useState(0);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  // Monotonic token so a stale conversation load can never overwrite the
  // messages of a newer selection (rapid A→B switching).
  const conversationLoadSeqRef = useRef(0);
  const activeStreamRef = useRef<{
    conversationId: string;
    clientRequestId: string | null;
  } | null>(null);

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
    showScrollButton,
    updateStickyScrollState,
    markUserInterruption,
    resetAutoScroll,
  } = useAutoScroll(32);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const handleScrollToBottom = useCallback(() => {
    resetAutoScroll();
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [resetAutoScroll]);
  const waitingFirstTokenRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(44, Math.min(textarea.scrollHeight, 200))}px`;
  }, [input]);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const modelSelectorRef = useRef<HTMLDivElement>(null);
  const chatHeaderRef = useRef<HTMLElement>(null);
  const costEstimatorHideTimeoutRef = useRef<number | null>(null);
  // PX06: the in-flight request's abort controller (Stop control) and the
  // terminal outcome surfaced to the user (cancelled, or the receipt state).
  const abortControllerRef = useRef<AbortController | null>(null);
  const executionIdRef = useRef<string | undefined>(undefined);
  const [streamOutcome, setStreamOutcome] = useState<StreamOutcomeState | null>(null);

  // Scroll only when a new message bubble is created, and only if user is near bottom.
  useEffect(() => {
    if (messages.length === 0) return;
    if (!shouldStickToBottomRef.current) return;
    const lastMessage = messageRefs.current[messages.length - 1];
    if (lastMessage) {
      if (typeof lastMessage.scrollIntoView === 'function') {
        lastMessage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages.length]);

  // Keep attachment preview visible when user is already at bottom.
  useEffect(() => {
    if (!shouldStickToBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [draftAttachments.length]);

  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false);
  const dragCounterRef = useRef(0);

  // Global Drag & Drop Handler
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current += 1;
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        setIsDraggingGlobal(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDraggingGlobal(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggingGlobal(false);
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  // Close dropdowns & metadata popovers on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
      if (modelSelectorRef.current && !modelSelectorRef.current.contains(e.target as Node)) {
        setShowModelSelector(false);
      }
      const target = e.target as HTMLElement;
      if (expandedMetadataIdx !== null && !target.closest('.message-metadata-container')) {
        setExpandedMetadataIdx(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [expandedMetadataIdx]);

  // All draft changes (including suggestions and resets) resize in the layout effect.
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (sendValidationError) {
      setSendValidationError(null);
    }
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

  // Narrow viewports: measured header box drives a fixed model menu (`top` + max-height)
  // so it clears notches, safe areas, and #root overflow without clipping the menu header.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = chatHeaderRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const apply = () => {
      const r = el.getBoundingClientRect();
      const topPx = Math.ceil(r.bottom) + 6;
      root.style.setProperty('--prismatix-model-dropdown-top', `${topPx}px`);
      root.style.setProperty('--prismatix-chat-header-h', `${Math.ceil(r.height)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener('orientationchange', apply);
    window.visualViewport?.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', apply);
      window.visualViewport?.removeEventListener('resize', apply);
      root.style.removeProperty('--prismatix-model-dropdown-top');
      root.style.removeProperty('--prismatix-chat-header-h');
    };
  }, []);

  // ── PX07 conversation continuity ─────────────────────────────────────────
  const mapLoadedMessages = async (loaded: LoadedMessage[]): Promise<Message[]> => {
    const mapped: Message[] = [];
    for (const item of loaded) {
      const attachments: FileUploadPayload[] = [];
      for (const ref of item.attachments) {
        if (ref.kind === 'image') {
          const signed = ref.storageRef ? await signAttachment(supabase, ref) : null;
          attachments.push({
            name: 'image',
            kind: 'image',
            isImage: true,
            // Never fall back to the raw `supabase://…` reference as an <img>
            // src; a failed signature renders a placeholder instead.
            ...(signed ? { storageUrl: signed } : { errorCode: 'image_unavailable' }),
          });
        } else if (ref.kind === 'file') {
          attachments.push({
            name: ref.name ?? 'file',
            kind: 'text',
            isImage: false,
            ...(ref.size !== null && ref.size !== undefined ? { size: ref.size } : {}),
          });
        } else {
          attachments.push({
            name: 'video',
            kind: 'video',
            isImage: false,
            status: 'ready',
            ...(ref.videoAssetId ? { videoAssetId: ref.videoAssetId } : {}),
          });
        }
      }
      const provenance = item.provenance;
      mapped.push({
        role: item.role,
        content: item.content,
        timestamp: Date.parse(item.createdAt) || Date.now(),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(provenance?.model ? { model: provenance.model } : {}),
        ...(provenance?.modelId ? { modelId: provenance.modelId } : {}),
        ...(provenance?.provider ? { provider: provenance.provider } : {}),
        ...(provenance?.routeRole ? { routeRole: provenance.routeRole } : {}),
        ...(provenance?.cost
          ? {
              cost: {
                finalUsd: provenance.cost.totalUsd,
                pricingVersion: provenance.cost.pricingVersion,
              },
            }
          : {}),
        ...(provenance?.routeRationale
          ? {
              routeInfo: {
                selection: provenance.routeRationale === 'manual_override' ? 'override' : 'auto',
                modelTier: provenance.model || currentModel,
                gateway: provenance.provider === 'opencode' ? 'opencode' : 'direct_fallback',
                reason: provenance.routeRationale,
                fallbackUsed: false,
                priceKnown: true,
                role: provenance.routeRole,
              },
            }
          : {}),
      });
    }
    return mapped;
  };

  const refreshConversations = async () => {
    setConversationsLoading(true);
    try {
      const list = await listConversations(supabase, { limit: 50 });
      setConversations(list);
    } catch (error) {
      console.warn('[ChatInterface] Failed to list conversations:', error);
    } finally {
      setConversationsLoading(false);
    }
  };

  const openConversation = async (conversationId: string) => {
    const loadSeq = ++conversationLoadSeqRef.current;
    selectedConversationIdRef.current = conversationId;
    setSelectedConversationId(conversationId);
    setConversationId(conversationId);
    setDuplicateNotice(null);
    setContextExcludedCount(0);
    try {
      const loaded = await loadConversation(supabase, conversationId, { limit: 200 });
      // Ignore a stale load: a newer selection (or a New Chat / account-change
      // clear) superseded this one.
      if (
        loadSeq !== conversationLoadSeqRef.current ||
        selectedConversationIdRef.current !== conversationId
      ) {
        return;
      }
      const mapped = await mapLoadedMessages(loaded);
      // PX08: Re-check after asynchronous attachment signing. A user action
      // (New Chat, switching conversations, or logging out) during storage signing
      // must not be overwritten by the late-resolving load.
      if (
        loadSeq !== conversationLoadSeqRef.current ||
        selectedConversationIdRef.current !== conversationId
      ) {
        return;
      }
      setMessages(mapped);
    } catch (error) {
      if (
        loadSeq !== conversationLoadSeqRef.current ||
        selectedConversationIdRef.current !== conversationId
      ) {
        return;
      }
      console.warn('[ChatInterface] Failed to load conversation:', error);
      setMessages([]);
    }
  };

  const handleSelectConversation = (conversationId: string) => {
    if (isStreaming || conversationId === selectedConversationIdRef.current) return;
    writeSelectedConversation(user?.id ?? null, conversationId);
    void openConversation(conversationId);
  };

  const handleNewChat = () => {
    if (isStreaming) return;
    // Invalidate any in-flight conversation load: a pending load must not
    // overwrite the fresh New Chat state when it resolves.
    conversationLoadSeqRef.current += 1;
    selectedConversationIdRef.current = null;
    setSelectedConversationId(null);
    writeSelectedConversation(user?.id ?? null, NEW_CHAT_SELECTION);
    resetConversation();
    setMessages([]);
    setDraftAttachments([]);
    setDuplicateNotice(null);
    setContextExcludedCount(0);
  };

  const toggleChatsHidden = () => {
    setChatsHidden((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(CHATS_HIDDEN_KEY, next ? '1' : '0');
      } catch {
        // Storage unavailable (private mode etc.) — state still toggles for the session.
      }
      return next;
    });
    if (!chatsHidden) setSidebarOpen(false);
  };

  const handleSidebarToggle = () => {
    // If past chats are collapsed, the ☰ button reveals them (and opens the drawer on mobile).
    if (chatsHidden) {
      setChatsHidden(false);
      try {
        window.localStorage.setItem(CHATS_HIDDEN_KEY, '0');
      } catch {
        // ignore
      }
    }
    setSidebarOpen((prev) => !prev);
  };

  const handleRenameConversation = async (conversationId: string, title: string) => {
    try {
      await renameConversation(supabase, conversationId, title);
    } catch (error) {
      console.error('[ChatInterface] Failed to rename conversation:', error);
    }
    await refreshConversations();
  };

  const handleDeleteConversation = async (conversationId: string) => {
    if (isStreaming) return;
    if (!confirm('Delete this chat? Its messages and any images used only here will be removed.')) {
      return;
    }
    try {
      await deleteConversation(supabase, conversationId);
    } catch (error) {
      console.error('[ChatInterface] Failed to delete conversation:', error);
    }
    await refreshConversations();
    if (selectedConversationIdRef.current === conversationId) {
      handleNewChat();
    }
  };

  // Per-account selection: restore on sign-in/account change, isolated by user.
  useEffect(() => {
    const plan = planInitialConversation(readSelectedConversation(user?.id ?? null));
    // Account-change isolation: a new account with no stored selection must not
    // inherit the shared `prismatix_conversation_id` from the previous account.
    if (plan.resetGlobalConversation) {
      resetConversation();
    }
    void refreshConversations();
    if (plan.conversationId) {
      void openConversation(plan.conversationId);
    } else {
      // Account-change isolation also invalidates any in-flight load from the
      // prior account so its messages can never be applied to the new account.
      conversationLoadSeqRef.current += 1;
      selectedConversationIdRef.current = null;
      setSelectedConversationId(null);
      setMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const streamUpdateApplies = (): boolean => {
    const active = activeStreamRef.current;
    return streamUpdateAppliesToActive({
      activeConversationId: selectedConversationIdRef.current,
      activeClientRequestId: active?.clientRequestId ?? null,
      updateConversationId: active?.conversationId ?? null,
      updateClientRequestId: active?.clientRequestId ?? null,
    });
  };

  const executeTurn = async ({
    queryText,
    attachmentsToProcess,
    historyMessages,
    overrideModel,
    promptTokenEstimate: passedPromptTokenEstimate,
    skipBudgetCheck = false,
  }: {
    queryText: string;
    attachmentsToProcess: FileUploadPayload[];
    historyMessages: Message[];
    overrideModel?: RouterModel | null;
    promptTokenEstimate?: number;
    skipBudgetCheck?: boolean;
  }) => {
    const estimatedModel = overrideModel || manualModelOverride || currentModel;
    const historyText = historyMessages.map((msg) => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return `${msg.role}: ${content}`;
    }).join('\n');
    const imageCount = attachmentsToProcess.filter((file) => file.isImage).length;
    const preflight = calculatePreFlightCost(
      estimatedModel,
      `${historyText}\nuser: ${queryText}`,
      imageCount,
    );
    const promptTokenEstimate = passedPromptTokenEstimate ?? preflight.promptTokens;

    if (!skipBudgetCheck) {
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
        pendingActionRef.current = () => void executeTurn({
          queryText,
          attachmentsToProcess,
          historyMessages,
          overrideModel,
          promptTokenEstimate,
          skipBudgetCheck: true,
        });
        setBudgetConfirm({
          estimateUsd: preflight.estimatedUsd,
          dailyTotalUsd,
        });
        return;
      }
    }

    // PX07: pin the active conversation for this logical send (the selected
    // conversation, or the deterministic New Chat id).
    const sendConversationId = selectedConversationIdRef.current ?? getConversationId();
    if (selectedConversationIdRef.current) {
      setConversationId(selectedConversationIdRef.current);
    }
    activeStreamRef.current = null;

    // PX07 bounded context (group 3): send only the sanctioned recent window,
    // and surface how many older messages fall outside it.
    const contextSelection = selectContextHistory(historyMessages);
    setContextExcludedCount(contextSelection.excludedCount);
    const historyForRequest = contextSelection.history.map((item) => ({
      role: item.role,
      content: item.content,
      timestamp: 0,
    })) as Message[];

    setIsStreaming(true);
    setIsWaitingFirstToken(true);
    waitingFirstTokenRef.current = true;
    clearCostEstimatorHideTimer();
    setShowCostEstimator(true);
    setFinalMessageCost(null);
    setRouterPricingVersion(undefined);
    setCostModel(estimatedModel);
    setCurrentUsage({
      promptTokens: promptTokenEstimate,
      completionTokens: 0,
      thinkingTokens: 0,
    });

    // PX06: one AbortController per send; the Stop control aborts it.
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    executionIdRef.current = undefined;
    setStreamOutcome(null);

    try {
      // PX07: upload every draft image, preserving its ORIGINAL ordinal. A
      // failed upload stays an unavailable entry so later ordinals do not shift.
      const uploadResults = await Promise.allSettled(
        attachmentsToProcess.map((file) =>
          file.isImage && file.imageData && user
            ? uploadAttachment(file, user.id)
            : Promise.resolve(null),
        ),
      );
      const attachmentRefs: AttachmentRef[] = [];
      let firstImageStorageRef: string | undefined;
      attachmentsToProcess.forEach((file, ordinal) => {
        const upload = uploadResults[ordinal];
        if (file.isImage && file.imageData) {
          const storageRef =
            upload && upload.status === 'fulfilled' ? upload.value : null;
          if (storageRef && !firstImageStorageRef) firstImageStorageRef = storageRef;
          attachmentRefs.push({
            ordinal,
            kind: 'image',
            storageRef,
            videoAssetId: null,
            available: !!storageRef,
          });
        } else if (file.kind === 'video' && file.videoAssetId && file.status === 'ready') {
          attachmentRefs.push({
            ordinal,
            kind: 'video',
            storageRef: null,
            videoAssetId: file.videoAssetId,
            available: true,
          });
        } else if (!file.isImage && file.kind !== 'video') {
          // Text/code attachments are persisted as metadata only (name/size);
          // their content stays in the model input.
          attachmentRefs.push({
            ordinal,
            kind: 'file',
            storageRef: null,
            videoAssetId: null,
            available: true,
            name: file.name ?? null,
            size: file.size ?? file.sizeBytes ?? null,
          });
        }
      });

      // Pass array of attachments to the Prismatix router fetch utility.
      const result = await askPrismatix(
        queryText,
        historyForRequest,
        attachmentsToProcess,
        overrideModel || manualModelOverride,
        geminiFlashThinkingLevel,
        getDebatePayload(debateSelection),
        firstImageStorageRef,
        abortController.signal,
        attachmentRefs,
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
        routeInfo,
        debateActive,
        debateProfile,
        debateTrigger,
        debateModel,
        debateCostNote,
        executionId,
        clientRequestId,
      } = result;

      executionIdRef.current = executionId;
      if (result.memoryHits !== undefined) setLastRecall({ conversationId: sendConversationId, hits: result.memoryHits });

      // PX07: stream/delta updates are guarded by (conversationId, requestId).
      activeStreamRef.current = {
        conversationId: sendConversationId,
        clientRequestId: clientRequestId ?? null,
      };
      // A New Chat becomes a real, selected conversation once its first send
      // creates the durable execution, so reload reopens it.
      if (selectedConversationIdRef.current === null) {
        selectedConversationIdRef.current = sendConversationId;
        setSelectedConversationId(sendConversationId);
        writeSelectedConversation(user?.id ?? null, sendConversationId);
      }

      if (!manualModelOverride && !overrideModel) {
        setCurrentModel(model);
      }
      setCostModel(model);
      setRouterPricingVersion(costPricingVersion ?? undefined);
      setCurrentComplexity(complexityScore);

      const streamStartMs = Date.now();

      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: '',
        model,
        provider,
        modelId,
        modelOverride: appliedOverride,
        routeInfo,
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

      const { assistantContent, thinkingLog, streamedFinalUsd, debateParticipants, receipt } = await readRouterStream(
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
            if (!streamUpdateApplies()) return;
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
        abortController.signal,
      );

      // PX06: an abort mid-stream makes readRouterStream resolve with the
      // partial content; surface the cancellation instead of a completion.
      if (abortController.signal.aborted) {
        setStreamOutcome({ status: 'cancelled', executionId });
        scheduleCostEstimatorHide(1500);
        return;
      }

      // PX06: surface the terminal receipt (execution id + settlement state).
      setStreamOutcome({
        status: 'receipt',
        executionId: receipt?.executionId ?? executionId,
        settlementState: receipt?.settlement.state,
      });

      const promptTokens = calculateHistoryTokens(historyMessages) +
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

      if (streamUpdateApplies()) {
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
      }
      scheduleCostEstimatorHide(3000);
      // PX07: the list/title changed server-side; refresh in the background.
      void refreshConversations();
    } catch (error) {
      if (error instanceof DuplicateRequestError) {
        // PX07: the same logical send already created an execution. Load/show
        // the existing turn; never auto-dispatch a new paid request.
        setDuplicateNotice(
          error.executionId
            ? `This request was already recorded (execution ${error.executionId.slice(0, 8)}).`
            : 'This request was already recorded.',
        );
        if (selectedConversationIdRef.current) {
          await openConversation(selectedConversationIdRef.current);
        }
        scheduleCostEstimatorHide(1500);
      } else if (abortController.signal.aborted) {
        // PX06: a user Stop is a cancellation, not an error. Surface it and the
        // execution identity (the server finalizes the execution `cancelled`).
        setStreamOutcome({ status: 'cancelled', executionId: executionIdRef.current });
        scheduleCostEstimatorHide(1500);
      } else {
        console.error('Stream error:', error);
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `⚠️ ${describeStreamError(error)}`,
          timestamp: Date.now(),
        }]);
        scheduleCostEstimatorHide(1500);
      }
    } finally {
      abortControllerRef.current = null;
      activeStreamRef.current = null;
      setIsStreaming(false);
      setIsWaitingFirstToken(false);
      waitingFirstTokenRef.current = false;
    }
  };

  const handleSend = async (skipBudgetCheck = false) => {
    // Allow send if there's text OR attachments
    const hasContent = input.trim() || draftAttachments.length > 0;
    if (!hasContent || isStreaming || hasPendingVideoUploads) return;
    if (debateSelection === 'video_ui' && !hasReadyVideo) {
      setSendValidationError(VIDEO_UI_DEBATE_SEND_ERROR);
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
        pendingActionRef.current = () => void handleSend(true);
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

    const historyForRequest = [...messages];
    setMessages((prev) => [...prev, userMessage]);

    // Clear inputs
    setInput('');
    const attachmentsToProcess = [...draftAttachments];
    setDraftAttachments([]);
    if (inputRef.current) inputRef.current.style.height = 'auto';

    await executeTurn({
      queryText,
      attachmentsToProcess,
      historyMessages: historyForRequest,
      overrideModel: manualModelOverride,
      promptTokenEstimate,
      skipBudgetCheck: true,
    });
  };

  const handleRegenerate = async (index: number, modelOverride?: RouterModel) => {
    if (isStreaming) return;
    let userIndex = -1;
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') {
        userIndex = i;
        break;
      }
    }
    if (userIndex === -1) return;

    const userMessage = messages[userIndex];
    if (!userMessage) return;
    const userPrompt = typeof userMessage.content === 'string' ? userMessage.content : '';
    const attachmentsToProcess = userMessage.attachments ? [...userMessage.attachments] : [];
    const historyBeforeUser = messages.slice(0, userIndex);

    // Keep messages up to user message, discarding the old assistant turn
    setMessages(messages.slice(0, userIndex + 1));
    resetAutoScroll();

    await executeTurn({
      queryText: userPrompt,
      attachmentsToProcess,
      historyMessages: historyBeforeUser,
      overrideModel: modelOverride !== undefined ? modelOverride : manualModelOverride,
    });
  };

  const handleEditPrompt = async (index: number, newPrompt: string) => {
    if (isStreaming) return;
    const targetUserMessage = messages[index];
    if (!targetUserMessage || targetUserMessage.role !== 'user') return;

    const attachmentsToProcess = targetUserMessage.attachments ? [...targetUserMessage.attachments] : [];
    const historyBeforeUser = messages.slice(0, index);

    const updatedUserMessage: Message = {
      ...targetUserMessage,
      content: newPrompt,
      timestamp: Date.now(),
    };

    // Discard any messages after index, set the edited user message
    setMessages([...historyBeforeUser, updatedUserMessage]);
    resetAutoScroll();

    await executeTurn({
      queryText: newPrompt,
      attachmentsToProcess,
      historyMessages: historyBeforeUser,
      overrideModel: manualModelOverride,
    });
  };

  const handleFeedback = (index: number, type: 'up' | 'down') => {
    setMessages((prev) => {
      const updated = [...prev];
      const target = updated[index];
      if (target) {
        updated[index] = {
          ...target,
          feedback: target.feedback === type ? undefined : type,
        };
      }
      return updated;
    });
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleBudgetCancel = () => {
    pendingActionRef.current = null;
    setBudgetConfirm(null);
  };

  const handleBudgetConfirmSend = () => {
    setBudgetConfirm(null);
    if (pendingActionRef.current) {
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      action();
    } else {
      void handleSend(true);
    }
  };

  const handleReset = () => {
    if (confirm('Reset conversation? This will clear all messages.')) {
      // Start a fresh deterministic conversation (New Chat) and clear selection.
      handleNewChat();
      setCurrentModel('gemini-3.8-flash');
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
      setRouterPricingVersion(undefined);
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

  const handleToggleMetadata = useCallback((idx: number) => {
    setExpandedMetadataIdx((prev) => (prev === idx ? null : idx));
  }, []);

  const registerMessageRef = useCallback((idx: number, el: HTMLDivElement | null) => {
    messageRefs.current[idx] = el;
  }, []);

  // Server-selected IDs can be ahead of the deployed catalog; degrade, never crash.
  const modelConfig = getCatalogEntry(currentModel);
  const composerValidationView = getComposerSendValidationView(sendValidationError);
  // Why the composer cannot send right now, surfaced on the send control itself
  // so its disabled state is self-explanatory and never looks actionable.
  const sendBlockedReason = isStreaming
    ? 'streaming'
    : hasPendingVideoUploads
      ? 'video'
      : sendValidationError
        ? 'invalid'
        : !input.trim() && draftAttachments.length === 0
          ? 'empty'
          : null;

  const openRoutingDebateMenu = () => {
    setShowUserMenu(false);
    setShowModelSelector(true);
  };

  return (
    <div className='app-with-sidebar'>
      {!chatsHidden && (
        <ConversationSidebar
          preferenceScope={user?.id ?? null}
          conversations={conversations}
          selectedId={selectedConversationId}
          isLoading={conversationsLoading}
          disabled={isStreaming}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onRename={(id, title) => void handleRenameConversation(id, title)}
          onSelect={handleSelectConversation}
          onNewChat={handleNewChat}
          onDelete={(id) => void handleDeleteConversation(id)}
        />
      )}
      <div className={`chat-container ${messages.length === 0 ? 'is-empty' : ''}`}>
      <ChatBackdrop />
      {/* Header */}
      <header className='chat-header' ref={chatHeaderRef}>
        <div className='header-content'>
          <div className='header-left'>
            <button
              type='button'
              className='sidebar-toggle-button'
              onClick={handleSidebarToggle}
              aria-label='Toggle conversations sidebar'
              aria-expanded={sidebarOpen}
            >
              ☰
            </button>
            <button
              type='button'
              className='header-button chats-toggle-button'
              onClick={toggleChatsHidden}
              aria-pressed={!chatsHidden}
              aria-label={chatsHidden ? 'Show past chats' : 'Hide past chats'}
              data-tooltip={chatsHidden ? 'Show past chats' : 'Hide past chats'}
              title={chatsHidden ? 'Show past chats' : 'Hide past chats'}
            >
              <svg
                width='18'
                height='18'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                aria-hidden='true'
              >
                {chatsHidden ? (
                  <>
                    <path d='M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' />
                    <path d='M3 3v5h5' />
                    <polyline points='12 7 12 12 15 15' />
                  </>
                ) : (
                  <>
                    <path d='M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' />
                    <path d='M21 3v5h-5' />
                    <polyline points='12 7 12 12 9 15' />
                  </>
                )}
              </svg>
            </button>
            <div className='header-title'>
              <img className='header-brand-mark' src='/prismatix-icon-draft.svg' alt='' />
              <h1>Prismatix</h1>
            </div>
          </div>
          <div className='header-actions'>
          {contextStatus && (
            <details className='context-disclosure'>
              <summary title='View conversation context usage' aria-label='Conversation context usage'>
                <span className='context-trigger-dot' aria-hidden='true' />
                <span>Context</span>
              </summary>
              <div className='context-popover'><ContextStatus contextStatus={contextStatus} /></div>
            </details>
          )}
            {catalogSkewed && (
              <span
                className='catalog-skew-hint'
                title={`Server model catalog (${getServerTariffVersion()}) differs from this client's (${CLIENT_TARIFF_VERSION}); prices and availability may not match.`}
              >
                catalog may be outdated
              </span>
            )}
            <SpendTracker refreshKey={spendRefreshKey} />

            {/* Model Selector - CLICKABLE */}
            <div className='model-selector-container' ref={modelSelectorRef}>
              <button
                type='button'
                className='model-indicator-button'
                aria-label={manualModelOverride ? `Choose model: ${modelConfig.name}` : 'Choose routing mode: automatic'}
                aria-expanded={showModelSelector}
                onClick={() => setShowModelSelector(!showModelSelector)}
                style={{ '--model-color': manualModelOverride ? modelConfig.color : 'var(--color-primary)' } as React.CSSProperties}
                title={manualModelOverride
                  ? `Manual: ${modelConfig.name}`
                  : 'Automatic model selection; choose a manual override'}
              >
                {manualModelOverride && <span className='model-icon' aria-hidden='true'>{modelConfig.icon}</span>}
                <span className='model-name'>
                  {manualModelOverride ? modelConfig.name : (
                    <><span className='routing-label-wide'>Auto routing</span><span className='routing-label-compact'>Auto</span></>
                  )}
                </span>
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
                  enabledProviders={enabledProviders}
                  preferences={modelPreferences}
                  onModelSelect={handleModelSelect}
                  onClearOverride={clearModelOverride}
                  onGeminiThinkingChange={setGeminiFlashThinkingLevel}
                  onDebateChange={(sel) => {
                    setDebateSelection(sel);
                    if (sendValidationError) setSendValidationError(null);
                  }}
                  onClearValidationError={() => setSendValidationError(null)}
                  onOpenProviderSettings={() => {
                    setShowProviderSettings(true);
                    setShowModelSelector(false);
                  }}
                  onClose={() => setShowModelSelector(false)}
                />
              )}
            </div>

            <button type='button' className='header-button memory-trigger' aria-label={lastRecall?.conversationId === selectedConversationId ? `Memory: ${lastRecall.hits} recalled` : 'Memory'} aria-haspopup='dialog' aria-expanded={showMemorySettings} onClick={() => setShowMemorySettings(true)}>
              <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden='true'><rect x='5' y='5' width='14' height='14' rx='3' /><path d='M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4' /></svg>
              <span className='memory-trigger-label'>Memory</span>
              {lastRecall?.conversationId === selectedConversationId && <span className='memory-recall-count' aria-hidden='true'>{lastRecall.hits}</span>}
            </button>
            <button
              type='button'
              onClick={() => setShowProviderSettings(true)}
              className='header-button provider-plugins-button'
              title='Provider plug-ins'
              aria-label='Provider plug-ins'
              data-tooltip='Provider plug-ins'
              aria-haspopup='dialog'
              aria-expanded={showProviderSettings}
            >
              <svg
                width='18'
                height='18'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                aria-hidden='true'
              >
                <path d='M12 22v-5' />
                <path d='M9 8V2' />
                <path d='M15 8V2' />
                <path d='M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z' />
              </svg>
            </button>

            {/* User Menu */}
            <div className='user-menu-container' ref={userMenuRef}>
              <button
                type='button'
                onClick={() => setShowUserMenu(!showUserMenu)}
                className='user-button'
                aria-label='Account menu'
                aria-expanded={showUserMenu}
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
                  <button
                    type='button'
                    className='dropdown-item'
                    onClick={() => { handleReset(); setShowUserMenu(false); }}
                  >
                    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden='true'>
                      <path d='M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5' />
                    </svg>
                    Reset conversation
                  </button>
                  <button
                    type='button'
                    className='dropdown-item'
                    onClick={() => {
                      setShowProviderSettings(true);
                      setShowUserMenu(false);
                    }}
                  >
                    <svg
                      width='16'
                      height='16'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='2'
                    >
                      <path d='M12 2v6' />
                      <path d='M5 12a7 7 0 0 0 14 0' />
                      <circle cx='12' cy='12' r='2' />
                    </svg>
                    Provider plug-ins
                  </button>
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

            {showMemorySettings && <MemorySettings onClose={() => setShowMemorySettings(false)} onOpenConversation={handleSelectConversation} />}
            {showProviderSettings && (
              <ProviderSettings
                plugins={providerPlugins}
                preferences={modelPreferences}
                onClose={() => setShowProviderSettings(false)}
              />
            )}
          </div>
        </div>
      </header>

      {/* Global Drag Overlay */}
      {isDraggingGlobal && (
        <div className='global-drag-overlay'>
          <div className='global-drag-content'>
            <div className='global-drag-icon'>📁</div>
            <h3 className='global-drag-title'>Drop files anywhere</h3>
            <p className='global-drag-subtitle'>Images, documents, code & video files supported</p>
          </div>
        </div>
      )}

      {/* Context Warning */}
      {shouldShowWarning && contextStatus && (
        <ContextWarning
          contextStatus={contextStatus}
          onNewChat={() => {
            createNewChatWithContext();
            handleNewChat();
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
              <div className='empty-state-badge'>A spectrum of possibilities</div>
              <h2>What would you like<br />to <span>explore?</span></h2>
              <p>
                Bring your ideas. Prismatix finds the right model for every turn.
              </p>
            </div>
          )
          : (
            <div className='messages-list'>
              {messages.map((msg, idx) => {
                const isLast = idx === messages.length - 1;
                return (
                  <ChatMessageItem
                    key={idx}
                    message={msg}
                    index={idx}
                    isStreaming={isStreaming && isLast}
                    isWaitingFirstToken={isWaitingFirstToken && isLast}
                    defaultModelColor={modelConfig.color}
                    isMetadataExpanded={expandedMetadataIdx === idx}
                    onToggleMetadata={handleToggleMetadata}
                    registerRef={registerMessageRef}
                    onRegenerate={handleRegenerate}
                    onEditPrompt={handleEditPrompt}
                    onFeedback={handleFeedback}
                  />
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        <ScrollToBottomButton
          visible={showScrollButton && messages.length > 0}
          isStreaming={isStreaming}
          onClick={handleScrollToBottom}
        />
      </main>

      {/* Input Area */}
      <ChatInputComposer
        input={input}
        inputRef={inputRef}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onSend={() => void handleSend()}
        onStop={handleStop}
        isStreaming={isStreaming}
        isWaitingFirstToken={isWaitingFirstToken}
        sendBlockedReason={sendBlockedReason}
        sendBlockedTitles={SEND_BLOCKED_TITLES}
        hasPendingVideoUploads={hasPendingVideoUploads}
        draftAttachments={draftAttachments}
        onRemoveAttachment={removeAttachment}
        onClearAllAttachments={clearAllAttachments}
        onFileSelect={handleFileSelect}
        onMultipleFiles={handleMultipleFiles}
        manualModelOverride={manualModelOverride}
        currentModel={currentModel}
        debateSelection={debateSelection}
        enabledProviders={enabledProviders}
        preferences={modelPreferences}
        geminiFlashThinkingLevel={geminiFlashThinkingLevel}
        onModelSelect={handleModelSelect}
        onClearOverride={clearModelOverride}
        onGeminiThinkingChange={setGeminiFlashThinkingLevel}
        onOpenProviderSettings={() => setShowProviderSettings(true)}
        openRoutingDebateMenu={openRoutingDebateMenu}
        showPromptStarters={messages.length === 0}
        promptStarters={PROMPT_STARTERS}
        onSelectPromptStarter={(prompt) => {
          setInput(prompt);
          inputRef.current?.focus();
        }}
        streamOutcome={streamOutcome}
        contextExcludedCount={contextExcludedCount}
        duplicateNotice={duplicateNotice}
        composerValidationView={composerValidationView}
      />

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
        isVisible={showCostEstimator && !showProviderSettings}
        isStreaming={isStreaming}
        totalCost={sessionCostTotal}
        finalCostUsd={finalMessageCost}
        routerPricingVersion={routerPricingVersion}
      />
      </div>
    </div>
  );
};
