// models_hub.ts
// Multi-plane model hub abstractions: Gateway, Protocol, Family, Role, and Curated Policy.

export type Gateway = 'opencode' | 'direct_fallback';

export type ModelProtocol =
  | 'openai-responses'
  | 'openai-chat'
  | 'anthropic-messages'
  | 'gemini';

export type ModelFamily =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'deepseek'
  | 'qwen'
  | 'minimax'
  | 'glm'
  | 'meta'
  | 'other';

export type RouteRole =
  | 'economy'
  | 'fast'
  | 'balanced'
  | 'strong'
  | 'max'
  | 'vision_fast'
  | 'vision_strong'
  | 'code_review'
  | 'cheap_critic';

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cachedReadPer1M?: number;
  source: string;
  verifiedAt: string;
  isUnknown?: boolean;
}

export interface ModelConfig {
  modelId: string;
  displayName: string;
  gateway: Gateway;
  protocol: ModelProtocol;
  family: ModelFamily;
  supportsImages: boolean;
  budgetCap: number;
  pricing: ModelPricing;
  isExperimentalFree?: boolean;
}

export interface RolePolicy {
  primary: string;
  fallback: string[];
}

/**
 * Curated OpenCode Registry.
 * Pinned physical model descriptors validated against official OpenCode Zen documentation & live discovery.
 *
 * Wire Protocol Mappings:
 * - GPT-5.6 Sol / Terra / Luna -> /zen/v1/responses (openai-responses)
 * - Grok 4.6 -> /zen/v1/responses (openai-responses)
 * - Claude Sonnet 5 / Opus 5 / Haiku 4.5 -> /zen/v1/messages (anthropic-messages)
 * - Gemini 3.7 Flash -> /zen/v1/models/gemini-3.7-flash (gemini)
 * - DeepSeek V4 Flash / Pro -> /zen/v1/chat/completions (openai-chat)
 */
export const CURATED_OPENCODE_REGISTRY: Record<string, ModelConfig> = {
  'deepseek-v4-flash': {
    modelId: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    gateway: 'opencode',
    protocol: 'openai-chat',
    family: 'deepseek',
    supportsImages: false,
    budgetCap: 8192,
    pricing: {
      inputPer1M: 0.14,
      outputPer1M: 0.28,
      source: 'opencode-zen-official',
      verifiedAt: '2026-08-16',
    },
  },
  'deepseek-v4-pro': {
    modelId: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    gateway: 'opencode',
    protocol: 'openai-chat',
    family: 'deepseek',
    supportsImages: false,
    budgetCap: 16384,
    pricing: {
      inputPer1M: 1.74,
      outputPer1M: 3.48,
      source: 'opencode-zen-official',
      verifiedAt: '2026-08-16',
    },
  },
  'gpt-5.6-luna': {
    modelId: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    gateway: 'opencode',
    protocol: 'openai-responses',
    family: 'openai',
    supportsImages: true,
    budgetCap: 8192,
    pricing: {
      inputPer1M: 0.20,
      outputPer1M: 1.20,
      source: 'opencode-zen-official',
      verifiedAt: '2026-08-16',
    },
  },
  'gpt-5.6-terra': {
    modelId: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    gateway: 'opencode',
    protocol: 'openai-responses',
    family: 'openai',
    supportsImages: true,
    budgetCap: 16384,
    pricing: {
      inputPer1M: 2.00,
      outputPer1M: 12.00,
      source: 'opencode-zen-official',
      verifiedAt: '2026-08-16',
    },
  },
  'gpt-5.6-sol': {
    modelId: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    gateway: 'opencode',
    protocol: 'openai-responses',
    family: 'openai',
    supportsImages: true,
    budgetCap: 32768,
    pricing: {
      inputPer1M: 5.00,
      outputPer1M: 30.00,
      source: 'opencode-zen-official',
      verifiedAt: '2026-08-16',
    },
  },
  'grok-4.6': {
    modelId: 'grok-4.6',
    displayName: 'Grok 4.6',
    gateway: 'opencode',
    protocol: 'openai-responses',
    family: 'xai',
    supportsImages: true,
    budgetCap: 16384,
    pricing: {
      inputPer1M: 2.00,
      outputPer1M: 6.00,
      source: 'opencode-zen-official',
      verifiedAt: '2026-08-16',
    },
  },
  'claude-sonnet-5': {
    modelId: 'claude-sonnet-5',
    displayName: 'Claude Sonnet 5',
    gateway: 'opencode',
    protocol: 'anthropic-messages',
    family: 'anthropic',
    supportsImages: true,
    budgetCap: 16384,
    pricing: {
      inputPer1M: 2.00,
      outputPer1M: 10.00,
      source: 'opencode-zen-official',
      verifiedAt: '2026-08-16',
    },
  },
  'claude-opus-5': {
    modelId: 'claude-opus-5',
    displayName: 'Claude Opus 5',
    gateway: 'opencode',
    protocol: 'anthropic-messages',
    family: 'anthropic',
    supportsImages: true,
    budgetCap: 16384,
    pricing: {
      inputPer1M: 5.00,
      outputPer1M: 25.00,
      source: 'opencode-zen-official',
      verifiedAt: '2026-08-16',
    },
  },
  'claude-haiku-4-5': {
    modelId: 'claude-haiku-4-5',
    displayName: 'Claude Haiku 4.5',
    gateway: 'opencode',
    protocol: 'anthropic-messages',
    family: 'anthropic',
    supportsImages: true,
    budgetCap: 8192,
    pricing: {
      inputPer1M: 1.00,
      outputPer1M: 5.00,
      cachedReadPer1M: 0.10,
      source: 'opencode-zen-official',
      verifiedAt: '2026-08-16',
    },
  },
  'gemini-3.7-flash': {
    modelId: 'gemini-3.7-flash',
    displayName: 'Gemini 3.7 Flash',
    gateway: 'opencode',
    protocol: 'gemini',
    family: 'google',
    supportsImages: true,
    budgetCap: 8192,
    pricing: {
      inputPer1M: 1.50,
      outputPer1M: 7.50,
      source: 'opencode-zen-official',
      verifiedAt: '2026-08-16',
    },
  },

  // Quarantined Free/Experimental Models (NEVER in automatic production fallbacks)
  'deepseek-v4-flash-free': {
    modelId: 'deepseek-v4-flash-free',
    displayName: 'DeepSeek V4 Flash (Free Tier — Data Retention Permissive)',
    gateway: 'opencode',
    protocol: 'openai-chat',
    family: 'deepseek',
    supportsImages: false,
    budgetCap: 8192,
    isExperimentalFree: true,
    pricing: {
      inputPer1M: 0.0,
      outputPer1M: 0.0,
      source: 'opencode-zen-free-tier',
      verifiedAt: '2026-08-16',
    },
  },
  'mimo-v2.5-free': {
    modelId: 'mimo-v2.5-free',
    displayName: 'Mimo V2.5 (Free Tier — Data Retention Permissive)',
    gateway: 'opencode',
    protocol: 'openai-chat',
    family: 'other',
    supportsImages: false,
    budgetCap: 4096,
    isExperimentalFree: true,
    pricing: {
      inputPer1M: 0.0,
      outputPer1M: 0.0,
      source: 'opencode-zen-free-tier',
      verifiedAt: '2026-08-16',
    },
  },
};

