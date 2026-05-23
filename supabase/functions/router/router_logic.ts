// router_logic.ts - Pure routing + message transform logic (no Deno.serve side effects)

export type Provider = 'anthropic' | 'openai' | 'google' | 'nvidia' | 'deepinfra';

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

interface ModelConfig {
  provider: Provider;
  modelId: string;
  budgetCap: number;
  supportsImages: boolean;
}

export const MODEL_REGISTRY = {
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
  // DeepInfra — OpenAI-compatible endpoint
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
  // Debate-tier cheap DeepInfra challengers
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
    modelId: 'nvidia/NVIDIA-Nemotron-Nano-30B-A3B',
    budgetCap: 4096,
    supportsImages: false,
  },
} as const satisfies Record<string, ModelConfig>;

export type RouterModel = keyof typeof MODEL_REGISTRY;
export type ModelTier = RouterModel;

export interface RouteDecision {
  provider: Provider;
  model: string;
  modelTier: RouterModel;
  budgetCap: number;
  rationaleTag: string;
  complexityScore: number;
}

const OVERRIDE_SYNONYMS: Record<string, RouterModel> = {
  // Anthropic — current keys
  'anthropic:haiku': 'haiku-4.5',
  'anthropic:haiku-4.5': 'haiku-4.5',
  'anthropic:sonnet': 'sonnet-4.6',
  'anthropic:sonnet-4.6': 'sonnet-4.6',
  'anthropic:opus': 'opus-4.6',
  'anthropic:opus-4.6': 'opus-4.6',
  // Anthropic — backwards-compat (old keys)
  'anthropic:sonnet-4.5': 'sonnet-4.6',
  'sonnet-4.5': 'sonnet-4.6',
  'anthropic:opus-4.5': 'opus-4.6',
  'opus-4.5': 'opus-4.6',
  // OpenAI
  'openai:gpt-5.4-mini': 'gpt-5.4-mini',
  'openai:gpt-5-mini': 'gpt-5.4-mini',
  'openai:gpt-mini': 'gpt-5.4-mini',
  'gpt-5-mini': 'gpt-5.4-mini',
  // Google — current keys
  'google:gemini-3-flash': 'gemini-3-flash',
  'google:gemini-3.1-pro': 'gemini-3.1-pro',
  'google:gemini-2.5-flash': 'gemini-2.5-flash',
  // Google — backwards-compat
  'google:gemini-3-pro': 'gemini-3.1-pro',
  'gemini-3-pro': 'gemini-3.1-pro',
  // NVIDIA
  'nvidia:nemotron-3-super': 'nemotron-3-super',
  'nemotron-super': 'nemotron-3-super',
  // DeepInfra — original
  'deepinfra:llama-4-scout': 'llama-4-scout',
  'deepinfra:qwen3-235b': 'qwen3-235b',
  'llama-scout': 'llama-4-scout',
  'llama4-scout': 'llama-4-scout',
  'qwen3': 'qwen3-235b',
  'qwen-235b': 'qwen3-235b',
  // DeepInfra — cheap batch (added 2026-04-13)
  'deepinfra:llama-3.3-70b-turbo': 'llama-3.3-70b-turbo',
  'llama-3.3-70b': 'llama-3.3-70b-turbo',
  'deepinfra:mistral-small-24b': 'mistral-small-24b',
  'deepinfra:qwen3-32b': 'qwen3-32b',
  'deepinfra:deepseek-v3': 'deepseek-v3',
  // DeepInfra — debate-tier challengers (added 2026-04-13)
  'deepinfra:glm-4.7-flash': 'glm-4.7-flash',
  'glm-flash': 'glm-4.7-flash',
  'glm4-flash': 'glm-4.7-flash',
  'deepinfra:qwen3.5-4b': 'qwen3.5-4b',
  'qwen3.5-4b': 'qwen3.5-4b',
  'deepinfra:qwen3.5-9b': 'qwen3.5-9b',
  'qwen3.5-9b': 'qwen3.5-9b',
  'deepinfra:step-3.5-flash': 'step-3.5-flash',
  'step-flash': 'step-3.5-flash',
  'deepinfra:llama-3.1-8b-turbo': 'llama-3.1-8b-turbo',
  'llama-3.1-8b': 'llama-3.1-8b-turbo',
  'llama-8b': 'llama-3.1-8b-turbo',
  'deepinfra:mistral-nemo': 'mistral-nemo',
  'mistral-nemo': 'mistral-nemo',
  'deepinfra:nemotron-nano-30b': 'nemotron-nano-30b',
  'nemotron-nano': 'nemotron-nano-30b',
};

