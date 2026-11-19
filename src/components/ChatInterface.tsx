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
import { BudgetGuard } from './BudgetGuard';
import { evaluateBudget } from '../utils/budgetEvaluator';
import { CostEstimator } from './CostEstimator';
import { SpendTracker } from './SpendTracker';
import { ModelSelectorDropdown } from './ModelSelectorDropdown';
import { ConversationSidebar } from './ConversationSidebar';
import { ChatBackdrop } from './ChatBackdrop';
import { ChatMessageItem } from './ChatMessageItem';
import { ScrollToBottomButton } from './ScrollToBottomButton';
import { ChatInputComposer } from './ChatInputComposer';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import {
  type StreamOutcomeState,
  type PromptStarter,
  SEND_BLOCKED_TITLES,
} from './chatTypes';
import '../styles/ChatInterface.css';

interface CapabilityPillar {
  icon: string;
  title: string;
  description: string;
  prompt: string;
  isDebate?: boolean;
  isCompare?: boolean;
  isUpload?: boolean;
}

const CAPABILITY_PILLARS: CapabilityPillar[] = [
  {
    icon: '〈〉',
    title: 'Build an app',
    description: 'Plan, design, and iterate on an app.',
    prompt: 'Help me plan an app. Ask about the idea, users, and platform before suggesting an implementation.',
  },
  {
    icon: '▤',
    title: 'Analyze a file',
    description: 'Summarize, extract, and get insights.',
    prompt: 'Analyze the attached file and summarize its key points.',
    isUpload: true,
  },
  {
    icon: '⚖',
    title: 'Compare ideas',
    description: 'Evaluate options with multiple models.',
    prompt: 'Compare the tradeoffs between event sourcing and a relational design for financial auditing.',
    isCompare: true,
  },
  {
    icon: '☏',
    title: 'Debate a topic',
    description: 'Explore different perspectives in depth.',
    prompt: 'Debate the tradeoffs between event sourcing and a relational design for financial auditing.',
    isDebate: true,
  },
];
import {
  askPrismatix,
  askPrismatixSync,
  DuplicateRequestError,
  getConversationId,
  resetConversation,
  setConversationId,
} from '../smartFetch';
import { executeWebSearch, type SearchCitation } from '../services/webSearchService';
import { submitRoutingFeedback } from '../services/routingFeedbackService';
import { supabase } from '../lib/supabase';
import {
  assignConversationProject,
  deleteConversation,
  getConversationProjectId,
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
  calculateDebatePreFlightCost,
  calculateFinalCost,
  calculatePreFlightCost,
  estimateTokenCount,
  type UsageEstimate,
} from '../costEngine';
import { calculateHistoryTokens, extractTextContent } from '../utils';
import {
  uploadAttachment,
  uploadVideoAttachment,
  waitForVideoReady,
} from '../services/storageService';
import { fetchServerDailyTotal, recordCost } from '../services/financeTracker';
import type {
  CostStatus,
  FileUploadPayload,
  GeminiFlashThinkingLevel,
  Message,
  RouterModel,
  RoutingProfile,
} from '../types';
import { MODEL_HIGHLIGHTS, MODEL_ORDER, getCatalogEntry } from '../modelCatalog';
import { filterVisibleModels, isModelVisible } from '../providerRegistry';
import { useProviderPlugins } from '../hooks/useProviderPlugins';
import { useModelPickerPreferences } from '../hooks/useModelPickerPreferences';
import { ProviderSettings } from './ProviderSettings';
import { MemorySettings } from './MemorySettings';
import { FirstRunSetupCard } from './FirstRunSetupCard';
import { reconcileFirstRunOutcome, type FirstRunOutcome } from './firstRunOutcome';
import { GlobalSearchModal } from './GlobalSearchModal';
import { ProjectModal } from './ProjectModal';
import { ExportModal } from './ExportModal';
import { ImportModal } from './ImportModal';
import { PromptLibraryModal } from './PromptLibraryModal';
import { UrlIngestionModal } from './UrlIngestionModal';
import { DocumentComparisonModal } from './DocumentComparisonModal';
import { ImageGenerationModal } from './ImageGenerationModal';
import { ArtifactViewerModal } from './ArtifactViewerModal';
import { defaultVoiceDictationService } from '../services/voiceDictationService';
import {
  extractArtifactsFromText,
  persistArtifactRevisionToDatabase,
  getOrCreateArtifactForMessage,
  type Artifact,
} from '../services/artifactService';
import type { ImageGenerationResult } from '../services/imageGenerationService';
import { subscribeToOnlineStatus, subscribeToInstallPrompt, promptPwaInstall } from '../services/pwaService';
import { executeResearchWorkflow } from '../services/researchWorkflow';
import { searchProjectKnowledge, formatKnowledgeGroundingBlock } from '../services/projectKnowledgeSearch';
import { branchConversation, persistMessageVersion } from '../services/conversationBranching';
import {
  archiveConversation,
  setConversationTags,
} from '../services/conversationService';
import {
  syncPreferences,
  saveServerPreferences,
} from '../services/userPreferencesService';
import { listProjects, formatProjectContextPrompt, type Project } from '../services/projectService';
import {
  fetchAllExportableConversations,
  type ExportableConversation,
  type ExportProgress,
  type ExportResult,
} from '../services/conversationExport';
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
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  user: User | null;
  onSignOut: () => Promise<void>;
}

const DAILY_BUDGET_LIMIT_USD = 2.0;
const VIDEO_NAME_PATTERN = /\.(mp4|mov|avi|mkv|webm|m4v)$/i;
const CHATS_HIDDEN_KEY = 'prismatix.sidebar.chatsHidden';
const spendCapSelectValue = (value: number | null) => value === null ? 'none' : value.toFixed(2);

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

// Router/edge error codes arrive as terse message strings or structured RouterApiError;
// map known codes to user-actionable text with concrete next permitted steps.
export function describeStreamError(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'RouterApiError') {
    const apiErr = error as { status?: number; code?: string; message?: string; retryAfterSeconds?: number };
    const retryNote = apiErr.retryAfterSeconds ? ` Please wait ${apiErr.retryAfterSeconds} seconds before trying again.` : '';
    switch (apiErr.code) {
      case 'not_entitled':
        return 'Your account doesn\u2019t have access to this feature yet. If you just signed up, sign out and back in once \u2014 if it still fails, contact support.';
      case 'entitlement_unavailable':
        return 'We couldn\u2019t verify your account access right now. Please try again in a moment.';
      case 'duplicate_request':
        return 'That exact request was already sent just now. Edit your message slightly and send again.';
      case 'budget_exhausted':
      case 'balance_exhausted':
      case 'daily_limit_exceeded':
      case 'monthly_limit_exceeded':
      case 'daily_spend_limit_exceeded':
        return `Usage allowance reached for this period.${retryNote} Check spend settings or wait for quota reset.`;
      case 'request_cost_limit_exceeded':
        return `Request cost exceeds your configured spend cap.${retryNote} Lower prompt size, increase spend cap, or select an economy model.`;
      case 'rate_limited':
      case 'rate_limit_exceeded':
      case 'too_many_requests':
        return `Rate limit exceeded.${retryNote || ' Please wait a moment before sending another message.'}`;
      case 'active_limit':
      case 'concurrency_limit':
        return `Another request is currently processing.${retryNote} Please wait for it to complete.`;
      case 'no_available_provider':
      case 'provider_unavailable':
        return 'No active provider is currently available for this model. Check Provider Settings to enable a provider.';
      case 'provider_key_required':
        return 'No usable provider credential is available for this route. Check Provider Settings to choose an enabled provider and review its saved key.';
      case 'provider_key_unavailable':
        return 'The saved provider credential could not be retrieved. Your prompt is preserved; try again later or review Provider Settings.';
      case 'provider_disabled':
        return 'The provider required for this model is currently disabled in your Provider Settings.';
      case 'unknown_pricing':
      case 'pricing_unknown':
        return 'Pricing for this model is unknown \u2014 send was blocked for cost safety. Please select a calibrated model.';
      case 'admission_unavailable':
      case 'accounting_unavailable':
      case 'transcript_unavailable':
        return `Service temporarily unavailable (${apiErr.code}).${retryNote || ' Please try again in a moment.'}`;
      case 'upstream_error':
      case 'provider_error':
        return 'The upstream AI provider returned an error. Please try again or switch to an alternate model.';
      case 'upstream_timeout':
        return 'The model provider timed out while generating a response. Please try again.';
      case 'video_not_ready':
        return 'One or more video attachments are still processing. Please wait for processing to complete.';
      case 'interrupted':
      case 'stream_interrupted':
        return 'The connection closed prematurely before the response completed. Partial output preserved.';
      default:
        if (apiErr.status === 401) {
          return 'Session expired. Please sign in again.';
        }
        if (apiErr.status === 402) {
          return `Usage allowance or budget reached.${retryNote}`;
        }
        if (apiErr.status === 429) {
          return `Rate limit exceeded.${retryNote || ' Please try again in a moment.'}`;
        }
        if (apiErr.status && apiErr.status >= 500) {
          return `The router or provider encountered a temporary error (${apiErr.status}). Please try again.`;
        }
        return apiErr.message || `Error (${apiErr.code})`;
    }
  }

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
    case 'active_limit':
    case 'concurrency_limit':
      return 'Another request is currently processing. Please wait for it to complete.';
    case 'rate_limited':
    case 'rate_limit_exceeded':
    case 'too_many_requests':
      return 'Rate limit exceeded. Please wait a moment before sending another message.';
    case 'video_not_ready':
      return 'One or more videos are still processing. Please wait and try again.';
    case 'stream_interrupted':
      return 'The connection closed prematurely before the response completed. Partial output preserved.';
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

interface FailedTurnDraft {
  rawInput: string;
  queryText: string;
  attachments: FileUploadPayload[];
  error?: string;
  overrideModel?: RouterModel;
  optimisticMessageId?: string;
  optimisticMessageContent?: string;
  restoredFromStorage?: boolean;
}

