// router_logic.ts - Pure routing + message transform logic (no Deno.serve side effects)

import { CURATED_ROUTE_POLICY, type Gateway, type RouteRole, resolveRoleCandidates } from './models_hub.ts';
import { getPricingForModel } from './pricing_registry.ts';

export type Provider = 'opencode' | 'anthropic' | 'openai' | 'google' | 'nvidia' | 'deepinfra';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  imageData?: string;
  mediaType?: string;
}

export interface ImageAttachment {
  data: string;
  mediaType: string;
}

export interface RouterParams {
  userQuery: string;
  currentSessionTokens: number;
  platform: 'web' | 'mobile';
  history: Message[];
  images?: ImageAttachment[];
  hasVideoAssets?: boolean;
}

export interface ModelConfig {
  provider: Provider;
  modelId: string;
  budgetCap: number;
  supportsImages: boolean;
}

export const MODEL_REGISTRY: Record<string, ModelConfig> = {
  // OpenCode Curated Models
  'deepseek-v4-flash': {
    provider: 'opencode',
    modelId: 'deepseek-v4-flash',
    budgetCap: 8192,
    supportsImages: false,
  },
  'deepseek-v4-flash-free': {
    provider: 'opencode',
    modelId: 'deepseek-v4-flash-free',
    budgetCap: 8192,
    supportsImages: false,
  },
  'deepseek-v4-pro': {
    provider: 'opencode',
    modelId: 'deepseek-v4-pro',
    budgetCap: 16384,
    supportsImages: false,
  },
  'gpt-5.6-luna': {
    provider: 'opencode',
    modelId: 'gpt-5.6-luna',
    budgetCap: 8192,
    supportsImages: true,
  },
  'gpt-5.6-terra': {
    provider: 'opencode',
    modelId: 'gpt-5.6-terra',
    budgetCap: 16384,
    supportsImages: true,
  },
  'gpt-5.6-sol': {
    provider: 'opencode',
    modelId: 'gpt-5.6-sol',
    budgetCap: 32768,
    supportsImages: true,
  },
  'claude-sonnet-5': {
    provider: 'opencode',
    modelId: 'claude-sonnet-5',
    budgetCap: 16384,
    supportsImages: true,
  },
  'claude-opus-5': {
    provider: 'opencode',
    modelId: 'claude-opus-5',
    budgetCap: 16384,
    supportsImages: true,
  },
  'claude-haiku-4-5': {
    provider: 'opencode',
    modelId: 'claude-haiku-4-5',
    budgetCap: 8192,
    supportsImages: true,
  },
  'gemini-3.7-flash': {
    provider: 'opencode',
    modelId: 'gemini-3.7-flash',
    budgetCap: 8192,
    supportsImages: true,
  },
  'grok-4.6': {
    provider: 'opencode',
    modelId: 'grok-4.6',
    budgetCap: 16384,
    supportsImages: true,
  },
  'gpt-6-sol': {
    provider: 'opencode',
    modelId: 'gpt-6-sol',
    budgetCap: 32768,
    supportsImages: true,
  },
  'gpt-6-luna': {
    provider: 'opencode',
    modelId: 'gpt-6-luna',
    budgetCap: 8192,
    supportsImages: true,
  },
  'claude-opus-5-5': {
    provider: 'opencode',
    modelId: 'claude-opus-5-5',
    budgetCap: 32768,
    supportsImages: true,
  },
  'claude-sonnet-5-5': {
    provider: 'opencode',
    modelId: 'claude-sonnet-5-5',
    budgetCap: 16384,
    supportsImages: true,
  },
  'gemini-3.8-flash': {
    provider: 'opencode',
    modelId: 'gemini-3.8-flash',
    budgetCap: 8192,
    supportsImages: true,
  },
  'deepseek-v4-1-flash': {
    provider: 'opencode',
    modelId: 'deepseek-v4-1-flash',
    budgetCap: 8192,
    supportsImages: true,
  },
  'mimo-v2.5-free': {
    provider: 'opencode',
    modelId: 'mimo-v2.5-free',
    budgetCap: 4096,
    supportsImages: false,
  },

  // Legacy direct fallback models
  'haiku-4.5': {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001',
    budgetCap: 4000,
    supportsImages: true,
  },
  'sonnet-4.6': {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    budgetCap: 8000,
    supportsImages: true,
  },
  'opus-4.6': {
    provider: 'anthropic',
    modelId: 'claude-opus-4-6',
    budgetCap: 16000,
    supportsImages: true,
  },
  'gemini-3-flash': {
    provider: 'google',
    modelId: 'gemini-3-flash-preview',
    budgetCap: 8192,
    supportsImages: true,
  },
  'gemini-2.5-flash': {
    provider: 'google',
    modelId: 'gemini-2.5-flash',
    budgetCap: 8192,
    supportsImages: true,
  },
  'gemini-3.1-pro': {
    provider: 'google',
    modelId: 'gemini-3.1-pro-preview',
    budgetCap: 16384,
    supportsImages: true,
  },
};

