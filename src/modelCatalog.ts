import type { RouterModel, RouterProvider } from './types';
import { getRouterModelOrderByListedOutputUsdPerM } from './modelEconomyOrder';
import { getPricingForModel } from './pricingRegistry';

export interface ModelCatalogEntry {
  provider: RouterProvider;
  name: string;
  shortName: string;
  description: string;
  color: string;
  icon: string;
}

export function formatModelPriceLabel(model: string): string {
  const pricing = getPricingForModel(model);
  if (pricing.isUnknown) return 'Custom rate';
  if (pricing.outputRatePer1M === 0 && pricing.inputRatePer1M === 0) return 'Free';
  return `$${pricing.inputRatePer1M.toFixed(2)}/M in · $${pricing.outputRatePer1M.toFixed(2)}/M out`;
}

export const MODEL_CATALOG: Record<RouterModel, ModelCatalogEntry> = {
  // OpenCode Curated Models
  'deepseek-v4-flash': {
    provider: 'opencode',
    name: 'DeepSeek V4 Flash',
    shortName: 'DeepSeek V4 Flash',
    description: 'High-speed reasoning & economics tier',
    color: '#0066FF',
    icon: '⚡',
  },
  'deepseek-v4-flash-free': {
    provider: 'opencode',
    name: 'DeepSeek V4 Flash (Free)',
    shortName: 'DeepSeek Flash Free',
    description: 'Zero-cost fast tier on OpenCode Zen',
    color: '#3399FF',
    icon: '🆓',
  },
  'deepseek-v4-pro': {
    provider: 'opencode',
    name: 'DeepSeek V4 Pro',
    shortName: 'DeepSeek V4 Pro',
    description: 'Balanced coding & deep reasoning tier',
    color: '#0044CC',
    icon: '🧠',
  },
  'gpt-5.6-luna': {
    provider: 'opencode',
    name: 'GPT-5.6 Luna',
    shortName: 'GPT-5.6 Luna',
    description: 'Fast cloud conversational model',
    color: '#10A37F',
    icon: '🌙',
  },
  'gpt-5.6-terra': {
    provider: 'opencode',
    name: 'GPT-5.6 Terra',
    shortName: 'GPT-5.6 Terra',
    description: 'Strong balanced reasoning model',
    color: '#0E8065',
    icon: '🌍',
  },
  'gpt-5.6-sol': {
    provider: 'opencode',
    name: 'GPT-5.6 Sol',
    shortName: 'GPT-5.6 Sol',
    description: 'Max tier frontier reasoning model',
    color: '#D97706',
    icon: '☀️',
  },
  'claude-sonnet-5': {
    provider: 'opencode',
    name: 'Claude Sonnet 5',
    shortName: 'Sonnet 5',
    description: 'Premier coding & analysis tier',
    color: '#4ECDC4',
    icon: '⚡',
  },
  'claude-opus-5': {
    provider: 'opencode',
    name: 'Claude Opus 5',
    shortName: 'Opus 5',
    description: 'Frontier deep research & architecture',
    color: '#FF6B6B',
    icon: '🧠',
  },
  'claude-haiku-4-5': {
    provider: 'opencode',
    name: 'Claude Haiku 4.5',
    shortName: 'Haiku 4.5',
    description: 'Low-latency multimodal model',
    color: '#FFE66D',
    icon: '🚀',
  },
  'gemini-3.7-flash': {
    provider: 'opencode',
    name: 'Gemini 3.7 Flash',
    shortName: 'Gemini 3.7 Flash',
    description: 'Fast multimodal vision & reasoning',
    color: '#00BCD4',
    icon: '✨',
  },
  'grok-4.6': {
    provider: 'opencode',
    name: 'Grok 4.6',
    shortName: 'Grok 4.6',
    description: 'Strong mathematical & code reasoning',
    color: '#E02424',
    icon: '🚀',
  },
  'mimo-v2.5-free': {
    provider: 'opencode',
    name: 'Mimo V2.5 (Free)',
    shortName: 'Mimo Free',
    description: 'Zero-cost lightweight conversational tier',
    color: '#8B5CF6',
    icon: '🆓',
  },
  'gpt-6-sol': {
    provider: 'opencode',
    name: 'GPT-6 Sol',
    shortName: 'GPT-6 Sol',
    description: 'Frontier reasoning tier (mid GPT-6 family)',
    color: '#D97706',
    icon: '☀️',
  },
  'gpt-6-luna': {
    provider: 'opencode',
    name: 'GPT-6 Luna',
    shortName: 'GPT-6 Luna',
    description: 'Fast low-cost conversational tier',
    color: '#10A37F',
    icon: '🌙',
  },
  'claude-opus-5-5': {
    provider: 'opencode',
    name: 'Claude Opus 5.5',
    shortName: 'Opus 5.5',
    description: 'Frontier deep research & architecture',
    color: '#FF6B6B',
    icon: '🧠',
  },
  'claude-sonnet-5-5': {
    provider: 'opencode',
    name: 'Claude Sonnet 5.5',
    shortName: 'Sonnet 5.5',
    description: 'Premier coding & analysis tier, 1M context',
    color: '#4ECDC4',
    icon: '⚡',
  },
  'gemini-3.8-flash': {
    provider: 'opencode',
    name: 'Gemini 3.8 Flash',
    shortName: 'Gemini 3.8 Flash',
    description: 'Fast multimodal vision & reasoning',
    color: '#00BCD4',
    icon: '✨',
  },
  'deepseek-v4-1-flash': {
    provider: 'opencode',
    name: 'DeepSeek V4.1 Flash',
    shortName: 'DeepSeek V4.1 Flash',
    description: 'New-architecture fast tier with native image input',
    color: '#0066FF',
    icon: '⚡',
  },
  'glm-5.3-flash': {
    provider: 'opencode',
    name: 'GLM 5.3 Flash',
    shortName: 'GLM 5.3 Flash',
    description: 'Fast bilingual chat & tool-use tier',
    color: '#2E7D6F',
    icon: '🪁',
  },
  'qwen-3.8-flash': {
    provider: 'opencode',
    name: 'Qwen 3.8 Flash',
    shortName: 'Qwen 3.8 Flash',
    description: 'Low-latency multilingual flash tier',
    color: '#6A4C93',
    icon: '🌊',
  },
  'mimo-2.6-flash': {
    provider: 'opencode',
    name: 'Mimo 2.6 Flash',
    shortName: 'Mimo 2.6 Flash',
    description: 'Lightweight fast conversational tier',
    color: '#8B5CF6',
    icon: '🟣',
  },

  // Legacy fallback models
  'opus-4.6': {
    provider: 'anthropic',
    name: 'Claude Opus 4.6',
    shortName: 'Opus 4.6',
    description: 'Deep research',
    color: '#FF6B6B',
    icon: '🧠',
  },
  'sonnet-4.6': {
    provider: 'anthropic',
    name: 'Claude Sonnet 4.6',
    shortName: 'Sonnet 4.6',
    description: 'Balanced performance & coding',
    color: '#4ECDC4',
    icon: '⚡',
  },
  'haiku-4.5': {
    provider: 'anthropic',
    name: 'Claude Haiku 4.5',
    shortName: 'Haiku 4.5',
    description: 'Fast & efficient',
    color: '#FFE66D',
    icon: '🚀',
  },
  'gemini-3-flash': {
    provider: 'google',
    name: 'Gemini 3 Flash',
    shortName: 'Gemini 3 Flash',
    description: 'Latest Gemini flash — debate primary',
    color: '#00BCD4',
    icon: '⚡',
  },
  'gemini-2.5-flash': {
    provider: 'google',
    name: 'Gemini 2.5 Flash',
    shortName: 'Gemini 2.5 Flash',
    description: 'Fast multimodal inference (fallback)',
    color: '#2A9D8F',
    icon: '✨',
  },
  'gemini-3.1-pro': {
    provider: 'google',
    name: 'Gemini 3.1 Pro',
    shortName: 'Gemini 3.1 Pro',
    description: 'Complex reasoning & long context',
    color: '#264653',
    icon: '🔮',
  },
};