function readFailedTurnDraft(userId?: string): FailedTurnDraft | null {
  if (!userId) return null;
  try {
    const rawInput = sessionStorage.getItem(`prismatix.failed-turn.${userId}`);
    return rawInput ? { rawInput, queryText: rawInput, attachments: [], restoredFromStorage: true } : null;
  } catch {
    return null;
  }
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ user, onSignOut, theme, onToggleTheme }) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSendPending, setIsSendPending] = useState(false);
  const sendLockSeqRef = useRef(0);
  const sendLockRef = useRef<{ id: number; userId?: string; accountGeneration: number; conversationId: string | null } | null>(null);
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
  const costEstimatorPanelRef = useRef<HTMLDivElement>(null);
  const costEstimatorDetailsButtonRef = useRef<HTMLButtonElement>(null);
  const [compactCostReveal, setCompactCostReveal] = useState<{ viewportHeight: number; request: number } | null>(null);
  const compactCostRevealRequestRef = useRef(0);
  const [finalMessageCost, setFinalMessageCost] = useState<number | null>(null);
  const [routerPricingVersion, setRouterPricingVersion] = useState<string | undefined>(undefined);
  const [debateSelection, setDebateSelection] = useState<DebateSelection>('off');
  const [sendValidationError, setSendValidationError] = useState<string | null>(null);
  const [expandedMetadataIdx, setExpandedMetadataIdx] = useState<number | null>(null);
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [firstRunOutcome, setFirstRunOutcome] = useState<FirstRunOutcome | null>(null);
  const [rejectedRoute, setRejectedRoute] = useState<{
    mode: 'chat' | 'compare' | 'debate';
    manualModel: RouterModel | null;
  } | null>(null);
  const activeUserIdRef = useRef(user?.id);
  const accountGenerationRef = useRef(0);
  const [showMemorySettings, setShowMemorySettings] = useState(false);
  const [lastRecall, setLastRecall] = useState<{ conversationId: string; hits: number } | null>(null);

  // Provider plug-ins (PX12): which providers are on for this user.
  const providerPlugins = useProviderPlugins(user?.id);
  const enabledProviders = providerPlugins.enabledProviders;
  const providerVerified = providerPlugins.isVerified && !(firstRunOutcome && !firstRunOutcome.verified);
  const openRouterProvider = providerPlugins.providers.find((provider) => provider.id === 'openrouter');
  const providerChecksNeedAttention = providerPlugins.verificationStatus === 'invalid'
    || providerPlugins.verificationStatus === 'unavailable'
    || providerPlugins.providers.some((provider) => provider.status === 'invalid_revoked' || provider.status === 'unavailable');
  useEffect(() => {
    setFirstRunOutcome((current) => reconcileFirstRunOutcome(current, openRouterProvider));
  }, [openRouterProvider]);

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
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const conversationsRefreshSeqRef = useRef(0);
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const [isLoadingMoreConversations, setIsLoadingMoreConversations] = useState(false);
  const [loadMoreConversationsError, setLoadMoreConversationsError] = useState<string | null>(null);
  const [conversationsError, setConversationsError] = useState<string | null>(null);

  // PR 1: F04 older message pagination state
  const [hasEarlierMessages, setHasEarlierMessages] = useState(false);
  const [isLoadingEarlierMessages, setIsLoadingEarlierMessages] = useState(false);
  const [earlierMessagesError, setEarlierMessagesError] = useState<string | null>(null);
  const [conversationLoadError, setConversationLoadError] = useState<string | null>(null);

  // Only the prompt text survives reload. An interrupted execution may
  // have completed on the server, so a reloaded draft is restore-only.
  const [failedTurnDraft, setFailedTurnDraftState] = useState<FailedTurnDraft | null>(
    () => readFailedTurnDraft(user?.id),
  );
  const setFailedTurnDraft = (draft: FailedTurnDraft | null) => {
    setFailedTurnDraftState(draft);
    if (!user?.id) return;
    try {
      const key = `prismatix.failed-turn.${user.id}`;
      if (draft?.rawInput.trim()) sessionStorage.setItem(key, draft.rawInput);
      else sessionStorage.removeItem(key);
    } catch {
      // Keep in-memory recovery available when browser storage is blocked.
    }
  };
  const [showDraftCopyFallback, setShowDraftCopyFallback] = useState(false);
  const activeDraftRef = useRef<{
    rawInput: string;
    queryText: string;
    attachments: FileUploadPayload[];
    overrideModel?: RouterModel;
    optimisticMessageId?: string;
    optimisticMessageContent?: string;
  } | null>(null);

  // PR 1: F05 global full-text chat search state
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);

  // PR 2: F09 Projects & F10 Export state
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isPromptLibraryOpen, setIsPromptLibraryOpen] = useState(false);
  const [isUrlModalOpen, setIsUrlModalOpen] = useState(false);
  const [isDocComparisonModalOpen, setIsDocComparisonModalOpen] = useState(false);
  // Wave 2 PR 6: F26 Dictation, F28 Image Gen, F29 Artifacts, F30 PWA
  const [isImageGenModalOpen, setIsImageGenModalOpen] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [isArtifactModalOpen, setIsArtifactModalOpen] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [canInstallPwa, setCanInstallPwa] = useState(false);
  const [researchMode, setResearchMode] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('prismatix_research_mode') === 'true';
    } catch {
      return false;
    }
  });

  // PR 3: F11 Web Search, F12 Comparison, F13 Routing Profiles & Spend Caps
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('prismatix_web_search_enabled') === 'true';
    } catch {
      return false;
    }
  });
  const [comparisonMode, setComparisonMode] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('prismatix_comparison_mode') === 'true';
    } catch {
      return false;
    }
  });
  const [comparisonModelA, setComparisonModelA] = useState<RouterModel>('gemini-3.8-flash');
  const [comparisonModelB, setComparisonModelB] = useState<RouterModel>('gpt-6-sol');
  const [routingPanelOpen, setRoutingPanelOpen] = useState(false);
  const routingPanelRef = useRef<HTMLElement>(null);
  const routingToggleRef = useRef<HTMLButtonElement>(null);
  const filePickerRef = useRef<(() => void) | null>(null);
  const registerFilePicker = useCallback((openPicker: () => void) => {
    filePickerRef.current = openPicker;
  }, []);
  const workspaceMode = comparisonMode ? 'compare' : debateSelection !== 'off' ? 'debate' : 'chat';
  const routeRecoveryApplies = Boolean(rejectedRoute
    && rejectedRoute.mode === workspaceMode
    && rejectedRoute.manualModel === (workspaceMode === 'chat' ? manualModelOverride : null));
  // A failed status for one saved provider must not veto unrelated routes.
  // Explicit first-run verification and recovery for this same rejected route
  // remain blocked; ordinary route choice stays with the router.
  const providerVerificationRequiresAction = providerPlugins.verificationLoading
    || Boolean(firstRunOutcome && !firstRunOutcome.verified)
    || routeRecoveryApplies;
  const providerCanAttemptRouterSend = !providerPlugins.loading
    && !providerPlugins.error
    && providerPlugins.isConfigured
    && enabledProviders.size > 0
    && !providerVerificationRequiresAction;

  const selectWorkspaceMode = useCallback((mode: 'chat' | 'compare' | 'debate') => {
    const compare = mode === 'compare';
    setComparisonMode(compare);
    setDebateSelection((current) => mode === 'debate' ? (current === 'off' ? 'general' : current) : 'off');
    try {
      window.localStorage.setItem('prismatix_comparison_mode', String(compare));
    } catch {
      // Keep the in-memory mode usable when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    const closeCompactDrawerAtWideBreakpoint = () => {
      if (window.innerWidth > 1200) setRoutingPanelOpen(false);
    };
    window.addEventListener('resize', closeCompactDrawerAtWideBreakpoint);
    return () => window.removeEventListener('resize', closeCompactDrawerAtWideBreakpoint);
  }, []);

  useEffect(() => {
    const toggle = routingToggleRef.current;
    if (!routingPanelOpen || window.innerWidth > 1200) return;
    const closeButton = routingPanelRef.current?.querySelector<HTMLButtonElement>('.arctic-routing-close');
    closeButton?.focus();
    const handleRoutingKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        setRoutingPanelOpen(false);
      }
    };
    window.addEventListener('keydown', handleRoutingKeyDown);
    return () => {
      window.removeEventListener('keydown', handleRoutingKeyDown);
      if (toggle?.isConnected) toggle.focus();
    };
  }, [routingPanelOpen]);
  const [routingProfile, setRoutingProfile] = useState<RoutingProfile>(() => {
    try {
      return (window.localStorage.getItem('prismatix_routing_profile') as RoutingProfile) || 'balanced';
    } catch {
      return 'balanced';
    }
  });
  const [maxSpendCap, setMaxSpendCap] = useState<number | null>(() => {
    try {
      const saved = window.localStorage.getItem('prismatix_max_spend_cap');
      return saved ? Number(saved) : null;
    } catch {
      return null;
    }
  });

  // Shared quality requirement: action notice banner (rename/delete)
  const [actionNotice, setActionNotice] = useState<{ message: string; type: 'error' | 'success' } | null>(null);

  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  useEffect(() => {
    if (!routingPanelOpen || (!selectedConversationId && messages.length === 0)) return;
    const closeCompactRoutingPanel = () => {
      if (window.innerWidth > 1200) setRoutingPanelOpen(false);
    };
    window.addEventListener('resize', closeCompactRoutingPanel);
    return () => window.removeEventListener('resize', closeCompactRoutingPanel);
  }, [routingPanelOpen, selectedConversationId, messages.length]);
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
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const selectedConversationIdRef = useRef<string | null>(null);
  // Monotonic token so a stale conversation load can never overwrite the
  // messages of a newer selection (rapid A→B switching).
  const conversationLoadSeqRef = useRef(0);
  const activeStreamRef = useRef<{
    conversationId: string;
    clientRequestId: string | null;
    accountGeneration: number;
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
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const modelSelectorRef = useRef<HTMLDivElement>(null);
  const [chatHeaderElement, setChatHeaderElement] = useState<HTMLElement | null>(null);
  const costEstimatorHideTimeoutRef = useRef<number | null>(null);
  // PX06: the in-flight request's abort controller (Stop control) and the
  // terminal outcome surfaced to the user (cancelled, or the receipt state).
  const abortControllerRef = useRef<AbortController | null>(null);
  const executionIdRef = useRef<string | undefined>(undefined);
  const [streamOutcome, setStreamOutcome] = useState<StreamOutcomeState | null>(null);

  // Reset live draft and transport state on account switch. Recover only
  // the incoming account’s saved text. Abort best-effort; generation guards below also protect against
  // transports or mocks that settle after ignoring their AbortSignal.
  useLayoutEffect(() => {
    if (activeUserIdRef.current === user?.id) return;
    activeUserIdRef.current = user?.id;
    accountGenerationRef.current += 1;
    sendLockRef.current = null;
    setIsSendPending(false);
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    activeStreamRef.current = null;
    executionIdRef.current = undefined;
    activeDraftRef.current = null;
    pendingActionRef.current = null;
    waitingFirstTokenRef.current = false;
    if (costEstimatorHideTimeoutRef.current !== null) {
      window.clearTimeout(costEstimatorHideTimeoutRef.current);
      costEstimatorHideTimeoutRef.current = null;
    }
    setInput('');
    setDraftAttachments([]);
    setFailedTurnDraftState(readFailedTurnDraft(user?.id));
    setShowDraftCopyFallback(false);
    setFirstRunOutcome(null);
    setRejectedRoute(null);
    setSendValidationError(null);
    setStreamOutcome(null);
    setDuplicateNotice(null);
    setActionNotice(null);
    setBudgetConfirm(null);
    setIsStreaming(false);
    setIsWaitingFirstToken(false);
    setShowCostEstimator(false);
    setCurrentUsage(null);
    setFinalMessageCost(null);
    setRouterPricingVersion(undefined);
    setSessionCostTotal(0);
    setLastRecall(null);
    setContextExcludedCount(0);
  }, [user?.id]);

  // Scroll only when a new message bubble is created, and only if user is near bottom.
  useEffect(() => {
    if (messages.length === 0) return;
    if (!shouldStickToBottomRef.current && !isStreaming) return;
    if (isStreaming) {
      messagesEndRef.current?.scrollIntoView?.({ behavior: 'auto', block: 'end' });
      return;
    }
    const lastMessage = messageRefs.current[messages.length - 1];
    if (lastMessage) {
      if (typeof lastMessage.scrollIntoView === 'function') {
        lastMessage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages.length, isStreaming, shouldStickToBottomRef]);

  // The responsive cost summary participates in message flow. When it first
  // appears, keep the transcript pinned to its end so the summary and its
  // Details control are not clipped beneath the fixed composer while a stream
  // is in flight.
  useLayoutEffect(() => {
    if (!showCostEstimator || !shouldStickToBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'auto', block: 'end' });
  }, [showCostEstimator, messages.length, shouldStickToBottomRef]);

  useEffect(() => {
    if (!showCostEstimator || showProviderSettings) setCompactCostReveal(null);
  }, [showCostEstimator, showProviderSettings]);

  useEffect(() => {
    if (compactCostReveal?.request === undefined) return;
    const messageViewport = costEstimatorPanelRef.current?.closest<HTMLElement>('.chat-messages');
    if (!messageViewport || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const viewportHeight = Math.max(0, messageViewport.clientHeight - 4);
      setCompactCostReveal((current) => current && current.viewportHeight !== viewportHeight
        ? { ...current, viewportHeight }
        : current);
    });
    observer.observe(messageViewport);
    return () => observer.disconnect();
  }, [compactCostReveal?.request]);

  useLayoutEffect(() => {
    if (compactCostReveal?.request === undefined) return;
    const panel = costEstimatorPanelRef.current;
    const detailsButton = costEstimatorDetailsButtonRef.current;
    const messageViewport = panel?.closest<HTMLElement>('.chat-messages');
    if (!panel || !detailsButton || !messageViewport) return;

    const panelTopOffset = panel.getBoundingClientRect().top - messageViewport.getBoundingClientRect().top;
    messageViewport.scrollTop = Math.max(0, messageViewport.scrollTop + panelTopOffset);

    const panelRect = panel.getBoundingClientRect();
    const buttonRect = detailsButton.getBoundingClientRect();
    const buttonOverflow = Math.max(0, buttonRect.bottom - panelRect.bottom)
      - Math.max(0, panelRect.top - buttonRect.top);
    panel.scrollTop = Math.max(0, panel.scrollTop + buttonOverflow);
    detailsButton.focus({ preventScroll: true });
  }, [compactCostReveal?.request]);

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
      const focusedElement = document.activeElement;
      const focusedEstimator = document.querySelector('.cost-estimator');
      if (focusedElement instanceof Node && focusedEstimator?.contains(focusedElement)) {
        costEstimatorHideTimeoutRef.current = null;
        return;
      }
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
    const el = chatHeaderElement;
    if (!el || typeof ResizeObserver === 'undefined') {
      root.style.removeProperty('--prismatix-model-dropdown-top');
      root.style.removeProperty('--prismatix-chat-header-h');
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
  }, [chatHeaderElement]);

  // The compact saved-chat action rail scrolls horizontally. Anchor its model
  // menu to the trigger in viewport coordinates so the fixed popover can escape
  // that rail's overflow clip without changing the wide or mobile variants.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!showModelSelector) {
      root.style.removeProperty('--prismatix-model-dropdown-right');
      return;
    }
    const apply = () => {
      const trigger = modelSelectorRef.current?.querySelector<HTMLElement>('.model-indicator-button');
      if (!trigger) return;
      const rightInset = Math.max(8, window.innerWidth - trigger.getBoundingClientRect().right);
      root.style.setProperty('--prismatix-model-dropdown-right', `${Math.ceil(rightInset)}px`);
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('scroll', apply, true);
    window.visualViewport?.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('scroll', apply, true);
      window.visualViewport?.removeEventListener('resize', apply);
      root.style.removeProperty('--prismatix-model-dropdown-right');
    };
  }, [showModelSelector, chatHeaderElement]);

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
        id: item.id,
        createdAt: item.createdAt,
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
                finalUsd:
                  provenance.cost.costStatus === 'settled'
                    ? provenance.cost.totalUsd
                    : undefined,
                estimatedUsd:
                  provenance.cost.costStatus === 'pending' || provenance.cost.costStatus === 'estimated'
                    ? provenance.cost.totalUsd
                    : undefined,
                status: provenance.cost.costStatus ?? 'unknown',
                pricingVersion: provenance.cost.pricingVersion,
              },
            }
          : {}),
        ...(provenance?.routeRationale
          ? {
              routeInfo: {
                selection: provenance.routeRationale === 'manual_override' ? 'override' : 'auto',
                modelTier: provenance.model || currentModel,
                gateway:
                  provenance.provider === 'opencode'
                    ? 'opencode'
                    : provenance.provider === 'openrouter'
                    ? 'openrouter'
                    : undefined,
                reason: provenance.routeRationale,
                fallbackUsed: undefined,
                priceKnown:
                  provenance.cost && provenance.cost.costStatus !== 'unknown'
                    ? true
                    : undefined,
                role: provenance.routeRole,
              },
            }
          : {}),
        ...(item.debateParticipants && item.debateParticipants.length > 0
          ? { debateParticipants: item.debateParticipants, debateActive: true }
          : {}),
        ...(item.debateProfile ? { debateProfile: item.debateProfile as any } : {}),
        ...(item.debateTrigger ? { debateTrigger: item.debateTrigger as any } : {}),
        ...(item.debateExecutionMode ? { debateExecutionMode: item.debateExecutionMode } : {}),
        ...(item.metadata ? { metadata: item.metadata } : {}),
        ...(item.metadata?.comparisonResults
          ? { comparisonResults: item.metadata.comparisonResults as any }
          : {}),
        ...(item.metadata?.citations
          ? { citations: item.metadata.citations as any }
          : {}),
      });
    }
    return mapped;
  };

  const refreshConversations = useCallback(async (projectId?: string | null) => {
    const requestSeq = ++conversationsRefreshSeqRef.current;
    setConversationsLoading(true);
    setConversationsError(null);
    const targetProjectId = projectId !== undefined ? projectId : activeProjectId;
    try {
      const list = await listConversations(supabase, {
        limit: 50,
        projectId: targetProjectId ?? undefined,
      });
      if (requestSeq !== conversationsRefreshSeqRef.current) return;
      setConversations(list);
      setHasMoreConversations(list.length === 50);
      void listProjects(supabase).then((projects) => {
        if (requestSeq === conversationsRefreshSeqRef.current) setProjects(projects);
      }).catch((error) => {
        console.warn('[ChatInterface] Failed to list workspaces:', error);
      });
    } catch (error) {
      if (requestSeq !== conversationsRefreshSeqRef.current) return;
      console.warn('[ChatInterface] Failed to list conversations:', error);
      setConversationsError(!navigator.onLine
        ? 'You’re offline. Reconnect and retry.'
        : error instanceof Error && error.message === 'list_conversations_failed: session'
          ? 'Your session could not be verified. Sign in again to load conversations.'
          : 'Could not load conversations.');
    } finally {
      if (requestSeq === conversationsRefreshSeqRef.current) setConversationsLoading(false);
    }
  }, [activeProjectId]);

  const handleLoadMoreConversations = async () => {
    if (isLoadingMoreConversations || !hasMoreConversations || conversations.length === 0) return;
    const last = conversations[conversations.length - 1];
    if (!last) return;

    setIsLoadingMoreConversations(true);
    setLoadMoreConversationsError(null);
    try {
      const nextBatch = await listConversations(supabase, {
        limit: 50,
        projectId: activeProjectId ?? undefined,
        before: { lastActivityAt: last.lastActivityAt, id: last.id },
      });
      setConversations((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        const newRows = nextBatch.filter((c) => !seen.has(c.id));
        return [...prev, ...newRows];
      });
      setHasMoreConversations(nextBatch.length === 50);
    } catch (err) {
      setLoadMoreConversationsError('Failed to load older conversations.');
    } finally {
      setIsLoadingMoreConversations(false);
    }
  };

  const openConversation = async (conversationId: string) => {
    const loadSeq = ++conversationLoadSeqRef.current;
    selectedConversationIdRef.current = conversationId;
    setSelectedConversationId(conversationId);
    setConversationId(conversationId);
    setDuplicateNotice(null);
    setContextExcludedCount(0);
    setConversationLoadError(null);
    setEarlierMessagesError(null);
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
      setHasEarlierMessages(loaded.length === 200);

      // Restore project membership on conversation open (F09)
      const convSummary = conversations.find((c) => c.id === conversationId);
      const projId = convSummary?.projectId !== undefined
        ? convSummary.projectId
        : await getConversationProjectId(supabase, conversationId);
      setActiveProjectId(projId ?? null);
    } catch (error) {
      if (
        loadSeq !== conversationLoadSeqRef.current ||
        selectedConversationIdRef.current !== conversationId
      ) {
        return;
      }
      console.warn('[ChatInterface] Failed to load conversation:', error);
      setConversationLoadError('Failed to load conversation history.');
    }
  };

  const handleLoadEarlierMessages = async () => {
    if (isLoadingEarlierMessages || !hasEarlierMessages || messages.length === 0) return;
    const currentConvId = selectedConversationIdRef.current;
    if (!currentConvId) return;

    const oldest = messages[0];
    if (!oldest || !oldest.id) return;

    const cursorCreatedAt =
      oldest.createdAt ||
      (oldest.timestamp ? new Date(oldest.timestamp).toISOString() : new Date().toISOString());
    const cursorId = oldest.id;

    setIsLoadingEarlierMessages(true);
    setEarlierMessagesError(null);

    const container = chatMessagesRef.current;
    const prevScrollHeight = container ? container.scrollHeight : 0;
    const prevScrollTop = container ? container.scrollTop : 0;
    const loadSeq = conversationLoadSeqRef.current;

    try {
      const earlier = await loadConversation(supabase, currentConvId, {
        limit: 50,
        before: { createdAt: cursorCreatedAt, id: cursorId },
      });

      if (
        loadSeq !== conversationLoadSeqRef.current ||
        selectedConversationIdRef.current !== currentConvId
      ) {
        return;
      }

      const mappedEarlier = await mapLoadedMessages(earlier);
      if (
        loadSeq !== conversationLoadSeqRef.current ||
        selectedConversationIdRef.current !== currentConvId
      ) {
        return;
      }

      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id).filter(Boolean));
        const deduplicated = mappedEarlier.filter((m) => !m.id || !seen.has(m.id));
        return [...deduplicated, ...prev];
      });

      setHasEarlierMessages(earlier.length === 50);

      // Stable scroll restoration
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - prevScrollHeight + prevScrollTop;
        }
      });
    } catch (err) {
      setEarlierMessagesError('Failed to load earlier messages.');
    } finally {
      setIsLoadingEarlierMessages(false);
    }
  };

  const handleRestoreDraft = () => {
    if (!failedTurnDraft) return;
    setInput(failedTurnDraft.rawInput);
    setDraftAttachments(failedTurnDraft.attachments);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.focus();
    }
    // Remove the failed assistant message from history if one was appended
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'assistant' && typeof last.content === 'string' && last.content.startsWith('⚠️')) {
        return prev.slice(0, -1);
      }
      return prev;
    });
    setFailedTurnDraft(null);
    setShowDraftCopyFallback(false);
  };

  const handleCopyFailedDraft = async () => {
    if (!failedTurnDraft) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(failedTurnDraft.rawInput);
      setShowDraftCopyFallback(false);
      setActionNotice({ message: 'Draft copied. Attached files are not included.', type: 'success' });
    } catch {
      setShowDraftCopyFallback(true);
    }
  };

  const handleRetryTurn = async () => {
    if (!failedTurnDraft || failedTurnDraft.restoredFromStorage || isStreaming || sendLockRef.current) return;
    if (providerPlugins.loading || providerPlugins.error || !providerPlugins.isConfigured || enabledProviders.size === 0 || providerVerificationRequiresAction) {
      setSendValidationError(providerPlugins.error
        ? 'Provider setup could not be checked. Retry the check or open Provider Settings.'
        : providerPlugins.loading
          ? 'Provider setup is still being checked. Please wait before retrying.'
          : providerVerificationRequiresAction
            ? routeRecoveryApplies
              ? 'The router rejected this route. Verify or update its provider before retrying.'
              : 'A recent provider check needs attention. Verify or update the provider before retrying.'
            : 'No enabled provider with a saved key is available. Your draft is preserved.');
      return;
    }
    const { rawInput, queryText, attachments, overrideModel, optimisticMessageId, optimisticMessageContent } = failedTurnDraft;
    setFailedTurnDraft(null);
    setShowDraftCopyFallback(false);

    // Remove the failed assistant message if present
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'assistant' && typeof last.content === 'string' && last.content.startsWith('⚠️')) {
        return prev.slice(0, -1);
      }
      return prev;
    });

    const optimisticIndex = optimisticMessageId
      ? messages.findIndex((message) => message.id === optimisticMessageId)
      : -1;
    const historyBeforeUser = optimisticIndex >= 0
      ? messages.slice(0, optimisticIndex)
      : messages.filter((message, index) => !(index === messages.length - 1 && message.role === 'assistant' && typeof message.content === 'string' && message.content.startsWith('⚠️')));

    if (optimisticMessageId && optimisticIndex < 0) {
      const attachmentSummary = attachments.length > 0
        ? `[${attachments.length} file${attachments.length > 1 ? 's' : ''} attached]`
        : '';
      setMessages((prev) => prev.some((message) => message.id === optimisticMessageId)
        ? prev
        : [...prev, {
            id: optimisticMessageId,
            role: 'user',
            content: optimisticMessageContent ?? (rawInput.trim() || attachmentSummary),
            timestamp: Date.now(),
            attachments: attachments.length > 0 ? attachments : undefined,
          }]);
    }
    setInput('');
    setDraftAttachments([]);

    await executeTurn({
      queryText,
      attachmentsToProcess: attachments,
      historyMessages: historyBeforeUser,
      overrideModel: overrideModel || undefined,
      skipBudgetCheck: true,
      optimisticMessageId,
    });
  };

  const handleSelectSearchResult = async (targetConvId: string, targetMsgId: string | null) => {
    setIsGlobalSearchOpen(false);
    if (selectedConversationIdRef.current !== targetConvId) {
      writeSelectedConversation(user?.id ?? null, targetConvId);
      await openConversation(targetConvId);
    }

    if (targetMsgId) {
      setTimeout(() => {
        const el = document.getElementById(`message-${targetMsgId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('search-match-flash');
          setTimeout(() => el.classList.remove('search-match-flash'), 2500);
        }
      }, 350);
    }
  };

  const handleRenameConversation = async (conversationId: string, title: string) => {
    setActionNotice(null);
    try {
      await renameConversation(supabase, conversationId, title);
      await refreshConversations();
    } catch (error) {
      console.error('[ChatInterface] Failed to rename conversation:', error);
      setActionNotice({ message: 'Failed to rename chat. Please try again.', type: 'error' });
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    if (isStreaming || sendLockRef.current) return;
    setActionNotice(null);
    try {
      await deleteConversation(supabase, conversationId);
      await refreshConversations();
      if (selectedConversationIdRef.current === conversationId) {
        handleNewChat();
      }
    } catch (error) {
      console.error('[ChatInterface] Failed to delete conversation:', error);
      setActionNotice({ message: 'Failed to delete chat. Please try again.', type: 'error' });
    }
  };

  const handleSelectConversation = (conversationId: string) => {
    if (isStreaming || sendLockRef.current || conversationId === selectedConversationIdRef.current) return;
    writeSelectedConversation(user?.id ?? null, conversationId);
    void openConversation(conversationId);
  };

  const handleNewChat = () => {
    if (isStreaming || sendLockRef.current) return;
    conversationLoadSeqRef.current += 1;
    selectedConversationIdRef.current = null;
    setSelectedConversationId(null);
    writeSelectedConversation(user?.id ?? null, NEW_CHAT_SELECTION);
    resetConversation();
    setMessages([]);
    setDraftAttachments([]);
    setDuplicateNotice(null);
    setContextExcludedCount(0);
    setConversationLoadError(null);
  };

  const toggleChatsHidden = () => {
    const restoringChats = chatsHidden;
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
    else if (restoringChats && window.innerWidth > 768) {
      window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.conversation-new-button')?.focus());
    }
  };

  const handleSidebarToggle = () => {
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

  const handleArchiveConversation = async (id: string, archived: boolean) => {
    try {
      await archiveConversation(supabase, id, archived);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, archived } : c))
      );
      setActionNotice({
        type: 'success',
        message: archived ? 'Conversation archived' : 'Conversation unarchived',
      });
    } catch (err: any) {
      console.error('[ChatInterface] Archive failed:', err);
      setActionNotice({ type: 'error', message: 'Failed to update archive status.' });
    }
  };

  const handleSetConversationTags = async (id: string, tags: string[]) => {
    try {
      await setConversationTags(supabase, id, tags);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, tags } : c))
      );
      setActionNotice({ type: 'success', message: 'Tags updated' });
    } catch (err: any) {
      console.error('[ChatInterface] Set tags failed:', err);
      setActionNotice({ type: 'error', message: 'Failed to update tags.' });
    }
  };

  const handleBranch = useCallback(async (index: number) => {
    const currentConvId = selectedConversationIdRef.current;
    if (!currentConvId) {
      setActionNotice({ message: 'Save or select a conversation before branching.', type: 'error' });
      return;
    }
    setActionNotice(null);
    try {
      let targetMessageId = messagesRef.current[index]?.id;
      if (!targetMessageId) {
        const loaded = await loadConversation(supabase, currentConvId, { limit: 1000 });
        targetMessageId = loaded[index]?.id;
      }
      if (!targetMessageId) {
        setActionNotice({ message: 'Target message not found for branching.', type: 'error' });
        return;
      }
      const branchRes = await branchConversation(supabase, {
        sourceConversationId: currentConvId,
        fromMessageId: targetMessageId,
      });
      await refreshConversations();
      await openConversation(branchRes.newConversationId);
      setActionNotice({ message: `Branched into "${branchRes.newTitle}"`, type: 'success' });
    } catch (err: any) {
      console.error('[ChatInterface] Failed to branch conversation:', err);
      setActionNotice({ message: `Failed to branch: ${err.message || 'unknown error'}`, type: 'error' });
    }
  }, []);

  const handleInsertPromptTemplate = (promptText: string) => {
    setInput(promptText);
    setIsPromptLibraryOpen(false);
    inputRef.current?.focus();
  };

  // Wave 2 PR 6: PWA online & install status subscriptions (F30)
  useEffect(() => {
    const unsubOnline = subscribeToOnlineStatus((online) => {
      setIsOnline(online);
    });
    const unsubInstall = subscribeToInstallPrompt((canInstall) => {
      setCanInstallPwa(canInstall);
    });
    return () => {
      unsubOnline();
      unsubInstall();
    };
  }, []);

  const handleInstallPwa = async () => {
    const outcome = await promptPwaInstall();
    if (outcome === 'accepted') {
      setActionNotice({ type: 'success', message: 'Prismatix installed successfully.' });
    }
  };

  // Wave 2 PR 6: Voice dictation (F26)
  const handleToggleVoiceDictation = useCallback(() => {
    if (isRecordingVoice) {
      defaultVoiceDictationService.stopDictation();
      setIsRecordingVoice(false);
    } else {
      setIsRecordingVoice(true);
      void defaultVoiceDictationService.startDictation({
        onTranscript: (text) => {
          setInput((prev) => (prev ? `${prev} ${text}` : text));
        },
        onError: (err) => {
          console.warn('Voice dictation error:', err);
          setActionNotice({ type: 'error', message: err });
          setIsRecordingVoice(false);
        },
        onStateChange: (state) => {
          if (state === 'idle' || state === 'error') {
            setIsRecordingVoice(false);
          }
        },
      });
    }
  }, [isRecordingVoice]);

  // Wave 2 PR 6: Image generation persistence (F28)
  const handleImageGenerated = useCallback(
    (result: ImageGenerationResult) => {
      const isMock = result.isMock ?? Boolean(result.imageUrl?.startsWith('data:image/svg+xml'));
      const finalCost = isMock ? 0 : (result.costUsd || 0);
      const newMsg: Message = {
        role: 'assistant',
        content: result.revisedPrompt || result.prompt,
        timestamp: Date.now(),
        model: result.modelId as RouterModel,
        cost: {
          status: isMock ? 'unmetered' : (result.costStatus === 'settled' ? 'settled' : 'unmetered'),
          finalUsd: finalCost,
        },
        metadata: {
          type: 'image_generation',
          imageGeneration: result,
        },
      };
      setMessages((prev) => [...prev, newMsg]);
      setActionNotice({ type: 'success', message: `Image generated via ${result.modelId}` });
    },
    []
  );

  // Wave 2 PR 6: Artifact inspection (F29)
  const handleOpenArtifact = useCallback(
    async (_index: number, content: string, messageId?: string) => {
      const extracted = extractArtifactsFromText(content);
      if (extracted.length > 0) {
        const first = extracted[0]!;
        const convId = selectedConversationIdRef.current;
        if (convId && user) {
          const durable = await getOrCreateArtifactForMessage(supabase, convId, user.id, first, messageId);
          setActiveArtifact(durable);
        } else {
          setActiveArtifact(first);
        }
        setIsArtifactModalOpen(true);
      }
    },
    [user]
  );

  // Preference synchronization across devices (F20)
  const userInteractedPrefsRef = useRef<{
    routingProfile?: boolean;
    webSearchEnabled?: boolean;
    maxSpendCap?: boolean;
  }>({});

  useEffect(() => {
    userInteractedPrefsRef.current = {};
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    void syncPreferences(supabase).then((prefs) => {
      if (prefs.routingProfile && !userInteractedPrefsRef.current.routingProfile) {
        setRoutingProfile(prefs.routingProfile);
      }
      if (prefs.webSearchEnabled !== undefined && !userInteractedPrefsRef.current.webSearchEnabled) {
        setWebSearchEnabled(prefs.webSearchEnabled);
      }
      if (prefs.maxSpendCap !== undefined && !userInteractedPrefsRef.current.maxSpendCap) {
        setMaxSpendCap(prefs.maxSpendCap);
      }
      if (prefs.defaultProjectId && !activeProjectId) {
        setActiveProjectId(prefs.defaultProjectId);
      }
    });
  }, [user?.id]);

  const prefsTimeoutRef = useRef<any>(null);
  useEffect(() => {
    if (!user) return;
    clearTimeout(prefsTimeoutRef.current);
    prefsTimeoutRef.current = setTimeout(() => {
      void saveServerPreferences(supabase, {
        routingProfile,
        webSearchEnabled,
        maxSpendCap,
        defaultProjectId: activeProjectId,
      });
    }, 800);
    return () => clearTimeout(prefsTimeoutRef.current);
  }, [user?.id, routingProfile, webSearchEnabled, maxSpendCap, activeProjectId]);

  // Refresh history whenever the authenticated account or server-side project filter changes.
  useEffect(() => {
    if (!user?.id) return;
    void refreshConversations(activeProjectId);
  }, [user?.id, activeProjectId, refreshConversations]);

  // Per-account selection: restore on sign-in/account change, isolated by user.
  useEffect(() => {
    const plan = planInitialConversation(readSelectedConversation(user?.id ?? null));
    // Account-change isolation: a new account with no stored selection must not
    // inherit the shared `prismatix_conversation_id` from the previous account.
    if (plan.resetGlobalConversation) {
      resetConversation();
    }
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

  const streamUpdateApplies = (accountGeneration: number): boolean => {
    if (accountGeneration !== accountGenerationRef.current) return false;
    const active = activeStreamRef.current;
    if (active?.accountGeneration !== accountGeneration) return false;
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
    regenerateTargetMessageId,
    optimisticMessageId,
  }: {
    queryText: string;
    attachmentsToProcess: FileUploadPayload[];
    historyMessages: Message[];
    overrideModel?: RouterModel | null;
    promptTokenEstimate?: number;
    skipBudgetCheck?: boolean;
    regenerateTargetMessageId?: string;
    optimisticMessageId?: string;
  }) => {
    const requestAccountGeneration = accountGenerationRef.current;
    const requestUserId = user?.id;
    const requestRoute: { mode: 'chat' | 'compare' | 'debate'; manualModel: RouterModel | null } = {
      mode: workspaceMode,
      manualModel: workspaceMode === 'chat' ? manualModelOverride : null,
    };
    const requestStillCurrent = () => requestAccountGeneration === accountGenerationRef.current
      && activeUserIdRef.current === requestUserId;
    if (!requestStillCurrent()) return;
    const estimatedModel = overrideModel || manualModelOverride || currentModel;
    const historyText = historyMessages.map((msg) => {
      const content = extractTextContent(msg.content);
      return `${msg.role}: ${content}`;
    }).join('\n');
    const imageCount = attachmentsToProcess.filter((file) => file.isImage).length;
    const isDebate = debateSelection !== 'off' && debateSelection !== 'auto';
    const preflight = isDebate
      ? calculateDebatePreFlightCost(
          debateSelection,
          estimatedModel,
          `${historyText}\nuser: ${queryText}`,
          imageCount,
        )
      : calculatePreFlightCost(
          estimatedModel,
          `${historyText}\nuser: ${queryText}`,
          imageCount,
        );
    const promptTokenEstimate = passedPromptTokenEstimate ?? preflight.promptTokens;
    const comparisonBudgetEstimate = comparisonMode
      ? calculatePreFlightCost(comparisonModelA, `${historyText}\nuser: ${queryText}`, imageCount).estimatedUsd
        + calculatePreFlightCost(comparisonModelB, `${historyText}\nuser: ${queryText}`, imageCount).estimatedUsd
      : preflight.estimatedUsd;

    if (!skipBudgetCheck) {
      const dailyTotalUsd = await fetchServerDailyTotal();
      if (!requestStillCurrent()) return;
      const budgetDecision = evaluateBudget({
        estimateUsd: comparisonBudgetEstimate,
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
        pendingActionRef.current = () => {
          if (!requestStillCurrent()) return;
          void executeTurn({
            queryText,
            attachmentsToProcess,
            historyMessages,
            overrideModel,
            promptTokenEstimate,
            skipBudgetCheck: true,
          });
        };
        setBudgetConfirm({
          estimateUsd: comparisonBudgetEstimate,
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

    const restoreComposerSafely = () => {
      if (!requestStillCurrent()) return;
      if (queryText) {
        setInput((current) => {
          // Only restore if user hasn't typed a newer distinct draft
          if (!current.trim() || current === queryText) {
            return queryText;
          }
          return current;
        });
      }
      if (attachmentsToProcess.length > 0) {
        setDraftAttachments((current) => {
          // Only restore if user hasn't added new draft attachments
          if (current.length === 0) {
            return attachmentsToProcess;
          }
          return current;
        });
      }
    };

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
      if (!requestStillCurrent()) return;
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
      const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null;
      const projectPromptContext = formatProjectContextPrompt(activeProject);
      let queryWithContext = projectPromptContext ? `${projectPromptContext}\n\n${queryText}` : queryText;

      // Unified Grounding & Search Planning (F11, F22, F24)
      // Eliminates duplicate web search requests and duplicate project knowledge queries.
      let citations: SearchCitation[] | undefined;

      // 1. Fetch web search once per turn if enabled
      if (webSearchEnabled) {
        try {
          const searchRes = await executeWebSearch(queryText);
          if (!requestStillCurrent()) return;
          if (searchRes.citations.length > 0) {
            citations = searchRes.citations;
          } else if (searchRes.error) {
            setActionNotice({ message: searchRes.error, type: 'error' });
          }
        } catch (err) {
          console.warn('[ChatInterface] Web search failed, proceeding without search:', err);
        }
        if (!requestStillCurrent()) return;

      }

      // 2. F24: Multi-source research workflow mode incorporates project knowledge and web results
      if (researchMode) {
        try {
          const researchCtx = await executeResearchWorkflow(supabase, queryText, {
            projectId: activeProjectId,
            includeWebSearch: !(citations && citations.length > 0),
            existingCitations: citations,
          });
          if (!requestStillCurrent()) return;
          if (researchCtx.citations && researchCtx.citations.length > 0) {
            citations = researchCtx.citations;
          }
          if (researchCtx.groundingPrompt) {
            queryWithContext = `${researchCtx.groundingPrompt}\n\n${queryWithContext}`;
          }
        } catch (err) {
          console.warn('[ChatInterface] Research workflow failed:', err);
        }
        if (!requestStillCurrent()) return;
      } else {
        // Standard mode: project knowledge search and/or web search augmentation
        if (activeProjectId) {
          try {
            const knowledgeHits = await searchProjectKnowledge(supabase, {
              projectId: activeProjectId,
              query: queryText,
              limit: 3,
            });
            if (!requestStillCurrent()) return;
            if (knowledgeHits.length > 0) {
              const groundingBlock = formatKnowledgeGroundingBlock(knowledgeHits);
              queryWithContext = `${groundingBlock}\n\n${queryWithContext}`;
            }
          } catch (err) {
            console.warn('[ChatInterface] Project knowledge search failed:', err);
          }
          if (!requestStillCurrent()) return;
        }

        if (citations && citations.length > 0) {
          const webGrounding = `\n\n[Web Search Grounding]\n${citations.map((c) => `[${c.id}] ${c.title} (${c.url}): ${c.snippet}`).join('\n')}\n`;
          queryWithContext = `${queryWithContext}${webGrounding}`;
        }
      }

      // F12: Side-by-side comparison mode execution
      if (comparisonMode) {
        setIsStreaming(true);
        setIsWaitingFirstToken(false);
        const placeholderMsg: Message = {
          role: 'assistant',
          content: `Comparing **${comparisonModelA}** and **${comparisonModelB}**...`,
          timestamp: Date.now(),
          comparisonResults: {
            modelA: { model: comparisonModelA, content: 'Evaluating prompt...' },
            modelB: { model: comparisonModelB, content: 'Evaluating prompt...' },
          },
          citations,
        };
        setMessages((prev) => [...prev, placeholderMsg]);

        const [resA, resB] = await Promise.allSettled([
          askPrismatixSync(
            queryWithContext,
            historyForRequest,
            attachmentsToProcess,
            comparisonModelA,
            geminiFlashThinkingLevel,
            undefined,
            routingProfile,
            maxSpendCap ?? undefined,
            abortController.signal,
          ),
          askPrismatixSync(
            queryWithContext,
            historyForRequest,
            attachmentsToProcess,
            comparisonModelB,
            geminiFlashThinkingLevel,
            undefined,
            routingProfile,
            maxSpendCap ?? undefined,
            abortController.signal,
          ),
        ]);
        if (!requestStillCurrent()) return;

        const statusFor = (result: PromiseSettledResult<Awaited<ReturnType<typeof askPrismatixSync>>>): 'completed' | 'interrupted' | 'stopped' | 'failed' => {
          if (result.status !== 'fulfilled' || !result.value) return 'failed';
          if (result.value.terminationStatus === 'cancelled') return 'stopped';
          if (result.value.terminationStatus === 'interrupted' || result.value.terminationStatus === 'error' || !result.value.isDoneReceived) return 'interrupted';
          if (result.value.terminationStatus !== 'completed' || !result.value.receipt) return 'failed';
          return 'completed';
        };
        const statusA = statusFor(resA);
        const statusB = statusFor(resB);

        const contentA =
          resA.status === 'fulfilled' && resA.value?.content
            ? resA.value.content
            : `⚠️ ${resA.status === 'rejected' ? (resA.reason as Error)?.message || 'Failed' : 'Unable to generate response'}`;
        const costA = resA.status === 'fulfilled' ? resA.value?.costEstimateUsd : undefined;

        const contentB =
          resB.status === 'fulfilled' && resB.value?.content
            ? resB.value.content
            : `⚠️ ${resB.status === 'rejected' ? (resB.reason as Error)?.message || 'Failed' : 'Unable to generate response'}`;
        const costB = resB.status === 'fulfilled' ? resB.value?.costEstimateUsd : undefined;

        if (resA.status === 'fulfilled' && resA.value?.costEstimateUsd) {
          recordCost({
            model: comparisonModelA,
            cost: resA.value.costEstimateUsd,
            conversationId: sendConversationId,
            costStatus: 'estimated',
          });
        }
        if (resB.status === 'fulfilled' && resB.value?.costEstimateUsd) {
          recordCost({
            model: comparisonModelB,
            cost: resB.value.costEstimateUsd,
            conversationId: sendConversationId,
            costStatus: 'estimated',
          });
        }

        const comparisonResultsData = {
          modelA: { model: comparisonModelA, content: contentA, cost: costA, status: statusA, transcriptSaved: resA.status === 'fulfilled' && resA.value?.receipt?.transcript?.saved === true },
          modelB: { model: comparisonModelB, content: contentB, cost: costB, status: statusB, transcriptSaved: resB.status === 'fulfilled' && resB.value?.receipt?.transcript?.saved === true },
        };
        const comparisonSummary = `Side-by-side comparison: **${comparisonModelA}** vs **${comparisonModelB}**`;

        const execIdA = resA.status === 'fulfilled'
          ? resA.value?.executionId ?? resA.value?.receipt?.executionId
          : undefined;
        let persistedId: string | undefined;
        let comparisonSaved = false;
        const bothTranscriptsSaved = comparisonResultsData.modelA.transcriptSaved
          && comparisonResultsData.modelB.transcriptSaved;

        if (execIdA && bothTranscriptsSaved) {
          try {
            const { data, error } = await supabase
              .from('messages')
              .update({
                content: comparisonSummary,
                metadata: {
                  comparisonResults: comparisonResultsData,
                  citations: citations && citations.length > 0 ? citations : undefined,
                },
              })
              .eq('execution_id', execIdA)
              .select('id')
              .maybeSingle();
            if (!requestStillCurrent()) return;
            if (error) throw error;
            if (data?.id) {
              persistedId = data.id;
              comparisonSaved = true;
            }
          } catch (err) {
            console.warn('[ChatInterface] Failed to persist comparison metadata to Supabase:', err);
          }
          if (!requestStillCurrent()) return;
        }

        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = {
              ...last,
              id: persistedId ?? last.id,
              content: comparisonSummary,
              comparisonResults: comparisonResultsData,
              transcriptSaved: comparisonSaved,
              citations,
            };
          }
          return updated;
        });

        setIsStreaming(false);
        setSpendRefreshKey((prev) => prev + 1);
        void refreshConversations();
        return;
      }

      // F13: Routing profile selection fallback
      let effectiveOverride = overrideModel || manualModelOverride;
      if (!effectiveOverride) {
        if (routingProfile === 'economy') {
          effectiveOverride = 'gemini-3.8-flash';
        } else if (routingProfile === 'capability') {
          effectiveOverride = 'gpt-6-sol';
        }
      }

      const result = await askPrismatix(
        queryWithContext,
        historyForRequest,
        attachmentsToProcess,
        effectiveOverride,
        geminiFlashThinkingLevel,
        getDebatePayload(debateSelection),
        firstImageStorageRef,
        abortController.signal,
        attachmentRefs,
        routingProfile,
        maxSpendCap ?? undefined,
      );

      if (!requestStillCurrent()) return;

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
        debateExecutionMode,
        debateCostNote,
        debateDegraded,
        debateDegradedReason,
        executionId,
        clientRequestId,
      } = result;

      executionIdRef.current = executionId;
      if (result.memoryHits !== undefined) setLastRecall({ conversationId: sendConversationId, hits: result.memoryHits });

      // PX07: stream/delta updates are guarded by (conversationId, requestId).
      activeStreamRef.current = {
        conversationId: sendConversationId,
        clientRequestId: clientRequestId ?? null,
        accountGeneration: requestAccountGeneration,
      };
      // A New Chat becomes a real, selected conversation once its first send
      // creates the durable execution, so reload reopens it.
      if (selectedConversationIdRef.current === null) {
        selectedConversationIdRef.current = sendConversationId;
        setSelectedConversationId(sendConversationId);
        writeSelectedConversation(user?.id ?? null, sendConversationId);
        if (activeProjectId) {
          void assignConversationProject(supabase, sendConversationId, activeProjectId);
        }
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
        debateExecutionMode,
        debateCostNote,
        debateDegraded,
        debateDegradedReason,
        thinkingLog: [],
        citations,
        cost: costEstimateUsd !== undefined
          ? {
            estimatedUsd: costEstimateUsd,
            pricingVersion: costPricingVersion,
          }
          : undefined,
        timestamp: Date.now(),
      }]);

      const {
        assistantContent,
        thinkingLog,
        streamedFinalUsd,
        debateParticipants,
        receipt,
        terminationStatus,
        error: streamError,
      } = await readRouterStream(
        stream,
        promptTokenEstimate,
        {
          onFirstToken: () => {
            if (!requestStillCurrent()) return;
            waitingFirstTokenRef.current = false;
            setIsWaitingFirstToken(false);
          },
          onUsageUpdate: (usage) => {
            if (!requestStillCurrent()) return;
            setCurrentUsage(usage);
          },
          onContentUpdate: (content, log) => {
            if (!streamUpdateApplies(requestAccountGeneration)) return;
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

      if (!requestStillCurrent()) return;

      // PX06: an abort mid-stream makes readRouterStream resolve with the
      // partial content; surface the cancellation instead of a completion.
      if (abortController.signal.aborted || terminationStatus === 'cancelled') {
        if (!assistantContent || waitingFirstTokenRef.current) {
          restoreComposerSafely();
        }
        setStreamOutcome({ status: 'cancelled', executionId });
        scheduleCostEstimatorHide(1500);
        return;
      }

      const promptTokens =
        calculateHistoryTokens(historyMessages) +
        estimateTokenCount(queryText) +
        attachmentsToProcess.filter((file) => file.isImage).length * 1600;
      const completionTokens = estimateTokenCount(assistantContent);
      const computedCost = calculateFinalCost(model, { promptTokens, completionTokens });

      // Handle premature stream termination without terminal receipt/[DONE]
      if (terminationStatus === 'interrupted' || terminationStatus === 'error') {
        if (!assistantContent || waitingFirstTokenRef.current) {
          restoreComposerSafely();
        }
        const errorMsg =
          terminationStatus === 'interrupted'
            ? 'Connection closed prematurely before the response completed.'
            : (streamError ? String(streamError) : 'Stream encountered an error during transmission.');

        setStreamOutcome({
          status: terminationStatus,
          executionId: receipt?.executionId ?? executionId,
          settlementState: receipt?.settlement?.state,
          receiptStatus: receipt?.status,
          terminalOutcome: receipt?.terminalOutcome ?? null,
          error: errorMsg,
        });

        const hasReceiptSettled = receipt?.settlement?.state === 'settled';
        const isPendingSettlement = receipt?.settlement?.state === 'pending';
        const authoritativeCost = hasReceiptSettled
          ? receipt!.settlement.committedUsd
          : undefined;

        // Do not infer no charge from a disconnect if the server already committed/settled
        const costStatus: CostStatus = hasReceiptSettled
          ? 'settled'
          : isPendingSettlement
          ? 'pending'
          : 'unknown';

        if (authoritativeCost !== undefined && authoritativeCost > 0) {
          recordCost({
            model,
            cost: authoritativeCost,
            pricingVersion: costPricingVersion || computedCost.pricingVersion,
            provider,
            conversationId: sendConversationId,
            costStatus,
            promptTokens,
            completionTokens,
            executionId: receipt?.executionId ?? executionId,
          });
          setSessionCostTotal((prev) => prev + authoritativeCost);
          setFinalMessageCost(authoritativeCost);
        } else {
          setFinalMessageCost(null);
        }

        if (streamUpdateApplies(requestAccountGeneration)) {
          setMessages((prev) => {
            const updated = [...prev];
            const lastMessage = updated[updated.length - 1];
            if (lastMessage?.role === 'assistant') {
              updated[updated.length - 1] = {
                ...lastMessage,
                transcriptSaved: receipt?.transcript?.saved === false ? false : undefined,
                content: assistantContent
                  ? `${assistantContent}\n\n⚠️ _[Response interrupted before completion]_`
                  : '⚠️ _[Connection interrupted before response started]_',
                cost: {
                  estimatedUsd: authoritativeCost ?? computedCost.finalUsd,
                  finalUsd: authoritativeCost,
                  status: costStatus,
                  pricingVersion: costPricingVersion || computedCost.pricingVersion,
                  promptTokens,
                  completionTokens,
                  durationMs: Date.now() - streamStartMs,
                },
                thinkingLog: [...thinkingLog],
                thinkingDurationMs: Date.now() - streamStartMs,
              };
            }
            return updated;
          });
        }
        scheduleCostEstimatorHide(1500);
        return;
      }

      // PX06: surface the terminal receipt (execution id + settlement state + status + outcome).
      setStreamOutcome({
        status: 'receipt',
        executionId: receipt?.executionId ?? executionId,
        settlementState: receipt?.settlement.state,
        receiptStatus: receipt?.status,
        terminalOutcome: receipt?.terminalOutcome ?? null,
      });

      // Truthful cost settlement logic:
      // Authoritative settled cost requires either a settled receipt committedUsd OR a server streamedFinalUsd.
      const hasReceiptSettled = receipt?.settlement.state === 'settled';
      const isPendingSettlement = receipt?.settlement.state === 'pending';
      const authoritativeFinalUsd = hasReceiptSettled
        ? receipt!.settlement.committedUsd
        : typeof streamedFinalUsd === 'number' && Number.isFinite(streamedFinalUsd)
        ? streamedFinalUsd
        : undefined;

      const costStatus: CostStatus = hasReceiptSettled
        ? 'settled'
        : isPendingSettlement
        ? 'pending'
        : authoritativeFinalUsd !== undefined
        ? 'settled'
        : 'estimated';

      setFinalMessageCost(authoritativeFinalUsd ?? null);

      if (authoritativeFinalUsd !== undefined && authoritativeFinalUsd > 0) {
        recordCost({
          model,
          cost: authoritativeFinalUsd,
          pricingVersion: costPricingVersion || computedCost.pricingVersion,
          provider,
          conversationId: sendConversationId,
          costStatus,
          promptTokens,
          completionTokens,
          executionId: receipt?.executionId ?? executionId,
        });
        setSessionCostTotal((prev) => prev + authoritativeFinalUsd);
      }
      setSpendRefreshKey((prev) => prev + 1);

      let messageVersions: any[] | undefined;
      if (regenerateTargetMessageId && assistantContent) {
        try {
          const verRes = await persistMessageVersion(
            supabase,
            regenerateTargetMessageId,
            assistantContent,
            model,
          );
          if (!requestStillCurrent()) return;
          if (verRes.success) {
            messageVersions = verRes.versions;
          }
        } catch (verErr) {
          console.warn('[ChatInterface] Failed to record message version:', verErr);
        }
        if (!requestStillCurrent()) return;
      }

      if (streamUpdateApplies(requestAccountGeneration)) {
        setMessages((prev) => {
          const updated = [...prev];
          const lastMessage = updated[updated.length - 1];
          if (lastMessage?.role === 'assistant') {
            updated[updated.length - 1] = {
              ...lastMessage,
              transcriptSaved: receipt?.transcript?.saved === false ? false : undefined,
              id: regenerateTargetMessageId || lastMessage.id,
              cost: {
                estimatedUsd: costEstimateUsd ?? computedCost.finalUsd,
                finalUsd: authoritativeFinalUsd,
                status: costStatus,
                pricingVersion: costPricingVersion || computedCost.pricingVersion,
                promptTokens,
                completionTokens,
                durationMs: Date.now() - streamStartMs,
              },
              thinkingLog: [...thinkingLog],
              thinkingDurationMs: Date.now() - streamStartMs,
              metadata: {
                ...(lastMessage.metadata || {}),
                ...(messageVersions ? { versions: messageVersions } : {}),
              },
              ...(debateParticipants && debateParticipants.length > 0
                ? { debateParticipants }
                : {}),
            };
          }
          return updated;
        });
      }
      scheduleCostEstimatorHide(3000);
      setFailedTurnDraft(null);
      activeDraftRef.current = null;
      // PX07: the list/title changed server-side; refresh in the background.
      void refreshConversations();
    } catch (error) {
      if (!requestStillCurrent()) return;
      if (error instanceof DuplicateRequestError) {
        // PX07: the same logical send already created an execution. Load/show
        // the existing turn; never auto-dispatch a new paid request.
        restoreComposerSafely();
        setDuplicateNotice(
          error.executionId
            ? `This request was already recorded (execution ${error.executionId.slice(0, 8)}).`
            : 'This request was already recorded.',
        );
        if (selectedConversationIdRef.current) {
          await openConversation(selectedConversationIdRef.current);
          if (!requestStillCurrent()) return;
        }
        scheduleCostEstimatorHide(1500);
      } else if (abortController.signal.aborted) {
        // PX06: a user Stop is a cancellation, not an error. Surface it and the
        // execution identity (the server finalizes the execution `cancelled`).
        if (waitingFirstTokenRef.current) {
          restoreComposerSafely();
        }
        setStreamOutcome({ status: 'cancelled', executionId: executionIdRef.current });
        scheduleCostEstimatorHide(1500);
        setFailedTurnDraft({
          rawInput: activeDraftRef.current?.rawInput ?? queryText,
          queryText,
          attachments: attachmentsToProcess,
          error: 'Generation cancelled',
          overrideModel: overrideModel || undefined,
          optimisticMessageId,
          optimisticMessageContent: activeDraftRef.current?.optimisticMessageContent,
        });
      } else {
        console.error('Stream error:', error);
        const errorDesc = describeStreamError(error);
        const routerCode = error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';
        const routeUnavailable = ['provider_key_required', 'provider_key_unavailable', 'no_available_provider', 'provider_unavailable', 'provider_disabled'].includes(routerCode);
        setShowCostEstimator(false);
        setStreamOutcome({
          status: 'error',
          executionId: executionIdRef.current,
          error: errorDesc,
        });
        if (routeUnavailable) {
          providerPlugins.invalidateVerification();
          setRejectedRoute(requestRoute);
          if (optimisticMessageId) {
            setMessages((prev) => prev.filter((message) => message.id !== optimisticMessageId));
          }
        } else {
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: `⚠️ ${errorDesc}`,
            timestamp: Date.now(),
          }]);
        }
        scheduleCostEstimatorHide(1500);

        // F02: Preserve user prompt and attachments safely in session memory
        setFailedTurnDraft({
          rawInput: activeDraftRef.current?.rawInput ?? queryText,
          queryText,
          attachments: attachmentsToProcess,
          error: errorDesc,
          overrideModel: overrideModel || undefined,
          optimisticMessageId,
          optimisticMessageContent: activeDraftRef.current?.optimisticMessageContent,
        });
        if (waitingFirstTokenRef.current) {
          restoreComposerSafely();
        }
      }
    } finally {
      if (requestStillCurrent()) {
        if (abortControllerRef.current === abortController) abortControllerRef.current = null;
        if (activeStreamRef.current?.accountGeneration === requestAccountGeneration) activeStreamRef.current = null;
        setIsStreaming(false);
        setIsWaitingFirstToken(false);
        waitingFirstTokenRef.current = false;
      }
    }
  };

  const handleSend = async (skipBudgetCheck = false, existingLockId?: number) => {
    // Allow send if there's text OR attachments
    const hasContent = input.trim() || draftAttachments.length > 0;
    if (!hasContent || isStreaming) return;
    if (hasPendingVideoUploads) {
      setSendValidationError('Attachments are still processing. Please wait for completion before sending.');
      return;
    }
    if (!providerCanAttemptRouterSend) {
      setSendValidationError(providerPlugins.error
        ? 'Provider setup could not be checked. Retry the check or open Provider Settings.'
        : providerPlugins.loading
          ? 'Provider setup is still being checked. Please wait before sending.'
          : providerVerificationRequiresAction
            ? routeRecoveryApplies
              ? 'The router recently rejected this route. Verify or update its provider before retrying.'
              : providerPlugins.verificationStatus === 'invalid' || providerPlugins.providers.some((provider) => provider.status === 'invalid_revoked')
              ? 'A saved provider key was rejected. Update it in Provider Settings, then verify it before sending.'
              : providerPlugins.verificationLoading
                ? 'Provider verification is in progress. Please wait before sending.'
                : 'A recent provider check or router request could not confirm this key. Verify or update it before sending.'
            : !providerPlugins.isConfigured
              ? 'No enabled provider with a saved key is available. Open Provider Settings to connect or enable a provider.'
              : 'No enabled provider is available for this route. Open Provider Settings to review your providers.');
      return;
    }
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
      const content = extractTextContent(msg.content);
      return `${msg.role}: ${content}`;
    }).join('\n');
    const imageCount = draftAttachments.filter((file) => file.isImage).length;
    const isDebate = debateSelection !== 'off' && debateSelection !== 'auto';
    const preflight = isDebate
      ? calculateDebatePreFlightCost(
          debateSelection,
          estimatedModel,
          `${historyText}\nuser: ${queryText}`,
          imageCount,
        )
      : calculatePreFlightCost(
          estimatedModel,
          `${historyText}\nuser: ${queryText}`,
          imageCount,
        );
    const promptTokenEstimate = preflight.promptTokens;
    const budgetEstimateUsd = comparisonMode
      ? calculatePreFlightCost(comparisonModelA, `${historyText}\nuser: ${queryText}`, imageCount).estimatedUsd
        + calculatePreFlightCost(comparisonModelB, `${historyText}\nuser: ${queryText}`, imageCount).estimatedUsd
      : preflight.estimatedUsd;

    // F13: Spend cap enforcement
    if (comparisonMode) {
      const preflightA = calculatePreFlightCost(
        comparisonModelA,
        `${historyText}\nuser: ${queryText}`,
        imageCount,
      );
      const preflightB = calculatePreFlightCost(
        comparisonModelB,
        `${historyText}\nuser: ${queryText}`,
        imageCount,
      );
      const combined = preflightA.estimatedUsd + preflightB.estimatedUsd;
      if (maxSpendCap !== null && combined > maxSpendCap) {
        setSendValidationError(
          `Estimated combined cost of $${combined.toFixed(4)} exceeds your configured spend cap of $${maxSpendCap.toFixed(2)}. Adjust your spend cap or choose different models.`,
        );
        return;
      }
    } else if (maxSpendCap !== null && preflight.estimatedUsd > maxSpendCap) {
      setSendValidationError(
        `Estimated cost of $${preflight.estimatedUsd.toFixed(4)} exceeds your configured spend cap of $${maxSpendCap.toFixed(2)}. Adjust your spend cap or choose an economy model.`,
      );
      return;
    }

    let sendLock = sendLockRef.current;
    if (sendLock) {
      if (existingLockId !== sendLock.id) return;
    } else {
      if (existingLockId !== undefined) return;
      sendLock = {
        id: ++sendLockSeqRef.current,
        userId: user?.id,
        accountGeneration: accountGenerationRef.current,
        conversationId: selectedConversationIdRef.current,
      };
      sendLockRef.current = sendLock;
    }
    const releaseSendLock = () => {
      if (sendLockRef.current?.id === sendLock!.id) {
        sendLockRef.current = null;
        setIsSendPending(false);
      }
    };

    if (!skipBudgetCheck) {
      setIsSendPending(true);
      // Fetch from server first so budget cannot be bypassed by clearing localStorage or opening a new tab.
      // Falls back to localStorage total if the server is unreachable.
      let timeoutId: number | undefined;
      let dailyTotalUsd: number;
      try {
        dailyTotalUsd = await Promise.race([
          fetchServerDailyTotal(),
          new Promise<never>((_, reject) => {
            timeoutId = window.setTimeout(() => reject(new Error('budget_check_timeout')), 8000);
          }),
        ]);
      } catch {
        setSendValidationError('Daily budget check did not finish. Your draft is still here; retry the check before sending.');
        releaseSendLock();
        return;
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      }
      if (sendLockRef.current?.id !== sendLock.id
        || sendLock.accountGeneration !== accountGenerationRef.current
        || sendLock.userId !== user?.id
        || sendLock.conversationId !== selectedConversationIdRef.current) {
        releaseSendLock();
        return;
      }
      const budgetDecision = evaluateBudget({
        estimateUsd: budgetEstimateUsd,
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
        releaseSendLock();
        return;
      }

      if (budgetDecision.requiresConfirm) {
        pendingActionRef.current = () => void handleSend(true, sendLock!.id);
        setBudgetConfirm({
          estimateUsd: budgetEstimateUsd,
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
    const optimisticMessageId = `optimistic-${crypto.randomUUID()}`;
    const userMessage: Message = {
      id: optimisticMessageId,
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

    // Preserve draft in activeDraftRef before clearing inputs so it is recoverable if anything fails
    activeDraftRef.current = {
      rawInput: input,
      queryText,
      attachments: [...draftAttachments],
      overrideModel: manualModelOverride || undefined,
      optimisticMessageId,
      optimisticMessageContent: String(userMessage.content),
    };

    // Clear inputs
    setInput('');
    const attachmentsToProcess = [...draftAttachments];
    setDraftAttachments([]);
    if (inputRef.current) inputRef.current.style.height = 'auto';

    setIsSendPending(false);
    try {
      await executeTurn({
        queryText,
        attachmentsToProcess,
        historyMessages: historyForRequest,
        overrideModel: manualModelOverride || undefined,
        promptTokenEstimate,
        skipBudgetCheck: true,
        optimisticMessageId,
      });
    } finally {
      releaseSendLock();
    }
  };

  const handleVerifyProviders = async () => {
    const requestUserId = user?.id;
    const resolvingFirstRun = Boolean(firstRunOutcome && !firstRunOutcome.verified);
    const verified = await providerPlugins.verifyEnabledProviders();
    if (activeUserIdRef.current !== requestUserId) return;
    // A user-driven provider check resolves the UI's route-recovery pause;
    // the router remains authoritative if this route still cannot dispatch.
    setRejectedRoute(null);
    if (resolvingFirstRun) {
      setFirstRunOutcome(verified
        ? { message: 'Provider key verified. You are ready to chat.', verified: true }
        : { message: 'Provider key could not be verified yet. Check the key or retry the verification.', verified: false });
    }
  };

  const isStreamingRef = useRef(isStreaming);
  const manualModelOverrideRef = useRef(manualModelOverride);
  const currentModelRef = useRef(currentModel);
  const executeTurnRef = useRef(executeTurn);
  isStreamingRef.current = isStreaming;
  manualModelOverrideRef.current = manualModelOverride;
  currentModelRef.current = currentModel;
  executeTurnRef.current = executeTurn;

  const handleRegenerate = useCallback(async (index: number, modelOverride?: RouterModel) => {
    if (isStreamingRef.current || sendLockRef.current) return;
    const snapshot = messagesRef.current;
    let userIndex = -1;
    for (let i = index - 1; i >= 0; i--) {
      if (snapshot[i]?.role === 'user') {
        userIndex = i;
        break;
      }
    }
    if (userIndex === -1) return;

    const userMessage = snapshot[userIndex];
    if (!userMessage) return;
    const userPrompt = extractTextContent(userMessage.content);
    const attachmentsToProcess = userMessage.attachments ? [...userMessage.attachments] : [];
    const historyBeforeUser = snapshot.slice(0, userIndex);
    const selectedOverride = manualModelOverrideRef.current;
    const selectedModel = currentModelRef.current;

    const targetModel = modelOverride !== undefined ? modelOverride : (selectedOverride || selectedModel);
    const historyText = historyBeforeUser.map((msg) => {
      const content = extractTextContent(msg.content);
      return `${msg.role}: ${content}`;
    }).join('\n');
    const imageCount = attachmentsToProcess.filter((file) => file.isImage).length;
    const isDebate = debateSelection !== 'off' && debateSelection !== 'auto';
    const preflight = isDebate
      ? calculateDebatePreFlightCost(
          debateSelection,
          targetModel,
          `${historyText}\nuser: ${userPrompt}`,
          imageCount,
        )
      : calculatePreFlightCost(
          targetModel,
          `${historyText}\nuser: ${userPrompt}`,
          imageCount,
        );

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

    const targetAssistantMsg = snapshot[index];
    const regenerateTargetMessageId = targetAssistantMsg?.id;

    const executeRegenerateAction = () => {
      setMessages(snapshot.slice(0, userIndex + 1));
      resetAutoScroll();
      void executeTurnRef.current({
        queryText: userPrompt,
        attachmentsToProcess,
        historyMessages: historyBeforeUser,
        overrideModel: modelOverride !== undefined ? modelOverride : selectedOverride,
        promptTokenEstimate: preflight.promptTokens,
        skipBudgetCheck: true,
        regenerateTargetMessageId,
      });
    };

    if (budgetDecision.requiresConfirm) {
      pendingActionRef.current = executeRegenerateAction;
      setBudgetConfirm({
        estimateUsd: preflight.estimatedUsd,
        dailyTotalUsd,
      });
      return;
    }

    executeRegenerateAction();
  }, [resetAutoScroll, debateSelection]);

  const handleEditPrompt = useCallback(async (index: number, newPrompt: string) => {
    if (isStreamingRef.current || sendLockRef.current) return;
    const snapshot = messagesRef.current;
    const targetUserMessage = snapshot[index];
    if (!targetUserMessage || targetUserMessage.role !== 'user') return;

    const attachmentsToProcess = targetUserMessage.attachments ? [...targetUserMessage.attachments] : [];
    const historyBeforeUser = snapshot.slice(0, index);
    const selectedOverride = manualModelOverrideRef.current;
    const selectedModel = currentModelRef.current;

    const updatedUserMessage: Message = {
      ...targetUserMessage,
      content: newPrompt,
      timestamp: Date.now(),
    };

    const targetModel = selectedOverride || selectedModel;
    const historyText = historyBeforeUser.map((msg) => {
      const content = extractTextContent(msg.content);
      return `${msg.role}: ${content}`;
    }).join('\n');
    const imageCount = attachmentsToProcess.filter((file) => file.isImage).length;
    const isDebate = debateSelection !== 'off' && debateSelection !== 'auto';
    const preflight = isDebate
      ? calculateDebatePreFlightCost(
          debateSelection,
          targetModel,
          `${historyText}\nuser: ${newPrompt}`,
          imageCount,
        )
      : calculatePreFlightCost(
          targetModel,
          `${historyText}\nuser: ${newPrompt}`,
          imageCount,
        );

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

    const executeEditAction = () => {
      setMessages([...historyBeforeUser, updatedUserMessage]);
      resetAutoScroll();
      void executeTurnRef.current({
        queryText: newPrompt,
        attachmentsToProcess,
        historyMessages: historyBeforeUser,
        overrideModel: selectedOverride,
        promptTokenEstimate: preflight.promptTokens,
        skipBudgetCheck: true,
      });
    };

    if (budgetDecision.requiresConfirm) {
      pendingActionRef.current = executeEditAction;
      setBudgetConfirm({
        estimateUsd: preflight.estimatedUsd,
        dailyTotalUsd,
      });
      return;
    }

    executeEditAction();
  }, [resetAutoScroll, debateSelection]);

  const handleFeedback = useCallback((index: number, type: 'up' | 'down') => {
    setMessages((prev) => {
      const updated = [...prev];
      const target = updated[index];
      if (target) {
        const nextFeedback = target.feedback === type ? undefined : type;
        updated[index] = {
          ...target,
          feedback: nextFeedback,
        };
        if (nextFeedback) {
          void submitRoutingFeedback(supabase, {
            conversationId: selectedConversationIdRef.current,
            chosenModel: target.model || 'gemini-3.8-flash',
            routingRole: target.routeInfo?.role || null,
            feedbackType: nextFeedback === 'up' ? 'thumb_up' : 'thumb_down',
          });
        }
      }
      return updated;
    });
  }, []);

  const handleSelectComparisonPreference = useCallback((index: number, preferred: 'A' | 'B') => {
    setMessages((prev) => {
      const updated = [...prev];
      const target = updated[index];
      if (target?.comparisonResults) {
        const nextComparisonResults = {
          ...target.comparisonResults,
          preferred,
        };
        updated[index] = {
          ...target,
          comparisonResults: nextComparisonResults,
        };
        const preferredModel =
          preferred === 'A'
            ? target.comparisonResults.modelA.model
            : target.comparisonResults.modelB.model;
        void submitRoutingFeedback(supabase, {
          conversationId: selectedConversationIdRef.current,
          messageId: target.id,
          chosenModel: preferredModel,
          feedbackType: 'comparison_preference',
          comparisonPreferredModel: preferredModel,
        });
        if (target.id) {
          void supabase
            .from('messages')
            .update({
              metadata: {
                comparisonResults: nextComparisonResults,
                citations: target.citations,
              },
            })
            .eq('id', target.id);
        }
      }
      return updated;
    });
  }, []);

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    } else if (e.key === 'ArrowUp' && !input.trim() && messages.length > 0) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUserMsg) {
        const promptText = extractTextContent(lastUserMsg.content);
        if (promptText) {
          e.preventDefault();
          setInput(promptText);
          queueMicrotask(() => {
            if (inputRef.current) {
              inputRef.current.selectionStart = inputRef.current.value.length;
              inputRef.current.selectionEnd = inputRef.current.value.length;
            }
          });
        }
      }
    }
  };

  const handleCapabilityCardClick = (card: CapabilityPillar) => {
    setInput(card.prompt);
    if (card.isDebate) selectWorkspaceMode('debate');
    else if (card.isCompare) selectWorkspaceMode('compare');
    else selectWorkspaceMode('chat');
    if (card.isUpload) {
      filePickerRef.current?.();
      return;
    }
    inputRef.current?.focus();
  };

  const handleNewChatRef = useRef(handleNewChat);
  handleNewChatRef.current = handleNewChat;

  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (document.querySelector('dialog.provider-settings[open]')) return;
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      const isInputFocused =
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        activeTag === 'select' ||
        (document.activeElement as HTMLElement)?.isContentEditable;

      if (e.key === 'Escape') {
        if (isShortcutsOpen) {
          setIsShortcutsOpen(false);
          return;
        }
        if (isStreaming) {
          handleStop();
          return;
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        handleNewChatRef.current();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        setSidebarOpen((prev) => !prev);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setIsGlobalSearchOpen((prev) => !prev);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setShowModelSelector((prev) => !prev);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        setShowModelSelector((prev) => !prev);
        return;
      }

      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !isInputFocused) {
        e.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
        return;
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => {
      window.removeEventListener('keydown', handleGlobalShortcuts);
    };
  }, [isShortcutsOpen, isStreaming]);

  const handleCloseShortcuts = useCallback(() => {
    setIsShortcutsOpen(false);
  }, []);

  const handleBudgetCancel = () => {
    pendingActionRef.current = null;
    setBudgetConfirm(null);
    sendLockRef.current = null;
    setIsSendPending(false);
  };

  const handleBudgetConfirmSend = () => {
    setBudgetConfirm(null);
    if (pendingActionRef.current) {
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      action();
    } else {
      sendLockRef.current = null;
      setIsSendPending(false);
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
  const routingDraftText = [
    ...messages.map((message) => `${message.role}: ${extractTextContent(message.content)}`),
    `user: ${input.trim() || (draftAttachments.length ? 'Analyze the attached files.' : '')}`,
  ].filter(Boolean).join('\n');
  const routingImageCount = draftAttachments.filter((file) => file.isImage).length;
  const routingDraftEstimate = input.trim() || draftAttachments.length > 0
    ? comparisonMode
      ? (() => {
          const estimateA = calculatePreFlightCost(comparisonModelA, routingDraftText, routingImageCount);
          const estimateB = calculatePreFlightCost(comparisonModelB, routingDraftText, routingImageCount);
          return { hasUnknownRate: estimateA.hasUnknownRate || estimateB.hasUnknownRate, estimatedUsd: estimateA.estimatedUsd + estimateB.estimatedUsd, combined: true };
        })()
      : (() => {
          const estimate = debateSelection !== 'off' && debateSelection !== 'auto'
            ? calculateDebatePreFlightCost(debateSelection, manualModelOverride || currentModel, routingDraftText, routingImageCount)
            : calculatePreFlightCost(manualModelOverride || currentModel, routingDraftText, routingImageCount);
          return { hasUnknownRate: estimate.hasUnknownRate, estimatedUsd: estimate.estimatedUsd, combined: false };
        })()
    : null;
  const routingCostLabel = routingDraftEstimate
    ? routingDraftEstimate.hasUnknownRate
      ? 'Estimate unavailable for selected model pricing'
      : `About $${routingDraftEstimate.estimatedUsd.toFixed(4)}${routingDraftEstimate.combined ? ' combined for both models' : ' before sending'}`
    : finalMessageCost !== null
      ? `$${finalMessageCost.toFixed(4)} for the last completed response`
      : 'Shown after you add a draft or attachment.';
  const composerValidationView = getComposerSendValidationView(sendValidationError);
  // Why the composer cannot send right now, surfaced on the send control itself
  // so its disabled state is self-explanatory and never looks actionable.
  const sendBlockedReason = isStreaming
    ? 'streaming'
    : isSendPending
      ? 'pending'
      : hasPendingVideoUploads
      ? 'video'
      : sendValidationError
        ? 'invalid'
        : !providerCanAttemptRouterSend
          ? 'invalid'
        : !input.trim() && draftAttachments.length === 0
          ? 'empty'
          : null;

  const openRoutingDebateMenu = () => {
    setShowUserMenu(false);
    setShowModelSelector(true);
  };

  const currentConversationForExport: ExportableConversation | null = selectedConversationId
    ? {
        id: selectedConversationId,
        title: conversations.find((c) => c.id === selectedConversationId)?.title || 'Current Conversation',
        projectId: activeProjectId,
        projectName: projects.find((p) => p.id === activeProjectId)?.name,
        messages: messages.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          model: m.model,
          cost: typeof m.cost === 'number' ? m.cost : undefined,
          costStatus: typeof m.cost === 'object' && m.cost && 'status' in m.cost ? String((m.cost as any).status) : undefined,
          attachments: m.attachments?.map((a) => ({
            name: a.name,
            kind: a.kind,
            size: a.size || a.sizeBytes,
            pageCount: a.pageCount,
            sheetCount: a.sheetCount,
          })),
        })),
      }
    : null;

  const handleFetchAllConversations = async (
    onProgress?: (progress: ExportProgress) => void,
    signal?: AbortSignal,
  ): Promise<ExportResult> => {
    return fetchAllExportableConversations(supabase, { onProgress, signal });
  };

  const chatHeader = (
      <header className='chat-header' ref={setChatHeaderElement}>
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
          {showCostEstimator && !showProviderSettings && (
            <button
              type='button'
              className='compact-cost-details-button'
              aria-label='View cost details'
              onClick={() => {
                const panel = costEstimatorPanelRef.current;
                if (!panel || !costEstimatorDetailsButtonRef.current) return;
                const messageViewport = panel.closest<HTMLElement>('.chat-messages');
                if (!messageViewport) return;
                compactCostRevealRequestRef.current += 1;
                setCompactCostReveal({
                  viewportHeight: Math.max(0, messageViewport.clientHeight - 4),
                  request: compactCostRevealRequestRef.current,
                });
              }}
            >
              <span className='compact-cost-details-label'>Cost details</span>
              <span className='compact-cost-details-icon' aria-hidden='true'>$</span>
            </button>
          )}
          <button
            type='button'
            className='arctic-routing-toggle'
            ref={routingToggleRef}
            aria-expanded={routingPanelOpen}
            aria-controls='arctic-routing-panel'
            aria-label={routingPanelOpen ? 'Close routing details' : 'Routing details'}
            onClick={() => setRoutingPanelOpen((open) => !open)}
          >
            <span className='arctic-routing-toggle-label'>{routingPanelOpen ? 'Close routing details' : 'Routing details'}</span>
            <svg className='arctic-routing-toggle-icon' viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden='true'>
              <path d='M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6' />
            </svg>
          </button>
          {catalogSkewed && (
            <span
              className='catalog-skew-hint'
              title={`Server model catalog (${getServerTariffVersion()}) differs from this client's (${CLIENT_TARIFF_VERSION}); prices and availability may not match.`}
            >
              catalog may be outdated
            </span>
          )}
          <div className='header-utility-bar header-utility-bar-leading'>
          {contextStatus && (
            <details className='context-disclosure'>
              <summary title='View conversation context usage' aria-label='Conversation context usage'>
                <span className='context-trigger-dot' aria-hidden='true' />
                <span>Context</span>
              </summary>
              <div className='context-popover'><ContextStatus contextStatus={contextStatus} /></div>
            </details>
          )}
            <SpendTracker refreshKey={spendRefreshKey} />
            <button
              type='button'
              className='header-button shortcuts-toggle-button'
              onClick={() => setIsShortcutsOpen((prev) => !prev)}
              aria-label='Keyboard shortcuts'
              title='Keyboard shortcuts (?)'
            >
              <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' aria-hidden='true'>
                <rect x='2' y='4' width='20' height='16' rx='2' />
                <path d='M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8' />
              </svg>
            </button>
          </div>

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
                {debateSelection !== 'off' && (
                  <span className='debate-badge'>
                    {debateSelection === 'auto' ? 'Debate (Auto)' : 'Debate'}
                  </span>
                )}
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
                    if (sel !== 'off') {
                      setComparisonMode(false);
                      try { window.localStorage.setItem('prismatix_comparison_mode', 'false'); } catch { /* optional persistence */ }
                    }
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

            <div className='header-utility-bar header-utility-bar-trailing'>
            <button
              type='button'
              onClick={() => setIsGlobalSearchOpen(true)}
              className='header-button search-button'
              title='Global Search (Ctrl+K)'
              aria-label='Search all past conversations and messages'
              data-tooltip='Global Search'
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
                <circle cx='11' cy='11' r='8' />
                <line x1='21' y1='21' x2='16.65' y2='16.65' />
              </svg>
            </button>
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

            {canInstallPwa && (
              <button
                type='button'
                className='header-button install-pwa-button'
                onClick={handleInstallPwa}
                title='Install Prismatix as web app'
                aria-label='Install Prismatix as web app'
              >
                <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden='true'>
                  <path d='M12 3v12' />
                  <path d='m7 10 5 5 5-5' />
                  <path d='M5 21h14' />
                </svg>
                <span className='install-pwa-label'>Install</span>
              </button>
            )}

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
                  {onToggleTheme && (
                    <button type='button' className='dropdown-item' aria-pressed={theme === 'dark'} onClick={onToggleTheme}>
                      Dark theme
                    </button>
                  )}
                  <button type='button' onClick={handleSignOut} className='dropdown-item dropdown-item-danger'>
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
  );

  return (
    <div className={`app-with-sidebar arctic-workbench arctic-new-chat ${messages.length > 0 || selectedConversationId ? 'arctic-has-history' : ''} ${failedTurnDraft ? 'arctic-recovering' : ''} ${chatsHidden ? 'chats-hidden' : ''}`}>
      {!chatsHidden && (
        <ConversationSidebar
          preferenceScope={user?.id ?? null}
          conversations={conversations}
          selectedId={selectedConversationId}
          isLoading={conversationsLoading}
          disabled={isStreaming || isSendPending}
          isOpen={sidebarOpen}
          hasMore={hasMoreConversations}
          isLoadingMore={isLoadingMoreConversations}
          loadMoreError={loadMoreConversationsError}
          loadError={conversationsError}
          onRetry={() => void refreshConversations(activeProjectId)}
          onLoadMore={() => void handleLoadMoreConversations()}
          onOpenSearch={() => {
            setIsGlobalSearchOpen(true);
            if (window.innerWidth <= 768) setSidebarOpen(false);
          }}
          onClose={() => setSidebarOpen(false)}
          onRename={(id, title) => void handleRenameConversation(id, title)}
          onSelect={handleSelectConversation}
          onNewChat={handleNewChat}
          onDelete={(id) => void handleDeleteConversation(id)}
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={(projId) => setActiveProjectId(projId)}
          onOpenNewProject={() => {
            setEditingProject(null);
            setIsProjectModalOpen(true);
            if (window.innerWidth <= 768) setSidebarOpen(false);
          }}
          onOpenExport={() => {
            setIsExportModalOpen(true);
            if (window.innerWidth <= 768) setSidebarOpen(false);
          }}
          onOpenImport={() => {
            setIsImportModalOpen(true);
            if (window.innerWidth <= 768) setSidebarOpen(false);
          }}
          onOpenPromptLibrary={() => {
            setIsPromptLibraryOpen(true);
            if (window.innerWidth <= 768) setSidebarOpen(false);
          }}
          onArchiveConversation={handleArchiveConversation}
          onSetConversationTags={handleSetConversationTags}
        />
      )}
      {chatHeader}
      <div className={`chat-container ${messages.length === 0 ? 'is-empty' : ''} ${messages.length === 0 && !providerCanAttemptRouterSend ? 'provider-setup-blocked' : ''}`}>
      <ChatBackdrop />
      {/* Header */}


      {!isOnline && (
        <div
          className='offline-status-banner'
          role='status'
          aria-live='assertive'
        >
          Offline mode — live model inference is paused. You can keep reading and organizing loaded conversations.
        </div>
      )}

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
        {firstRunOutcome && (providerPlugins.isConfigured || messages.length > 0) && (
          <div className={`first-run-status ${firstRunOutcome.verified ? 'success' : 'pending'}`} role="status">
            {firstRunOutcome.verified ? '✓ ' : 'ℹ️ '}{firstRunOutcome.message}
          </div>
        )}
        {messages.length === 0
          ? (
            <div className='empty-state'>
              <div className='arctic-mode-switch' role='group' aria-label='Chat workflow'>
                {([
                  { id: 'chat', label: 'Chat' },
                  { id: 'compare', label: 'Compare' },
                  { id: 'debate', label: 'Debate' },
                ] as const).map((mode) => (
                  <button
                    key={mode.id}
                    type='button'
                    className={`arctic-mode-button ${workspaceMode === mode.id ? 'active' : ''}`}
                    aria-pressed={workspaceMode === mode.id}
                    onClick={() => selectWorkspaceMode(mode.id)}
                  >
                    <span className='arctic-mode-icon' aria-hidden='true'>
                      {mode.id === 'chat' ? (
                        <svg viewBox='0 0 24 24'><path d='M4 5.5h16v12H9l-5 3v-15Z' /></svg>
                      ) : mode.id === 'compare' ? (
                        <svg viewBox='0 0 24 24'><path d='M12 3v17M5 6h14M5 6l-3 7h6L5 6Zm14 0-3 7h6l-3-7ZM8 20h8' /></svg>
                      ) : (
                        <svg viewBox='0 0 24 24'><path d='M3 5.5A2.5 2.5 0 0 1 5.5 3h8A2.5 2.5 0 0 1 16 5.5v5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3v-4.3A2.5 2.5 0 0 1 3 9.5v-4Z' /><path d='M8 16.5A2.5 2.5 0 0 0 10.5 19H16l4 3v-4.3a2.5 2.5 0 0 0 1-2.2v-4A2.5 2.5 0 0 0 18.5 9H18' /></svg>
                      )}
                    </span>
                    {mode.label}
                  </button>
                ))}
              </div>
              {providerPlugins.loading ? (
                <div className='provider-setup-state' role='status'>Checking provider setup…</div>
              ) : providerPlugins.error ? (
                <div className='provider-setup-state error' role='alert'>
                  <strong>Could not check provider setup.</strong>
                  <span>Provider settings could not be loaded. Your draft remains available.</span>
                  <button type='button' onClick={() => void providerPlugins.refresh()}>Retry provider check</button>
                  <button type='button' onClick={() => setShowProviderSettings(true)}>Open Provider Settings</button>
                </div>
              ) : providerVerificationRequiresAction && !failedTurnDraft ? (
                <div className={`provider-setup-state ${routeRecoveryApplies || providerPlugins.verificationStatus === 'invalid' || providerPlugins.verificationStatus === 'unavailable' ? 'error' : ''}`} role={providerVerificationRequiresAction ? 'alert' : 'status'}>
                  <strong>{routeRecoveryApplies ? 'This route needs attention' : providerPlugins.verificationLoading ? 'Checking provider key' : providerPlugins.verificationStatus === 'invalid' ? 'Provider key needs attention' : providerPlugins.verificationStatus === 'unavailable' ? 'Could not verify provider key' : 'Verify your saved provider key'}</strong>
                  <span>{routeRecoveryApplies ? 'The router rejected a previous request for this route. Verify or update its provider before retrying; other routes remain subject to router authorization.' : providerPlugins.verificationLoading ? 'A provider check is in progress. Sending is paused until it completes.' : providerPlugins.verificationStatus === 'invalid' || providerPlugins.providers.some((provider) => provider.status === 'invalid_revoked') ? 'A provider rejected this saved key. Update it in Provider Settings, then verify again.' : providerPlugins.verificationStatus === 'unavailable' || providerPlugins.providers.some((provider) => provider.status === 'unavailable') ? 'Verification was unavailable. Your draft is preserved; retry the check when the provider is reachable.' : 'A recent first-run check could not confirm this key. Verify or update it before sending.'}</span>
                  <button type='button' disabled={providerPlugins.verificationLoading} onClick={() => void handleVerifyProviders()}>{providerPlugins.verificationLoading ? 'Verifying…' : 'Verify provider keys'}</button>
                  <button type='button' onClick={() => setShowProviderSettings(true)}>Open Provider Settings</button>
                </div>
              ) : !providerPlugins.isConfigured ? (
                <FirstRunSetupCard
                  key={user?.id ?? 'anonymous'}
                  plugins={providerPlugins}
                  onOpenSettings={() => setShowProviderSettings(true)}
                  onSaved={(message, verified) => {
                    setFirstRunOutcome({ message, verified });
                    if (verified) inputRef.current?.focus({ preventScroll: true });
                  }}
                />
              ) : (
                <>
                  {!providerVerified && (
                    <p className='arctic-provider-unknown-status' role='status'>{providerChecksNeedAttention ? 'One or more saved provider checks need attention. The router evaluates each route when you send.' : 'A saved key has not been checked this session. The router will authorize each send.'}</p>
                  )}
                  <img className='arctic-hero-mark' src='/prismatix-arctic-mark.svg' alt='' />
                  <h2 className="empty-state-hero-title">What can I help you with?</h2>
                  <p>Ask anything. Prismatix chooses a suitable model automatically, or let you choose the workflow.</p>
                  <div className='empty-state-capabilities'>
                {CAPABILITY_PILLARS.map((card) => (
                  <button
                    key={card.title}
                    type='button'
                    className='capability-card'
                    onClick={() => handleCapabilityCardClick(card)}
                  >
                    <div className='capability-card-header'>
                      <span className='capability-card-icon' aria-hidden='true'>
                        {card.title === 'Build an app' ? <svg viewBox='0 0 24 24'><path d='m8 5-6 7 6 7M16 5l6 7-6 7' /></svg>
                          : card.title === 'Analyze a file' ? <svg viewBox='0 0 24 24'><path d='M6 2h9l5 5v15H6zM15 2v6h5M9 13h8M9 17h8' /></svg>
                            : card.title === 'Compare ideas' ? <svg viewBox='0 0 24 24'><path d='M12 3v17M5 6h14M5 6l-3 7h6L5 6Zm14 0-3 7h6l-3-7ZM8 20h8' /></svg>
                              : <svg viewBox='0 0 24 24'><path d='M3 5.5A2.5 2.5 0 0 1 5.5 3h8A2.5 2.5 0 0 1 16 5.5v5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3v-4.3A2.5 2.5 0 0 1 3 9.5v-4ZM8 16.5A2.5 2.5 0 0 0 10.5 19H16l4 3v-4.3a2.5 2.5 0 0 0 1-2.2v-4A2.5 2.5 0 0 0 18.5 9H18' /></svg>}
                      </span>
                      <span className='capability-card-title'>{card.title}</span>
                    </div>
                    <p className='capability-card-desc'>{card.description}</p>
                    <span className='capability-card-action'>{card.isUpload ? 'Choose a file →' : 'Prepare a draft →'}</span>
                  </button>
                ))}
                  </div>
                </>
              )}
            </div>
          )
          : (
            <div className='messages-list'>
              {conversationLoadError && (
                <div className='conversation-load-error-banner' role='alert'>
                  <span>{conversationLoadError}</span>
                  <button
                    type='button'
                    className='conversation-load-retry-btn'
                    onClick={() => selectedConversationId && void openConversation(selectedConversationId)}
                  >
                    Retry
                  </button>
                </div>
              )}
              {hasEarlierMessages && (
                <div className='earlier-messages-pagination'>
                  <button
                    type='button'
                    className='load-earlier-messages-btn'
                    disabled={isLoadingEarlierMessages}
                    onClick={handleLoadEarlierMessages}
                  >
                    {isLoadingEarlierMessages ? 'Loading earlier messages…' : 'Load earlier messages'}
                  </button>
                </div>
              )}
              {earlierMessagesError && (
                <div className='earlier-messages-error' role='alert'>
                  <span>{earlierMessagesError}</span>
                  <button
                    type='button'
                    className='earlier-messages-retry-btn'
                    onClick={handleLoadEarlierMessages}
                  >
                    Retry
                  </button>
                </div>
              )}
              {contextExcludedCount > 0 && (
                <div className='context-exclusion-boundary' role='note'>
                  <span>— {contextExcludedCount} older message{contextExcludedCount > 1 ? 's are' : ' is'} preserved in history but excluded from active LLM context —</span>
                </div>
              )}
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
                    onBranch={handleBranch}
                    onSelectComparisonPreference={handleSelectComparisonPreference}
                    onOpenArtifact={handleOpenArtifact}
                  />
                );
              })}
              <CostEstimator
                model={costModel}
                usage={currentUsage}
                isVisible={showCostEstimator && !showProviderSettings}
                isStreaming={isStreaming}
                totalCost={sessionCostTotal}
                finalCostUsd={finalMessageCost}
                routerPricingVersion={routerPricingVersion}
                onInteractionStart={clearCostEstimatorHideTimer}
                onInteractionEnd={() => scheduleCostEstimatorHide(3000)}
                panelRef={costEstimatorPanelRef}
                detailsButtonRef={costEstimatorDetailsButtonRef}
                compactViewportHeight={compactCostReveal?.viewportHeight ?? null}
              />
              <div ref={messagesEndRef} />
            </div>
          )}
        <ScrollToBottomButton
          visible={showScrollButton && messages.length > 0}
          isStreaming={isStreaming}
          onClick={handleScrollToBottom}
        />
      </main>

      {/* Action Notice (Shared Quality Requirement) */}
      {actionNotice && (
        <div className={`action-notice-toast ${actionNotice.type}`} role='status'>
          <span>{actionNotice.message}</span>
          <button type='button' onClick={() => setActionNotice(null)} aria-label='Dismiss notice'>
            ✕
          </button>
        </div>
      )}

      {/* F02 Lossless Draft Recovery Bar */}
      {failedTurnDraft && (
        <div className='draft-recovery-bar' role='alert'>
          <div className='draft-recovery-text'>
            <span className='draft-recovery-icon' aria-hidden='true'>⚠️</span>
            <span>{failedTurnDraft.restoredFromStorage ? 'Draft recovered. Check your chat history before sending again.' : `Send failed: ${failedTurnDraft.error || 'The request could not be completed.'}`} Draft text can survive a refresh in this tab when browser storage is available. Reattach files after refreshing.</span>
          </div>
          <div className='draft-recovery-actions'>
            <button
              type='button'
              className='draft-recovery-restore-btn'
              onClick={handleRestoreDraft}
            >
              Restore draft
            </button>
            <button
              type='button'
              className='draft-recovery-copy-btn'
              onClick={() => void handleCopyFailedDraft()}
            >
              Copy draft
            </button>
            {!failedTurnDraft.restoredFromStorage && <button
              type='button'
              className='draft-recovery-retry-btn'
              onClick={() => void handleRetryTurn()}
              disabled={isStreaming}
            >
              Retry
            </button>}
            <button
              type='button'
              className='draft-recovery-dismiss-btn'
              onClick={() => { setFailedTurnDraft(null); setShowDraftCopyFallback(false); }}
              aria-label='Dismiss recovery notice'
            >
              ✕
            </button>
          </div>
          {showDraftCopyFallback && (
            <label className='draft-copy-fallback'>Clipboard access failed. Select and copy the draft text manually.
              <textarea readOnly value={failedTurnDraft.rawInput} onFocus={(event) => event.currentTarget.select()} aria-label='Draft text to copy manually' />
              {failedTurnDraft.attachments.length > 0 && <span>Reattach these files separately: {failedTurnDraft.attachments.map((file) => file.name).join(', ')}</span>}
            </label>
          )}
        </div>
      )}

      {/* PR 3 Routing Intelligence Bar (F11, F12, F13) */}
      <div className='routing-intelligence-bar' role='toolbar' aria-label='Routing and research controls'>
        <div className='routing-controls-group'>
          <button
            type='button'
            className={`web-search-toggle-btn ${webSearchEnabled ? 'active' : ''}`}
            onClick={() => {
              userInteractedPrefsRef.current.webSearchEnabled = true;
              const next = !webSearchEnabled;
              setWebSearchEnabled(next);
              try {
                window.localStorage.setItem('prismatix_web_search_enabled', String(next));
              } catch {
                // Ignore storage write failure
              }
            }}
            title='Toggle web search augmentation (BYOK)'
            aria-pressed={webSearchEnabled}
          >
            <span>🌐</span>
            <span>Search web</span>
          </button>

          <button
            type='button'
            className={`web-search-toggle-btn ${comparisonMode ? 'active' : ''}`}
            onClick={() => {
              const next = !comparisonMode;
              setComparisonMode(next);
              if (next) setDebateSelection('off');
              try {
                window.localStorage.setItem('prismatix_comparison_mode', String(next));
              } catch {
                // Ignore storage write failure
              }
            }}
            title='Toggle side-by-side model comparison'
            aria-pressed={comparisonMode}
          >
            <span>⚖️</span>
            <span>Compare</span>
          </button>

          <button
            type='button'
            className={`web-search-toggle-btn ${researchMode ? 'active' : ''}`}
            onClick={() => {
              const next = !researchMode;
              setResearchMode(next);
              try {
                window.localStorage.setItem('prismatix_research_mode', String(next));
              } catch {
                // Ignore storage write failure
              }
            }}
            title='Toggle multi-source research workflow mode'
            aria-pressed={researchMode}
          >
            <span>🔬</span>
            <span>Research</span>
          </button>

          {comparisonMode && (
            <div className='routing-comparison-pair'>
              <select
                aria-label='Select comparison model A'
                value={comparisonModelA}
                onChange={(e) => setComparisonModelA(e.target.value as RouterModel)}
                className='routing-profile-select'
              >
                <option value='gemini-3.8-flash'>Gemini 3.8 Flash</option>
                <option value='gpt-6-sol'>GPT-6 Sol</option>
                <option value='deepseek-v4-pro'>DeepSeek V4 Pro</option>
                <option value='grok-4.6'>Grok 4.6</option>
                <option value='qwen-3.8-flash'>Qwen 3.8 Flash</option>
              </select>
              <span>vs</span>
              <select
                aria-label='Select comparison model B'
                value={comparisonModelB}
                onChange={(e) => setComparisonModelB(e.target.value as RouterModel)}
                className='routing-profile-select'
              >
                <option value='gpt-6-sol'>GPT-6 Sol</option>
                <option value='gemini-3.8-flash'>Gemini 3.8 Flash</option>
                <option value='deepseek-v4-pro'>DeepSeek V4 Pro</option>
                <option value='grok-4.6'>Grok 4.6</option>
                <option value='qwen-3.8-flash'>Qwen 3.8 Flash</option>
              </select>
            </div>
          )}
        </div>

        <div className='routing-controls-group'>
          <label className='routing-field' htmlFor='routing-profile-select'>
            <span>Profile</span>
          <select
            id='routing-profile-select'
            aria-label='Select routing profile'
            value={routingProfile}
            onChange={(e) => {
              userInteractedPrefsRef.current.routingProfile = true;
              const val = e.target.value as RoutingProfile;
              setRoutingProfile(val);
              try {
                window.localStorage.setItem('prismatix_routing_profile', val);
              } catch {
                // Ignore storage write failure
              }
            }}
            className='routing-profile-select'
          >
            <option value='balanced'>Balanced</option>
            <option value='economy'>Economy</option>
            <option value='capability'>Capability</option>
          </select>
          </label>

          <label className='routing-field' htmlFor='spend-cap-select'>
            <span>Cap</span>
          <select
            id='spend-cap-select'
            aria-label='Select per-turn spend cap'
            value={spendCapSelectValue(maxSpendCap)}
            onChange={(e) => {
              userInteractedPrefsRef.current.maxSpendCap = true;
              const val = e.target.value === 'none' ? null : Number(e.target.value);
              setMaxSpendCap(val);
              try {
                if (val === null) window.localStorage.removeItem('prismatix_max_spend_cap');
                else window.localStorage.setItem('prismatix_max_spend_cap', String(val));
              } catch {
                // Ignore storage write failure
              }
            }}
            className='spend-cap-select'
          >
            <option value='none'>No Cap</option>
            <option value='0.01'>$0.01</option>
            <option value='0.05'>$0.05</option>
            <option value='0.10'>$0.10</option>
            <option value='0.25'>$0.25</option>
          </select>
          </label>
        </div>
      </div>

      {/* Saved chats need the same provider readiness and recovery controls as New Chat. */}
      {messages.length > 0 && providerPlugins.loading && (
        <div className='provider-readiness-banner' role='status'>Checking provider setup…</div>
      )}
      {messages.length > 0 && providerPlugins.error && (
        <div className='provider-readiness-banner' role='alert'>
          <span>Could not check provider setup. Sending is paused and your draft is preserved.</span>
          <button type='button' onClick={() => void providerPlugins.refresh()}>Retry check</button>
          <button type='button' onClick={() => setShowProviderSettings(true)}>Provider Settings</button>
        </div>
      )}
      {messages.length > 0 && !providerPlugins.loading && !providerPlugins.error && !providerPlugins.isConfigured && (
        <div className='provider-readiness-banner' role='alert'>
          <span>Connect or enable a provider to send. Your draft is preserved.</span>
          <button type='button' onClick={() => setShowProviderSettings(true)}>Connect a provider</button>
        </div>
      )}
      {messages.length > 0 && !providerPlugins.loading && !providerPlugins.error && providerPlugins.isConfigured && !providerVerified && (
        <div className='provider-readiness-banner' role={providerVerificationRequiresAction ? 'alert' : 'status'}>
          <span>{routeRecoveryApplies ? 'The router recently rejected this route. Verify or update its provider before retrying it.' : providerVerificationRequiresAction ? providerPlugins.verificationLoading ? 'Provider verification is in progress. Sending is paused.' : 'A recent first-run check could not confirm this key. Verify or update it before sending.' : providerChecksNeedAttention ? 'One or more provider keys need attention. The router evaluates each route when you send.' : 'Saved provider keys have not been checked this session. The router will authorize each send.'}</span>
          {providerVerificationRequiresAction && <button type='button' disabled={providerPlugins.verificationLoading} onClick={() => void handleVerifyProviders()}>{providerPlugins.verificationLoading ? 'Verifying…' : 'Verify provider keys'}</button>}
          <button type='button' onClick={() => setShowProviderSettings(true)}>Provider Settings</button>
        </div>
      )}

      {/* Input Area */}
      <ChatInputComposer
        input={input}
        inputRef={inputRef}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onSend={() => void handleSend()}
        onStop={handleStop}
        isStreaming={isStreaming}
        isSendPending={isSendPending}
        isWaitingFirstToken={isWaitingFirstToken}
        sendBlockedReason={sendBlockedReason}
        sendBlockedTitles={SEND_BLOCKED_TITLES}
        hasPendingVideoUploads={hasPendingVideoUploads}
        draftAttachments={draftAttachments}
        onRemoveAttachment={removeAttachment}
        onClearAllAttachments={clearAllAttachments}
        onFileSelect={handleFileSelect}
        onMultipleFiles={handleMultipleFiles}
        onFilePickerReady={registerFilePicker}
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
        providerSetupBlocked={messages.length === 0 && !providerCanAttemptRouterSend}
        providerSetupVerifyAvailable={messages.length === 0 && Boolean(failedTurnDraft) && providerPlugins.isConfigured && !providerPlugins.loading && !providerPlugins.error && !providerVerified}
        onVerifyProviderKeys={() => void handleVerifyProviders()}
        onOpenPromptLibrary={() => setIsPromptLibraryOpen(true)}
        onOpenUrlIngestion={() => setIsUrlModalOpen(true)}
        onOpenDocComparison={() => setIsDocComparisonModalOpen(true)}
        onOpenImageGen={() => setIsImageGenModalOpen(true)}
        isRecordingVoice={isRecordingVoice}
        onToggleVoiceDictation={handleToggleVoiceDictation}
      />

      <BudgetGuard
        isOpen={!!budgetConfirm}
        estimateUsd={budgetConfirm?.estimateUsd || 0}
        dailyTotalUsd={budgetConfirm?.dailyTotalUsd || 0}
        dailyLimitUsd={DAILY_BUDGET_LIMIT_USD}
        onCancel={handleBudgetCancel}
        onConfirm={handleBudgetConfirmSend}
      />

      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={handleCloseShortcuts}
      />

      <GlobalSearchModal
        client={supabase}
        isOpen={isGlobalSearchOpen}
        onClose={() => setIsGlobalSearchOpen(false)}
        onSelectResult={handleSelectSearchResult}
      />

      <ProjectModal
        client={supabase}
        isOpen={isProjectModalOpen}
        initialProject={editingProject}
        onClose={() => {
          setIsProjectModalOpen(false);
          setEditingProject(null);
        }}
        onSaved={(saved) => {
          setProjects((prev) => {
            const idx = prev.findIndex((p) => p.id === saved.id);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = saved;
              return copy;
            }
            return [saved, ...prev];
          });
          setActiveProjectId(saved.id);
        }}
      />

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        currentConversation={currentConversationForExport}
        onFetchAllConversations={handleFetchAllConversations}
      />

      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportComplete={() => {
          void refreshConversations();
        }}
      />

      <PromptLibraryModal
        isOpen={isPromptLibraryOpen}
        onClose={() => setIsPromptLibraryOpen(false)}
        activeProjectId={activeProjectId}
        onSelectPrompt={handleInsertPromptTemplate}
      />

      <UrlIngestionModal
        isOpen={isUrlModalOpen}
        onClose={() => setIsUrlModalOpen(false)}
        onInsertContent={(content) => {
          setInput((prev) => (prev ? `${prev}\n\n${content}` : content));
          inputRef.current?.focus();
        }}
      />

      <DocumentComparisonModal
        isOpen={isDocComparisonModalOpen}
        onClose={() => setIsDocComparisonModalOpen(false)}
        onInsertPrompt={(prompt) => {
          setInput(prompt);
          inputRef.current?.focus();
        }}
      />

      <ImageGenerationModal
        isOpen={isImageGenModalOpen}
        onClose={() => setIsImageGenModalOpen(false)}
        onImageGenerated={handleImageGenerated}
        initialPrompt={input}
        conversationId={selectedConversationIdRef.current || undefined}
        client={supabase}
        providerPlugins={providerPlugins}
        onOpenProviderSettings={() => setShowProviderSettings(true)}
      />

      <ArtifactViewerModal
        isOpen={isArtifactModalOpen}
        artifact={activeArtifact}
        onClose={() => setIsArtifactModalOpen(false)}
        onUpdateArtifact={async (updated) => {
          setActiveArtifact(updated);
          const convId = selectedConversationIdRef.current;
          if (convId && user) {
            // Persist revision via atomic RPC px29_save_artifact_revision
            // (Avoids duplicating revisions from double-saving)
            const revRes = await persistArtifactRevisionToDatabase(supabase, updated.id, updated.currentContent, 'user');
            if (!revRes.success || !revRes.data) {
              console.warn('[ChatInterface] Failed to persist artifact revision via px29:', revRes.error);
              setActionNotice({ type: 'error', message: `Failed to persist revision: ${revRes.error}` });
            } else {
              const row = revRes.data;
              const synced: Artifact = {
                id: row.id,
                title: row.title,
                language: row.language,
                currentContent: row.current_content,
                versions: Array.isArray(row.versions) ? row.versions : [],
                createdAt: row.created_at,
                updatedAt: row.updated_at,
              };
              setActiveArtifact(synced);
              setActionNotice({ type: 'success', message: 'Artifact revision saved successfully.' });
            }
          }
        }}
      />
      </div>
      <aside
        ref={routingPanelRef}
        className={`arctic-routing-panel ${routingPanelOpen ? 'is-open' : ''}`}
        id='arctic-routing-panel'
        aria-label='Routing details'
      >
        <div className='arctic-routing-card'>
        <div className='arctic-routing-heading'>
          <span aria-hidden='true'>✦</span>
          <h2>Routing details</h2>
          <button type='button' className='arctic-routing-close' onClick={() => { setRoutingPanelOpen(false); routingToggleRef.current?.focus(); }} aria-label='Close routing details'>×</button>
        </div>
        <div className={`arctic-route-status ${isStreaming ? 'running' : providerPlugins.loading || providerPlugins.verificationLoading ? 'checking' : providerPlugins.error || !providerPlugins.isConfigured || providerVerificationRequiresAction || !providerVerified ? 'setup' : 'ready'}`} role='status'>
          <span className='arctic-status-icon' aria-hidden='true'>{isStreaming ? '◌' : providerPlugins.loading || providerPlugins.verificationLoading ? '…' : providerPlugins.error || !providerPlugins.isConfigured || providerVerificationRequiresAction || !providerVerified ? '!' : '✓'}</span>
          <span><small>Route status</small><strong>{isStreaming ? 'Request in progress' : providerPlugins.loading ? 'Checking provider setup' : providerPlugins.error ? 'Provider status unavailable' : !providerPlugins.isConfigured ? providerPlugins.verificationStatus === 'invalid' || providerPlugins.providers.some((provider) => provider.status === 'invalid_revoked') ? 'Saved key rejected' : 'Connect a provider' : routeRecoveryApplies ? 'This route needs verification' : providerVerificationRequiresAction ? providerPlugins.verificationStatus === 'invalid' || providerPlugins.providers.some((provider) => provider.status === 'invalid_revoked') ? 'Saved key rejected' : providerPlugins.verificationStatus === 'unavailable' || providerPlugins.providers.some((provider) => provider.status === 'unavailable') ? 'Verification unavailable' : 'Verification required' : providerChecksNeedAttention ? 'A provider key needs attention' : !providerVerified ? 'Key saved · not checked this session' : 'Provider verified · route ready'}</strong></span>
        </div>
        <section className='arctic-route-field'>
          <h3>Selected model</h3>
          <p>{workspaceMode === 'compare'
            ? 'Two selected models'
            : manualModelOverride ? getCatalogEntry(manualModelOverride).shortName : messages.length ? getCatalogEntry(currentModel).shortName : 'Not chosen yet'}</p>
          {workspaceMode === 'compare' && <small>A · {getCatalogEntry(comparisonModelA).shortName}<br />B · {getCatalogEntry(comparisonModelB).shortName}</small>}
        </section>
        <section className='arctic-route-field'>
          <h3>Why?</h3>
          <p>{workspaceMode === 'compare'
            ? 'Each selected model receives the same prompt independently. The estimate includes both requests.'
            : workspaceMode === 'debate'
              ? debateSelection === 'auto'
                ? 'Debate is set to auto; Prismatix can activate it for a high-complexity request.'
                : `Debate is enabled with the ${debateSelection} profile.`
              : manualModelOverride
            ? `You selected ${getCatalogEntry(manualModelOverride).shortName} manually.`
              : providerPlugins.isConfigured && providerVerified
              ? 'Prismatix selects a model after you enter a request, based on task complexity, available providers, and attachments.'
                : providerPlugins.isConfigured
                  ? routeRecoveryApplies
                    ? 'The router rejected this route recently. Verify or update its provider before retrying it.'
                    : providerVerificationRequiresAction
                      ? 'Verify the saved provider key before sending this first-run request.'
                      : providerChecksNeedAttention
                        ? 'Some saved provider checks need attention. The router determines which provider can handle each request.'
                        : 'The saved key has not been checked this session. The router authorizes each request.'
                  : 'Connect an AI provider before sending a request.'}</p>
        </section>
        <section className='arctic-route-field'>
          <h3>Estimated cost</h3>
          <p>{routingCostLabel}</p>
        </section>
        <details className='arctic-route-accordion'>
          <summary>Model options</summary>
          {workspaceMode === 'compare' && <div className='arctic-comparison-models'>
            <label htmlFor='arctic-model-a'>Model A</label>
            <select id='arctic-model-a' value={comparisonModelA} onChange={(event) => setComparisonModelA(event.target.value as RouterModel)}>
              <option value='gemini-3.8-flash'>Gemini 3.8 Flash</option>
              <option value='gpt-6-sol'>GPT-6 Sol</option>
              <option value='deepseek-v4-pro'>DeepSeek V4 Pro</option>
              <option value='grok-4.6'>Grok 4.6</option>
              <option value='qwen-3.8-flash'>Qwen 3.8 Flash</option>
            </select>
            <label htmlFor='arctic-model-b'>Model B</label>
            <select id='arctic-model-b' value={comparisonModelB} onChange={(event) => setComparisonModelB(event.target.value as RouterModel)}>
              <option value='gpt-6-sol'>GPT-6 Sol</option>
              <option value='gemini-3.8-flash'>Gemini 3.8 Flash</option>
              <option value='deepseek-v4-pro'>DeepSeek V4 Pro</option>
              <option value='grok-4.6'>Grok 4.6</option>
              <option value='qwen-3.8-flash'>Qwen 3.8 Flash</option>
            </select>
          </div>}
          <button type='button' onClick={() => { setRoutingPanelOpen(false); document.querySelector<HTMLButtonElement>('.composer-model-pill')?.click(); }}>Choose a model or routing profile</button>
          <button type='button' onClick={() => { setShowProviderSettings(true); setRoutingPanelOpen(false); }}>Provider settings</button>
          <button type='button' onClick={() => { setShowMemorySettings(true); setRoutingPanelOpen(false); }}>Memory settings</button>
          <button type='button' onClick={() => { setIsShortcutsOpen(true); setRoutingPanelOpen(false); }}>Keyboard shortcuts</button>
          {canInstallPwa && <button type='button' onClick={() => { setRoutingPanelOpen(false); void handleInstallPwa(); }}>Install Prismatix</button>}
        <details className='arctic-route-accordion arctic-route-nested'>
          <summary>Routing profile &amp; tools</summary>
          <label htmlFor='arctic-routing-profile'>Routing profile</label>
          <select
            id='arctic-routing-profile'
            value={routingProfile}
            onChange={(event) => {
              userInteractedPrefsRef.current.routingProfile = true;
              const value = event.target.value as RoutingProfile;
              setRoutingProfile(value);
              try { window.localStorage.setItem('prismatix_routing_profile', value); } catch { /* optional persistence */ }
            }}
          >
            <option value='balanced'>Balanced</option>
            <option value='economy'>Economy</option>
            <option value='capability'>Capability</option>
          </select>
          <label htmlFor='arctic-spend-cap'>Per-turn spend cap</label>
          <small className='routing-spend-cap-note'>Compare checks the estimated combined cost before sending. The router enforces this cap per request, so the two request totals are not covered by one shared server cap.</small>
          <select
            id='arctic-spend-cap'
            value={spendCapSelectValue(maxSpendCap)}
            onChange={(event) => {
              userInteractedPrefsRef.current.maxSpendCap = true;
              const value = event.target.value === 'none' ? null : Number(event.target.value);
              setMaxSpendCap(value);
              try {
                if (value === null) window.localStorage.removeItem('prismatix_max_spend_cap');
                else window.localStorage.setItem('prismatix_max_spend_cap', String(value));
              } catch { /* optional persistence */ }
            }}
          >
            <option value='none'>No cap</option>
            <option value='0.01'>$0.01</option>
            <option value='0.05'>$0.05</option>
            <option value='0.10'>$0.10</option>
            <option value='0.25'>$0.25</option>
          </select>
          <label className='arctic-route-check'><input type='checkbox' checked={webSearchEnabled} onChange={(event) => {
            userInteractedPrefsRef.current.webSearchEnabled = true;
            setWebSearchEnabled(event.target.checked);
            try { window.localStorage.setItem('prismatix_web_search_enabled', String(event.target.checked)); } catch { /* optional persistence */ }
          }} /> Search web (BYOK)</label>
          <label className='arctic-route-check'><input type='checkbox' checked={researchMode} onChange={(event) => {
            setResearchMode(event.target.checked);
            try { window.localStorage.setItem('prismatix_research_mode', String(event.target.checked)); } catch { /* optional persistence */ }
          }} /> Multi-source research</label>
          {contextStatus && <details className='arctic-context-details'>
            <summary>Conversation context</summary>
            <ContextStatus contextStatus={contextStatus} />
          </details>}
        </details>
        </details>
        <details className='arctic-route-accordion'>
          <summary>Debate mode</summary>
          <label htmlFor='arctic-debate-profile'>Debate profile</label>
          <select
            id='arctic-debate-profile'
            value={debateSelection}
            onChange={(event) => {
              const selection = event.target.value as DebateSelection;
              setDebateSelection(selection);
              if (selection !== 'off') {
                setComparisonMode(false);
                try { window.localStorage.setItem('prismatix_comparison_mode', 'false'); } catch { /* optional persistence */ }
              }
            }}
          >
            <option value='off'>Off</option>
            <option value='auto'>Auto (high complexity)</option>
            <option value='general'>General</option>
            <option value='code'>Code</option>
            <option value='video_ui'>Video UI</option>
          </select>
        </details>

        </div>
      </aside>
    </div>
  );
};