/**
 * Standard Production Route Policy (Initial Hypotheses).
 * Strict Privacy Invariant:
 * - Free/data-training endpoints are NEVER automatic fallbacks for personal chat.
 * - All automatic targets are paid, standard-retention endpoints.
 */
export const CURATED_ROUTE_POLICY: Record<RouteRole, RolePolicy> = {
  economy: {
    primary: 'deepseek-v4-flash',
    fallback: ['gpt-5.6-luna'],
  },
  fast: {
    primary: 'gpt-5.6-luna',
    fallback: ['gemini-3.7-flash', 'deepseek-v4-flash'],
  },
  balanced: {
    primary: 'deepseek-v4-pro',
    fallback: ['grok-4.6', 'gpt-5.6-terra'],
  },
  strong: {
    primary: 'claude-sonnet-5',
    fallback: ['gpt-5.6-terra', 'grok-4.6'],
  },
  max: {
    primary: 'gpt-5.6-sol',
    fallback: ['claude-opus-5', 'claude-sonnet-5'],
  },
  vision_fast: {
    primary: 'gemini-3.7-flash',
    fallback: ['gpt-5.6-luna', 'claude-haiku-4-5'],
  },
  vision_strong: {
    primary: 'claude-sonnet-5',
    fallback: ['gpt-5.6-terra', 'gemini-3.7-flash'],
  },
  code_review: {
    primary: 'claude-sonnet-5',
    fallback: ['deepseek-v4-pro', 'gpt-5.6-terra'],
  },
  cheap_critic: {
    primary: 'deepseek-v4-flash',
    fallback: ['gpt-5.6-luna'],
  },
};

/**
 * Explicit Experimental/Free Policy (Requires explicit opt-in & privacy disclosure).
 */
export const EXPERIMENTAL_FREE_POLICY: Record<string, string> = {
  'fast-free': 'deepseek-v4-flash-free',
  'mimo-free': 'mimo-v2.5-free',
};

export class ModelUnavailableError extends Error {
  constructor(role: RouteRole) {
    super(`No available standard-retention models discovered for role '${role}' in curated policy.`);
    this.name = 'ModelUnavailableError';
  }
}

export class ModelPricingUnavailableError extends Error {
  constructor(modelId: string) {
    super(`Automatic routing forbidden: pricing is unavailable for model '${modelId}'.`);
    this.name = 'ModelPricingUnavailableError';
  }
}

/**
 * Resolves a logical RouteRole to a concrete ModelConfig given discovered models.
 */
export function resolveModelForRole(
  role: RouteRole,
  discoveredModelIds?: Set<string>,
): ModelConfig {
  const policy = CURATED_ROUTE_POLICY[role];
  if (!policy) {
    throw new Error(`Unknown route role: ${role}`);
  }

  const candidates = [policy.primary, ...policy.fallback];

  for (const modelId of candidates) {
    const config = CURATED_OPENCODE_REGISTRY[modelId];
    if (!config) continue;

    // Reject free/experimental models from standard production auto-routing
    if (config.isExperimentalFree) {
      continue;
    }

    // Fail closed if pricing is unknown
    if (config.pricing.isUnknown) {
      continue;
    }

    // Candidate must be present in runtime discovery
    if (discoveredModelIds && !discoveredModelIds.has(modelId)) {
      continue;
    }

    return config;
  }

  throw new ModelUnavailableError(role);
}