export type AnthropicModel = 'opus-4.6' | 'sonnet-4.6' | 'haiku-4.5';
export type RouterModel = string;

// ---------------------------------------------------------------------------
// Image-modality guard (PX04)
//
// Routing must never send image attachments to a model that cannot see them,
// and must never silently downgrade/substitute a family to make the request
// fit. The guard reads the same `supportsImages` registry used for routing.
// Unknown routes fail CLOSED for images (they cannot be proven image-capable).
// ---------------------------------------------------------------------------

/** Typed failure raised when a request's modalities do not fit the route. */
export class ModalityMismatchError extends Error {
  readonly code = 'modality_mismatch';
  readonly model: string;

  constructor(model: string) {
    super(`Model '${model}' does not support the supplied modality (images).`);
    this.name = 'ModalityMismatchError';
    this.model = model;
  }
}

/** Whether the routing registry marks `model` as image-capable. */
export function routeSupportsImages(model: string): boolean {
  const config = MODEL_REGISTRY[model];
  if (!config) return false; // unknown route -> fail closed for images
  return config.supportsImages;
}

/**
 * Throws `ModalityMismatchError` when images are supplied to a route whose
 * registry entry has `supportsImages === false` (or is unknown).
 */
export function assertRouteSupportsModalities(
  model: string,
  modalities: { images?: boolean } = {},
): void {
  if (modalities.images && !routeSupportsImages(model)) {
    throw new ModalityMismatchError(model);
  }
}

export interface RoutingAnalysis {
  complexityScore: number;
  reasoningDifficulty: number;
  codeSignals: number;
  isCodeHeavy: boolean;
  multimodalLoad: number;
  contextTokens: number;
  textQueryTokens: number;
  imageAttachmentCount: number;
  hasImages: boolean;
  hasVideoAssets: boolean;
}

export interface RoutingDebugInfo {
  complexityScore: number;
  reasoningDifficulty: number;
  codeSignals: number;
  isCodeHeavy: boolean;
  multimodalLoad: number;
  contextTokens: number;
  textQueryTokens: number;
  imageAttachmentCount: number;
  hasImages: boolean;
  hasVideoAssets: boolean;
  routeStep: string;
  matchedBranch?: string;
}

export interface RouteDecision {
  provider: Provider;
  model: string;
  modelTier: RouterModel;
  routeRole?: RouteRole;
  budgetCap: number;
  rationaleTag: string;
  complexityScore: number;
  routingDebug: RoutingDebugInfo;
  /**
   * UI-safe explanation of how this model was chosen. Contains no secrets,
   * credentials, or internal headers — derived only from the routing decision.
   */
  explanation?: RouteExplanation;
}

export type RouteSelection = 'auto' | 'override';

/**
 * User-facing route-decision contract. Everything here is safe to expose to
 * the client: it answers which role/model/gateway was chosen, why, whether a
 * fallback was involved, and whether the price basis is known.
 */
export interface RouteExplanation {
  selection: RouteSelection;
  role?: RouteRole;
  modelTier: RouterModel;
  gateway: Gateway;
  /** Short human-readable reason for the choice. */
  reason: string;
  /** True when the route was reached via any fallback (role fallback or provider-unavailable re-route). */
  fallbackUsed: boolean;
  /** Candidates evaluated and skipped, as "modelId: reason" strings. */
  attemptedModels?: string[];
  /** False when the pricing registry has no known rate for this model. */
  priceKnown: boolean;
}

