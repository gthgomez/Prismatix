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
  'gpt-5.4-mini': {
    provider: 'openai',
    name: 'GPT-5.4 mini',
    shortName: 'GPT-5.4 mini',
    description: 'Low-latency general tasks',
    color: '#F4A261',
    icon: '🧩',
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
  'nemotron-3-super': {
    provider: 'nvidia',
    name: 'Nemotron-3 Super',
    shortName: 'Nemotron-3 Super',
    description: 'NVIDIA 120B reasoning model',
    color: '#76B900',
    icon: '🟢',
  },
  'llama-4-scout': {
    provider: 'deepinfra',
    name: 'Llama 4 Scout',
    shortName: 'Llama 4 Scout',
    description: 'Meta 17B-16E MoE via DeepInfra',
    color: '#046A38',
    icon: '🦙',
  },
  'qwen3-235b': {
    provider: 'deepinfra',
    name: 'Qwen3 235B',
    shortName: 'Qwen3 235B',
    description: 'Alibaba 235B MoE via DeepInfra',
    color: '#6C3483',
    icon: '🟣',
  },
  'llama-3.3-70b-turbo': {
    provider: 'deepinfra',
    name: 'Llama 3.3 70B Turbo',
    shortName: 'Llama 3.3 70B',
    description: 'Meta 70B via DeepInfra',
    color: '#1B4F72',
    icon: '🦙',
  },
  'mistral-small-24b': {
    provider: 'deepinfra',
    name: 'Mistral Small 24B',
    shortName: 'Mistral Small 24B',
    description: 'Mistral 24B via DeepInfra',
    color: '#E67E22',
    icon: '🌪️',
  },
  'qwen3-32b': {
    provider: 'deepinfra',
    name: 'Qwen3 32B',
    shortName: 'Qwen3 32B',
    description: 'Dense 32B via DeepInfra',
    color: '#884EA0',
    icon: '🟣',
  },
  'deepseek-v3': {
    provider: 'deepinfra',
    name: 'DeepSeek V3',
    shortName: 'DeepSeek V3',
    description: 'DeepSeek 685B MoE via DeepInfra',
    color: '#117864',
    icon: '🐋',
  },
  'glm-4.7-flash': {
    provider: 'deepinfra',
    name: 'GLM 4.7 Flash',
    shortName: 'GLM 4.7 Flash',
    description: 'Cheap skeptical challenger',
    color: '#9C640C',
    icon: '⚡',
  },
  'qwen3.5-4b': {
    provider: 'deepinfra',
    name: 'Qwen 3.5 4B',
    shortName: 'Qwen 3.5 4B',
    description: 'Ultra-cheap framing challenger',
    color: '#5B2C6F',
    icon: '🟣',
  },
  'qwen3.5-9b': {
    provider: 'deepinfra',
    name: 'Qwen 3.5 9B',
    shortName: 'Qwen 3.5 9B',
    description: 'Cheap structured alternative',
    color: '#7D3C98',
    icon: '🟣',
  },
  'step-3.5-flash': {
    provider: 'deepinfra',
    name: 'Step-3.5 Flash',
    shortName: 'Step-3.5 Flash',
    description: 'Agentic code implementer, SWE-bench strong',
    color: '#1A5276',
    icon: '⚡',
  },
  'llama-3.1-8b-turbo': {
    provider: 'deepinfra',
    name: 'Llama 3.1 8B Turbo',
    shortName: 'Llama 3.1 8B',
    description: 'Ultra-cheap floor fallback',
    color: '#5D6D7E',
    icon: '🦙',
  },
  'mistral-nemo': {
    provider: 'deepinfra',
    name: 'Mistral Nemo',
    shortName: 'Mistral Nemo',
    description: 'Ultra-cheap floor fallback',
    color: '#784212',
    icon: '🌊',
  },
  'nemotron-nano-30b': {
    provider: 'deepinfra',
    name: 'Nemotron Nano 30B',
    shortName: 'Nemotron Nano',
    description: 'Cheap agentic reasoning challenger',
    color: '#1E8449',
    icon: '🟢',
  },
};

/** Listed output $/M ascending (cheapest → priciest) for list order and provider sub-order. */
export const MODEL_ORDER: RouterModel[] = getRouterModelOrderByListedOutputUsdPerM('asc');

/** Curated subset for empty state and compact override UI. */
export const MODEL_HIGHLIGHTS: RouterModel[] = [
  'deepseek-v4-flash-free',
  'deepseek-v4-flash',
  'gpt-5.6-luna',
  'gemini-3.7-flash',
  'deepseek-v4-pro',
  'claude-sonnet-5',
  'gpt-5.6-sol',
];

export const MODEL_EXTENDED_ORDER: RouterModel[] = MODEL_ORDER.filter(
  (id) => !MODEL_HIGHLIGHTS.includes(id),
);