export function normalizeModelOverride(input?: string): RouterModel | undefined {
  if (!input) return undefined;
  const value = String(input).toLowerCase().trim();
  if (!value || value === 'auto') return undefined;

  if (value in MODEL_REGISTRY) {
    return value as RouterModel;
  }

  if (value in OVERRIDE_SYNONYMS) {
    return OVERRIDE_SYNONYMS[value];
  }

  if (value.includes('haiku')) return 'haiku-4.5';
  if (value.includes('sonnet')) return 'sonnet-4.6';
  if (value.includes('opus')) return 'opus-4.6';

  if (
    value.includes('gpt-5.4-mini') ||
    value.includes('gpt-5-mini') ||
    value.includes('gpt mini')
  ) return 'gpt-5.4-mini';

  if (
    value.includes('gemini-3-flash') ||
    value.includes('gemini 3 flash') ||
    value.includes('gemini flash')
  ) {
    return 'gemini-3-flash';
  }

  if (value.includes('gemini-2.5-flash')) {
    return 'gemini-2.5-flash';
  }

  if (
    value.includes('gemini-3.1-pro') ||
    value.includes('gemini-3-pro') ||
    value.includes('gemini 3 pro') ||
    value.includes('gemini pro')
  ) {
    return 'gemini-3.1-pro';
  }

  if (
    value.includes('nemotron-3-super') ||
    value.includes('nemotron super') ||
    value.includes('nemotron')
  ) {
    return 'nemotron-3-super';
  }

  if (value.includes('llama-4-scout') || value.includes('llama4') || value.includes('llama scout')) {
    return 'llama-4-scout';
  }

  if (value.includes('qwen3-235b') || value.includes('qwen3') || value.includes('qwen 235')) {
    return 'qwen3-235b';
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

  // ~4 chars per token is the standard tiktoken approximation and handles code well.
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

interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

type AnthropicContent = string | Array<AnthropicImageBlock | AnthropicTextBlock>;

export function transformMessagesForAnthropic(
  messages: Message[],
  currentImages?: ImageAttachment[],
): Array<{ role: 'user' | 'assistant'; content: AnthropicContent }> {
  return messages.map((msg, index) => {
    const isLastMessage = index === messages.length - 1;

    if (isLastMessage && msg.role === 'user' && currentImages && currentImages.length > 0) {
      const contentArray: Array<AnthropicImageBlock | AnthropicTextBlock> = [];

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

    if (msg.imageData) {
      return {
        role: msg.role,
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: msg.mediaType || 'image/jpeg',
              data: msg.imageData,
            },
          },
          {
            type: 'text',
            text: msg.content || 'Please analyze this image.',
          },
        ],
      };
    }

    return { role: msg.role, content: msg.content || '' };
  });
}

interface OpenAITextPart {
  type: 'text';
  text: string;
}

interface OpenAIImagePart {
  type: 'image_url';
  image_url: { url: string };
}

type OpenAIContent = string | Array<OpenAITextPart | OpenAIImagePart>;

export function transformMessagesForOpenAI(
  messages: Message[],
  currentImages?: ImageAttachment[],
): Array<{ role: 'user' | 'assistant'; content: OpenAIContent }> {
  return messages.map((msg, index) => {
    const isLastMessage = index === messages.length - 1;

    if (isLastMessage && msg.role === 'user' && currentImages && currentImages.length > 0) {
      const contentArray: Array<OpenAITextPart | OpenAIImagePart> = [
        { type: 'text', text: msg.content || 'Please analyze these images.' },
      ];

      for (const img of currentImages) {
        contentArray.push({
          type: 'image_url',
          image_url: {
            url: `data:${img.mediaType || 'image/jpeg'};base64,${img.data}`,
          },
        });
      }

      return { role: msg.role, content: contentArray };
    }

    if (msg.imageData) {
      return {
        role: msg.role,
        content: [
          { type: 'text', text: msg.content || 'Please analyze this image.' },
          {
            type: 'image_url',
            image_url: {
              url: `data:${msg.mediaType || 'image/jpeg'};base64,${msg.imageData}`,
            },
          },
        ],
      };
    }

    return { role: msg.role, content: msg.content || '' };
  });
}

interface GoogleInlineDataPart {
  inlineData: { mimeType: string; data: string };
}

interface GoogleTextPart {
  text: string;
}

type GooglePart = GoogleInlineDataPart | GoogleTextPart;