const OVERRIDE_SYNONYMS: Record<string, RouterModel> = {
  // OpenCode
  'deepseek-v4-flash': 'deepseek-v4-flash',
  'deepseek-v4-pro': 'deepseek-v4-pro',
  'gpt-5.6-luna': 'gpt-5.6-luna',
  'gpt-5.6-terra': 'gpt-5.6-terra',
  'gpt-5.6-sol': 'gpt-5.6-sol',
  'claude-sonnet-5': 'claude-sonnet-5',
  'claude-opus-5': 'claude-opus-5',
  'gemini-3.7-flash': 'gemini-3.7-flash',
  'gpt-6-sol': 'gpt-6-sol',
  'openai:gpt-6-sol': 'gpt-6-sol',
  'gpt-6-luna': 'gpt-6-luna',
  'openai:gpt-6-luna': 'gpt-6-luna',
  'claude-opus-5-5': 'claude-opus-5-5',
  'anthropic:opus-5-5': 'claude-opus-5-5',
  'claude-sonnet-5-5': 'claude-sonnet-5-5',
  'anthropic:sonnet-5-5': 'claude-sonnet-5-5',
  'gemini-3.8-flash': 'gemini-3.8-flash',
  'google:gemini-3.8-flash': 'gemini-3.8-flash',
  'deepseek-v4-1-flash': 'deepseek-v4-1-flash',
  // Anthropic
  'anthropic:haiku': 'haiku-4.5',
  'anthropic:haiku-4.5': 'haiku-4.5',
  'anthropic:sonnet': 'sonnet-4.6',
  'anthropic:sonnet-4.6': 'sonnet-4.6',
  'anthropic:opus': 'opus-4.6',
  'anthropic:opus-4.6': 'opus-4.6',
  // OpenAI
  // Google
  'google:gemini-3-flash': 'gemini-3-flash',
  'google:gemini-3.1-pro': 'gemini-3.1-pro',
  'google:gemini-2.5-flash': 'gemini-2.5-flash',
};

export function normalizeModelOverride(input?: string): RouterModel | undefined {
  if (!input) return undefined;
  const value = String(input).toLowerCase().trim();
  if (!value || value === 'auto') return undefined;

  if (value in MODEL_REGISTRY) {
    return value;
  }
  if (value in OVERRIDE_SYNONYMS) {
    return OVERRIDE_SYNONYMS[value];
  }
  return undefined;
}

const COMPLEXITY_INDICATORS = {
  opus: [
    'analyze',
    'research',
    'comprehensive',
    'detailed analysis',
    'compare and contrast',
    'evaluate',
    'synthesize',
    'critique',
    'design',
    'architect',
    'strategy',
    'in-depth',
    'thorough',
    'explain why',
    'reasoning',
    'implications',
    'trade-offs',
    'debug this',
    'review this code',
    'optimize',
    'refactor',
  ],
  quick: [
    'quick',
    'simple',
    'short',
    'brief',
    'yes or no',
    'what time',
    'how many',
    'define',
    'spell',
    'calculate',
  ],
};

const tokenCache = new Map<string, number>();

export function countTokens(text: string): number {
  if (!text) return 0;
  if (tokenCache.has(text)) return tokenCache.get(text)!;
  const count = Math.ceil(text.length / 4);
  if (tokenCache.size >= 100) {
    const firstKey = tokenCache.keys().next().value as string;
    tokenCache.delete(firstKey);
  }
  tokenCache.set(text, count);
  return count;
}

export function countImageTokens(images?: ImageAttachment[]): number {
  if (!images || images.length === 0) return 0;
  return images.length * 1600;
}

export function transformMessagesForAnthropic(
  messages: Message[],
  currentImages?: ImageAttachment[],
): Array<{ role: 'user' | 'assistant'; content: any }> {
  return messages.map((msg, index) => {
    const isLastMessage = index === messages.length - 1;
    if (isLastMessage && msg.role === 'user' && currentImages && currentImages.length > 0) {
      const contentArray: any[] = [];
      for (const img of currentImages) {
        contentArray.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType || 'image/jpeg',
            data: img.data,
          },
        });
      }
      contentArray.push({
        type: 'text',
        text: msg.content || 'Please analyze these images.',
      });
      return { role: msg.role, content: contentArray };
    }
    return { role: msg.role, content: msg.content || '' };
  });
}