/** Listed output $/M ascending (cheapest → priciest) for list order and provider sub-order. */
export const MODEL_ORDER: RouterModel[] = getRouterModelOrderByListedOutputUsdPerM('asc');

/**
 * Fallback entry for model IDs the client does not know. The router and this
 * catalog are deployed independently, so a server can return an ID absent
 * here (e.g. mid-rollout); UI lookups must degrade instead of crashing.
 */
export const UNKNOWN_MODEL_ENTRY: ModelCatalogEntry = {
  provider: 'other',
  name: 'Unknown model',
  shortName: 'Unknown model',
  description: 'Not in local catalog',
  color: '#8b949e',
  icon: '❔',
};

/** Catalog entry for any ID, with the neutral fallback for unknown ones. */
export function getCatalogEntry(modelId: string): ModelCatalogEntry {
  return MODEL_CATALOG[modelId as RouterModel] ?? UNKNOWN_MODEL_ENTRY;
}

export function isKnownModel(modelId: string): modelId is RouterModel {
  return modelId in MODEL_CATALOG;
}

/** Curated subset for empty state and compact override UI. */
export const MODEL_HIGHLIGHTS: RouterModel[] = [
  'deepseek-v4-1-flash',
  'mimo-2.6-flash',
  'glm-5.3-flash',
  'qwen-3.8-flash',
];

export const MODEL_EXTENDED_ORDER: RouterModel[] = MODEL_ORDER.filter(
  (id) => !MODEL_HIGHLIGHTS.includes(id),
);