export function transformMessagesForGoogle(
  messages: Message[],
  currentImages?: ImageAttachment[],
): Array<{ role: 'user' | 'model'; parts: GooglePart[] }> {
  return messages.map((msg, index) => {
    const isLastMessage = index === messages.length - 1;
    const role = msg.role === 'assistant' ? 'model' : 'user';

    if (isLastMessage && msg.role === 'user' && currentImages && currentImages.length > 0) {
      const parts: GooglePart[] = [];
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

    if (msg.imageData) {
      return {
        role,
        parts: [
          {
            inlineData: {
              mimeType: msg.mediaType || 'image/jpeg',
              data: msg.imageData,
            },
          },
          {
            text: msg.content || 'Please analyze this image.',
          },
        ],
      };
    }

    return {
      role,
      parts: [{ text: msg.content || '' }],
    };
  });
}

function analyzeComplexity(params: RouterParams): number {
  let score = 50;
  const query = params.userQuery.toLowerCase();
  const queryTokens = countTokens(params.userQuery);
  const historyTokens = params.currentSessionTokens;

  if (queryTokens < 20) score -= 20;
  else if (queryTokens < 50) score -= 10;
  else if (queryTokens > 500) score += 15;
  else if (queryTokens > 200) score += 10;

  for (const keyword of COMPLEXITY_INDICATORS.opus) {
    if (query.includes(keyword)) {
      score += 5;
      if (score > 75) break;
    }
  }
  for (const keyword of COMPLEXITY_INDICATORS.quick) {
    if (query.includes(keyword)) {
      score -= 5;
      if (score < 25) break;
    }
  }

  const questionWords =
    (query.match(/\b(why|how|what if|could|would|should|compare|versus|vs)\b/g) || []).length;
  if (questionWords >= 3) score += 15;
  else if (questionWords >= 2) score += 8;

  if (query.includes(' and ') && query.includes('?')) score += 10;

  const codeIndicators = [
    /```/,
    /\b(function|const|let|var|class|def|import|export)\b/,
    /[{}[\]();]/,
    /\b(error|bug|fix|debug|crash|exception)\b/i,
  ];
  let codeSignals = 0;
  for (const pattern of codeIndicators) {
    if (pattern.test(params.userQuery)) codeSignals++;
  }
  if (codeSignals >= 3) score += 15;
  else if (codeSignals >= 2) score += 10;

  const totalTokens = historyTokens + queryTokens;
  if (totalTokens > 100000) score += 10;
  else if (totalTokens > 50000) score += 5;

  if (/\b(json|list|bullet|table|csv)\b/i.test(query) && queryTokens < 100) {
    score -= 10;
  }

  if (/\b(write|story|poem|essay|blog|article|creative|fiction)\b/i.test(query)) {
    if (score < 50) score = 50;
    if (score > 70) score = 65;
  }

  return Math.max(0, Math.min(100, score));
}

function buildDecision(
  modelTier: RouterModel,
  rationaleTag: string,
  complexityScore: number,
): RouteDecision {
  const config = MODEL_REGISTRY[modelTier];
  return {
    provider: config.provider,
    model: config.modelId,
    modelTier,
    budgetCap: config.budgetCap,
    rationaleTag,
    complexityScore,
  };
}

export function isAnthropicModel(modelTier: RouterModel): boolean {
  return MODEL_REGISTRY[modelTier].provider === 'anthropic';
}

function isCodeHeavyQuery(query: string): boolean {
  const codeIndicators = [
    /```/,
    /\b(function|const|let|var|class|def|import|export|typescript|javascript|python|sql)\b/i,
    /[{}[\]();]/,
    /\b(error|bug|fix|debug|trace|stack|exception|compile)\b/i,
  ];
  return codeIndicators.some((pattern) => pattern.test(query));
}

export function determineRoute(params: RouterParams, modelOverride?: RouterModel): RouteDecision {
  const hasImages = params.images && params.images.length > 0;
  const hasVideoAssets = params.hasVideoAssets === true;
  const complexityScore = analyzeComplexity(params);
  const queryTokens = countTokens(params.userQuery) + countImageTokens(params.images);
  const totalTokens = params.currentSessionTokens + queryTokens;
  const codeHeavy = isCodeHeavyQuery(params.userQuery);

  if (modelOverride && MODEL_REGISTRY[modelOverride]) {
    return buildDecision(modelOverride, 'manual-override', complexityScore);
  }

  if (hasVideoAssets) {
    return buildDecision('gemini-3.1-pro', 'video-default-pro', complexityScore);
  }

  if (hasImages) {
    if (complexityScore >= 70 || totalTokens > 60000) {
      return buildDecision('gemini-3.1-pro', 'images-complex', complexityScore);
    }
    if (complexityScore <= 30 && totalTokens < 30000) {
      return buildDecision('gemini-2.5-flash', 'images-fast', complexityScore);
    }
    return buildDecision('gemini-2.5-flash', 'images-default-flash', complexityScore);
  }

  if (codeHeavy && complexityScore >= 45 && totalTokens < 90000) {
    return buildDecision('sonnet-4.6', 'code-quality-priority', complexityScore);
  }

  if (complexityScore >= 80 || totalTokens > 100000) {
    return buildDecision('opus-4.6', 'high-complexity', complexityScore);
  }

  if (complexityScore <= 18 && queryTokens < 80 && totalTokens < 12000) {
    return buildDecision('gpt-5.4-mini', 'ultra-low-latency', complexityScore);
  }

  if (complexityScore <= 25 && queryTokens < 100 && totalTokens < 10000) {
    return buildDecision('haiku-4.5', 'low-complexity', complexityScore);
  }

  return buildDecision('gemini-2.5-flash', 'default-cost-optimized', complexityScore);
}