export function transformMessagesForOpenAI(
  messages: Message[],
  currentImages?: ImageAttachment[],
): Array<{ role: 'user' | 'assistant'; content: any }> {
  return messages.map((msg, index) => {
    const isLastMessage = index === messages.length - 1;
    if (isLastMessage && msg.role === 'user' && currentImages && currentImages.length > 0) {
      const contentArray: any[] = [];
      for (const img of currentImages) {
        contentArray.push({
          type: 'image_url',
          image_url: {
            url: `data:${img.mediaType || 'image/jpeg'};base64,${img.data}`,
          },
        });
      }
      contentArray.push({
        type: 'text',
        text: msg.content || 'Please analyze these images.',
      });
      return { role: msg.role, content: contentArray };
    }
    return { role: msg.role, content: msg.content || '' };
  });
}

export function transformMessagesForGoogle(
  messages: Message[],
  currentImages?: ImageAttachment[],
): Array<{ role: 'user' | 'model'; parts: any[] }> {
  return messages.map((msg, index) => {
    const isLastMessage = index === messages.length - 1;
    const role = msg.role === 'assistant' ? 'model' : 'user';
    if (isLastMessage && msg.role === 'user' && currentImages && currentImages.length > 0) {
      const parts: any[] = [];
      for (const img of currentImages) {
        parts.push({
          inlineData: {
            mimeType: img.mediaType || 'image/jpeg',
            data: img.data,
          },
        });
      }
      parts.push({ text: msg.content || 'Please analyze these images.' });
      return { role, parts };
    }
    return {
      role,
      parts: [{ text: msg.content || '' }],
    };
  });
}

