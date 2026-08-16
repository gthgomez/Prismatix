// router_logic.ts - Pure routing + message transform logic (no Deno.serve side effects)

import { RouteRole, resolveModelForRole } from './models_hub.ts';

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
  'gpt-5.4-mini': {
    provider: 'openai',
    modelId: 'gpt-5.4-mini',
    budgetCap: 4096,
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
  'nemotron-3-super': {
    provider: 'nvidia',
    modelId: 'nvidia/nemotron-3-super-120b-a12b',
    budgetCap: 8192,
    supportsImages: false,
  },
  'llama-4-scout': {
    provider: 'deepinfra',
    modelId: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
    budgetCap: 4096,
    supportsImages: false,
  },
  'qwen3-235b': {
    provider: 'deepinfra',
    modelId: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
    budgetCap: 8192,
    supportsImages: false,
  },
  'llama-3.3-70b-turbo': {
    provider: 'deepinfra',
    modelId: 'meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo',
    budgetCap: 4096,
    supportsImages: false,
  },
  'mistral-small-24b': {
    provider: 'deepinfra',
    modelId: 'mistralai/Mistral-Small-24B-Instruct-2501',
    budgetCap: 4096,
    supportsImages: false,
  },
  'qwen3-32b': {
    provider: 'deepinfra',
    modelId: 'Qwen/Qwen3-32B',
    budgetCap: 8192,
    supportsImages: false,
  },
  'deepseek-v3': {
    provider: 'deepinfra',
    modelId: 'deepseek-ai/DeepSeek-V3-0324',
    budgetCap: 8192,
    supportsImages: false,
  },
  'glm-4.7-flash': {
    provider: 'deepinfra',
    modelId: 'THUDM/GLM-4.7-Flash',
    budgetCap: 4096,
    supportsImages: false,
  },
  'qwen3.5-4b': {
    provider: 'deepinfra',
    modelId: 'Qwen/Qwen3.5-4B',
    budgetCap: 4096,
    supportsImages: false,
  },
  'qwen3.5-9b': {
    provider: 'deepinfra',
    modelId: 'Qwen/Qwen3.5-9B',
    budgetCap: 4096,
    supportsImages: false,
  },
  'step-3.5-flash': {
    provider: 'deepinfra',
    modelId: 'stepfun-ai/Step-3.5-Flash',
    budgetCap: 4096,
    supportsImages: false,
  },
  'llama-3.1-8b-turbo': {
    provider: 'deepinfra',
    modelId: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    budgetCap: 4096,
    supportsImages: false,
  },
  'mistral-nemo': {
    provider: 'deepinfra',
    modelId: 'mistralai/Mistral-Nemo-Instruct-2407',
    budgetCap: 4096,
    supportsImages: false,
  },
  'nemotron-nano-30b': {
    provider: 'deepinfra',
    modelId: 'nvidia/Nemotron-4-Mini-Hindi-4B-Instruct',
    budgetCap: 4096,
    supportsImages: false,
  },
};

export type AnthropicModel = 'opus-4.6' | 'sonnet-4.6' | 'haiku-4.5';
export type RouterModel = string;

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
  // Anthropic
  'anthropic:haiku': 'haiku-4.5',
  'anthropic:haiku-4.5': 'haiku-4.5',
  'anthropic:sonnet': 'sonnet-4.6',
  'anthropic:sonnet-4.6': 'sonnet-4.6',
  'anthropic:opus': 'opus-4.6',
  'anthropic:opus-4.6': 'opus-4.6',
  // OpenAI
  'openai:gpt-5.4-mini': 'gpt-5.4-mini',
  'openai:gpt-5-mini': 'gpt-5.4-mini',
  'openai:gpt-mini': 'gpt-5.4-mini',
  'gpt-5-mini': 'gpt-5.4-mini',
  // Google
  'google:gemini-3-flash': 'gemini-3-flash',
  'google:gemini-3.1-pro': 'gemini-3.1-pro',
  'google:gemini-2.5-flash': 'gemini-2.5-flash',
  // DeepInfra
  'deepinfra:deepseek-v3': 'deepseek-v3',
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
  meta: { routeStep: string; matchedBranch?: string; routeRole?: RouteRole },
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
  };
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
  if (c >= 66) return 'fast';
  if (c >= 46) return 'balanced';
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
    });
  }

  const role = determineRouteRole(params);

  if (openCodePrimary) {
    try {
      const resolvedConfig = resolveModelForRole(role, discoveredModelIds);
      return buildDecision(resolvedConfig.modelId, `opencode-${role}`, analysis, {
        routeStep: `opencode-${role}`,
        routeRole: role,
      });
    } catch {
      // If resolution fails, fall through to legacy fallback
    }
  }

  // Legacy direct fallback logic
  const { complexityScore: c, hasImages, hasVideoAssets } = analysis;
  if (hasVideoAssets) {
    return buildDecision('gemini-3.1-pro', 'video-default-pro', analysis, {
      routeStep: 'video-default-pro',
      routeRole: role,
    });
  }
  if (hasImages) {
    const tier = c >= 75 ? 'gemini-3.1-pro' : 'gemini-2.5-flash';
    return buildDecision(tier, 'images-fallback', analysis, {
      routeStep: 'images-fallback',
      routeRole: role,
    });
  }
  if (role === 'max') {
    return buildDecision('opus-4.6', 'opus-fallback', analysis, {
      routeStep: 'opus',
      routeRole: role,
    });
  }
  if (role === 'strong' || role === 'code_review') {
    return buildDecision('sonnet-4.6', 'sonnet-fallback', analysis, {
      routeStep: 'sonnet',
      routeRole: role,
    });
  }
  if (role === 'fast') {
    return buildDecision('gemini-2.5-flash', 'fast-fallback', analysis, {
      routeStep: 'fast',
      routeRole: role,
    });
  }
  if (role === 'balanced') {
    return buildDecision('deepseek-v3', 'balanced-fallback', analysis, {
      routeStep: 'balanced',
      routeRole: role,
    });
  }
  return buildDecision('qwen3-235b', 'economy-fallback', analysis, {
    routeStep: 'economy',
    routeRole: role,
  });
}