export const ROUTING_CODE_PATTERNS: RegExp[] = [
  /```/,
  /\b(function|const|let|var|class|def|import|export|typescript|javascript|python|sql)\b/i,
  /[{}();[\]]/,
  /\b(error|bug|fix|debug|trace|stack|exception|compile|crash)\b/i,
];

export function countRoutingCodeSignals(query: string): number {
  let n = 0;
  for (const p of ROUTING_CODE_PATTERNS) {
    if (p.test(query)) n++;
  }
  return n;
}

export function analyzeRouting(params: RouterParams): RoutingAnalysis {
  const query = params.userQuery.toLowerCase();
  const textQueryTokens = countTokens(params.userQuery);
  const imageAttachmentCount = params.images?.length ?? 0;
  const imageTokenSurcharge = countImageTokens(params.images);
  const contextTokens = params.currentSessionTokens + textQueryTokens + imageTokenSurcharge;
  const hasImages = imageAttachmentCount > 0;
  const hasVideoAssets = params.hasVideoAssets === true;
  const multimodalLoad = imageAttachmentCount + (hasVideoAssets ? 3 : 0);

  let score = 35;
  if (textQueryTokens < 20) score -= 20;
  else if (textQueryTokens < 50) score -= 10;
  else if (textQueryTokens > 500) score += 15;
  else if (textQueryTokens > 200) score += 10;

  for (const keyword of COMPLEXITY_INDICATORS.opus) {
    if (query.includes(keyword)) score += 4;
  }
  for (const keyword of COMPLEXITY_INDICATORS.quick) {
    if (query.includes(keyword)) {
      score -= 6;
      if (score < 15) break;
    }
  }

  const questionWords =
    (query.match(/\b(why|how|what if|could|would|should|compare|versus|vs)\b/g) || []).length;
  if (questionWords >= 3) score += 15;
  else if (questionWords >= 2) score += 8;

  if (query.includes(' and ') && query.includes('?')) score += 10;

  const codeSignals = countRoutingCodeSignals(params.userQuery);
  if (codeSignals >= 3) score += 15;
  else if (codeSignals >= 2) score += 10;

  if (contextTokens > 100000) score += 10;
  else if (contextTokens > 50000) score += 5;

  if (/\b(json|list|bullet|table|csv)\b/i.test(query) && textQueryTokens < 100) {
    score -= 10;
  }

  if (/\b(write|story|poem|essay|blog|article|creative|fiction)\b/i.test(query)) {
    if (score < 35) score = 35;
    if (score > 70) score = 65;
  }

  const reasoningDifficulty = Math.max(0, Math.min(100, score));
  const multimodalBump = Math.min(8, multimodalLoad * 2);
  const complexityScore = Math.max(0, Math.min(100, reasoningDifficulty + multimodalBump));
  const isCodeHeavy = codeSignals >= 2;

  return {
    complexityScore,
    reasoningDifficulty,
    codeSignals,
    isCodeHeavy,
    multimodalLoad,
    contextTokens,
    textQueryTokens,
    imageAttachmentCount,
    hasImages,
    hasVideoAssets,
  };
}

export function createStubRoutingDebug(
  complexityScore: number,
  matchedBranch: string,
): RoutingDebugInfo {
  return {
    complexityScore,
    reasoningDifficulty: complexityScore,
    codeSignals: 0,
    isCodeHeavy: false,
    multimodalLoad: 0,
    contextTokens: 0,
    textQueryTokens: 0,
    imageAttachmentCount: 0,
    hasImages: false,
    hasVideoAssets: false,
    routeStep: 'synthetic',
    matchedBranch,
  };
}

function buildDecision(
  modelTier: RouterModel,
  rationaleTag: string,
  analysis: RoutingAnalysis,
  meta: {
    routeStep: string;
    matchedBranch?: string;
    routeRole?: RouteRole;
    explanation?: RouteExplanation;
  },
): RouteDecision {
  const config = MODEL_REGISTRY[modelTier] || {
    provider: 'opencode' as Provider,
    modelId: modelTier,
    budgetCap: 8192,
    supportsImages: true,
  };
  const routingDebug: RoutingDebugInfo = {
    complexityScore: analysis.complexityScore,
    reasoningDifficulty: analysis.reasoningDifficulty,
    codeSignals: analysis.codeSignals,
    isCodeHeavy: analysis.isCodeHeavy,
    multimodalLoad: analysis.multimodalLoad,
    contextTokens: analysis.contextTokens,
    textQueryTokens: analysis.textQueryTokens,
    imageAttachmentCount: analysis.imageAttachmentCount,
    hasImages: analysis.hasImages,
    hasVideoAssets: analysis.hasVideoAssets,
    matchedBranch: meta.matchedBranch ?? rationaleTag,
    routeStep: meta.routeStep,
  };
  return {
    provider: config.provider,
    model: config.modelId,
    modelTier,
    routeRole: meta.routeRole,
    budgetCap: config.budgetCap,
    rationaleTag,
    complexityScore: analysis.complexityScore,
    routingDebug,
    explanation: meta.explanation,
  };
}

function priceIsKnown(modelTier: RouterModel): boolean {
  return !getPricingForModel(modelTier).isUnknown;
}

export function determineRouteRole(params: RouterParams): RouteRole {
  const analysis = analyzeRouting(params);
  const {
    complexityScore: c,
    reasoningDifficulty: rd,
    isCodeHeavy,
    contextTokens,
    hasImages,
    hasVideoAssets,
  } = analysis;

  if (hasVideoAssets) return 'vision_strong';
  if (hasImages) return c >= 75 ? 'vision_strong' : 'vision_fast';
  if (rd >= 90 || (contextTokens > 120000 && rd >= 70)) return 'max';
  if (isCodeHeavy && c >= 50) return 'code_review';
  if (c >= 81) return 'strong';
  if (c >= 66) return 'balanced';
  if (c >= 46) return 'fast';
  return 'economy';
}

export function determineRoute(
  params: RouterParams,
  modelOverride?: RouterModel,
  openCodePrimary: boolean = true,
  discoveredModelIds?: Set<string>,
): RouteDecision {
  const analysis = analyzeRouting(params);

  if (modelOverride && MODEL_REGISTRY[modelOverride]) {
    return buildDecision(modelOverride, 'manual-override', analysis, {
      routeStep: 'manual-override',
      explanation: {
        selection: 'override',
        modelTier: modelOverride,
        gateway: MODEL_REGISTRY[modelOverride].provider === 'opencode' ? 'opencode' : 'direct_fallback',
        reason: `Manually selected model '${modelOverride}'.`,
        fallbackUsed: false,
        priceKnown: priceIsKnown(modelOverride),
      },
    });
  }

  const role = determineRouteRole(params);

  if (openCodePrimary) {
    // Fail-closed cost safety: when OpenCode is the primary gateway, a routing
    // failure (discovery unavailable, empty, or no priced candidate for the
    // role) must NOT silently escalate into the legacy direct-provider chain.
    // The error propagates so the request fails deterministically and the user
    // is told why — never surprise-routed onto a more expensive provider.
    const resolution = resolveRoleCandidates(role, discoveredModelIds);
    return buildDecision(resolution.config.modelId, `opencode-${role}`, analysis, {
      routeStep: `opencode-${role}`,
      routeRole: role,
      explanation: {
        selection: 'auto',
        role,
        modelTier: resolution.config.modelId,
        gateway: 'opencode',
        reason: resolution.attempted.length === 0
          ? `Highest-ranked available model for role '${role}'.`
          : `Best available model for role '${role}' after skipping ${resolution.attempted.length} candidate(s).`,
        fallbackUsed: resolution.config.modelId !== CURATED_ROUTE_POLICY[role].primary,
        attemptedModels: resolution.attempted.map((a) => `${a.modelId}: ${a.reason}`),
        priceKnown: priceIsKnown(resolution.config.modelId),
      },
    });
  }

  // Legacy direct mode: reached only when the OpenCode gateway is explicitly
  // not primary (deployment posture without OpenCode credentials). Each role
  // keeps a deterministic, priced mapping; every route is flagged as a
  // gateway fallback so the UI can explain it.
  const { complexityScore: c, hasImages, hasVideoAssets } = analysis;
  if (hasVideoAssets) {
    return buildDecision('gemini-3.1-pro', 'video-default-pro', analysis, {
      routeStep: 'video-default-pro',
      routeRole: role,
      explanation: legacyExplanation(role, 'gemini-3.1-pro', 'Video assets require a vision-capable pro model.'),
    });
  }
  if (hasImages) {
    const tier = c >= 75 ? 'gemini-3.1-pro' : 'gemini-2.5-flash';
    return buildDecision(tier, 'images-fallback', analysis, {
      routeStep: 'images-fallback',
      routeRole: role,
      explanation: legacyExplanation(role, tier, `Images routed to a ${c >= 75 ? 'pro' : 'fast'} vision model.`),
    });
  }
  if (role === 'max') {
    return buildDecision('opus-4.6', 'opus-fallback', analysis, {
      routeStep: 'opus',
      routeRole: role,
      explanation: legacyExplanation(role, 'opus-4.6', 'Maximum-complexity queries map to the strongest legacy model.'),
    });
  }
  if (role === 'strong' || role === 'code_review') {
    return buildDecision('sonnet-4.6', 'sonnet-fallback', analysis, {
      routeStep: 'sonnet',
      routeRole: role,
      explanation: legacyExplanation(role, 'sonnet-4.6', 'Strong/code-review queries map to a strong legacy model.'),
    });
  }
  if (role === 'fast') {
    return buildDecision('gemini-2.5-flash', 'fast-fallback', analysis, {
      routeStep: 'fast',
      routeRole: role,
      explanation: legacyExplanation(role, 'gemini-2.5-flash', 'Fast queries map to a low-latency legacy model.'),
    });
  }
  if (role === 'balanced') {
    return buildDecision('gemini-3-flash', 'balanced-fallback', analysis, {
      routeStep: 'balanced',
      routeRole: role,
      explanation: legacyExplanation(role, 'gemini-3-flash', 'Balanced queries map to a mid-cost legacy model.'),
    });
  }
  return buildDecision('gemini-2.5-flash', 'economy-fallback', analysis, {
    routeStep: 'economy',
    routeRole: role,
    explanation: legacyExplanation(role, 'gemini-2.5-flash', 'Economy queries map to the cheapest legacy model.'),
  });
}

function legacyExplanation(role: RouteRole, modelTier: RouterModel, why: string): RouteExplanation {
  return {
    selection: 'auto',
    role,
    modelTier,
    gateway: 'direct_fallback',
    reason: `OpenCode gateway not primary; legacy role mapping used. ${why}`,
    fallbackUsed: true,
    priceKnown: priceIsKnown(modelTier),
  };
}
