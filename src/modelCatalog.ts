import type { RouterModel, RouterProvider } from './types';

export interface ModelCatalogEntry {
  provider: RouterProvider;
  name: string;
  shortName: string;
  description: string;
  color: string;
  icon: string;
}

export const MODEL_CATALOG: Record<RouterModel, ModelCatalogEntry> = {
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
  'nemotron-3-super': {
    provider: 'nvidia',
    name: 'Nemotron 3 Super',
    shortName: 'Nemotron Super',
    description: 'Agentic reasoning (120B MoE)',
    color: '#76B900',
    icon: '🟢',
  },
  'gemini-3.1-pro': {
    provider: 'google',
    name: 'Gemini 3.1 Pro',
    shortName: 'Gemini 3.1 Pro',
    description: 'Advanced multimodal reasoning',
    color: '#1D3557',
    icon: '🔬',
  },
  'llama-4-scout': {
    provider: 'deepinfra',
    name: 'Llama 4 Scout',
    shortName: 'Llama 4 Scout',
    description: 'Fast open-weight inference (17B MoE)',
    color: '#7B2FBE',
    icon: '🦙',
  },
  'qwen3-235b': {
    provider: 'deepinfra',
    name: 'Qwen3 235B',
    shortName: 'Qwen3 235B',
    description: 'Large open-weight reasoning model — $0.10/M output',
    color: '#5C4033',
    icon: '🧬',
  },
  'llama-3.3-70b-turbo': {
    provider: 'deepinfra',
    name: 'Llama 3.3 70B Turbo',
    shortName: 'Llama 3.3 70B',
    description: 'Fast open-weight 70B — $0.03/M output',
    color: '#9B59B6',
    icon: '🦙',
  },
  'mistral-small-24b': {
    provider: 'deepinfra',
    name: 'Mistral Small 24B',
    shortName: 'Mistral Small',
    description: 'Efficient 24B instruct model — $0.08/M output',
    color: '#E67E22',
    icon: '🌊',
  },
  'qwen3-32b': {
    provider: 'deepinfra',
    name: 'Qwen3 32B',
    shortName: 'Qwen3 32B',
    description: 'Strong reasoning at low cost — $0.28/M output',
    color: '#16A085',
    icon: '🧠',
  },
  'deepseek-v3': {
    provider: 'deepinfra',
    name: 'DeepSeek V3',
    shortName: 'DeepSeek V3',
    description: 'Near-frontier quality open-weight (0324) — $0.77/M output',
    color: '#2980B9',
    icon: '🔭',
  },
  // Debate-tier cheap challengers
  'glm-4.7-flash': {
    provider: 'deepinfra',
    name: 'GLM-4.7 Flash',
    shortName: 'GLM-4.7 Flash',
    description: 'Cheap skeptical challenger — $0.40/M output',
    color: '#C0392B',
    icon: '⚔️',
  },
  'qwen3.5-4b': {
    provider: 'deepinfra',
    name: 'Qwen3.5 4B',
    shortName: 'Qwen3.5 4B',
    description: 'Ultra-cheap alternative architect — $0.15/M output',
    color: '#8E44AD',
    icon: '🏗️',
  },
  'qwen3.5-9b': {
    provider: 'deepinfra',
    name: 'Qwen3.5 9B',
    shortName: 'Qwen3.5 9B',
    description: 'Cheap long-context alternative architect — $0.20/M output',
    color: '#6C3483',
    icon: '🏗️',
  },
  'step-3.5-flash': {
    provider: 'deepinfra',
    name: 'Step-3.5 Flash',
    shortName: 'Step-3.5 Flash',
    description: 'Agentic code implementer, SWE-bench strong — $0.30/M output',
    color: '#1A5276',
    icon: '⚡',
  },
  'llama-3.1-8b-turbo': {
    provider: 'deepinfra',
    name: 'Llama 3.1 8B Turbo',
    shortName: 'Llama 3.1 8B',
    description: 'Ultra-cheap floor fallback — $0.03/M output',
    color: '#5D6D7E',
    icon: '🦙',
  },
  'mistral-nemo': {
    provider: 'deepinfra',
    name: 'Mistral Nemo',
    shortName: 'Mistral Nemo',
    description: 'Ultra-cheap floor fallback — $0.04/M output',
    color: '#784212',
    icon: '🌊',
  },
  'nemotron-nano-30b': {
    provider: 'deepinfra',
    name: 'Nemotron Nano 30B',
    shortName: 'Nemotron Nano',
    description: 'Cheap agentic reasoning challenger — $0.16/M output',
    color: '#1E8449',
    icon: '🟢',
  },
};

export const MODEL_ORDER: RouterModel[] = [
  'opus-4.6',
  'sonnet-4.6',
  'haiku-4.5',
  'gpt-5.4-mini',
  'gemini-3-flash',
  'gemini-2.5-flash',
  'gemini-3.1-pro',
  'nemotron-3-super',
  'llama-4-scout',
  'qwen3-235b',
  'llama-3.3-70b-turbo',
  'mistral-small-24b',
  'qwen3-32b',
  'deepseek-v3',
  'glm-4.7-flash',
  'qwen3.5-4b',
  'qwen3.5-9b',
  'step-3.5-flash',
  'llama-3.1-8b-turbo',
  'mistral-nemo',
  'nemotron-nano-30b',
];

/** Curated subset for marketing empty state and compact override UI (full list stays in MODEL_ORDER). */
export const MODEL_HIGHLIGHTS: RouterModel[] = [
  'gemini-3-flash',
  'gemini-3.1-pro',
  'sonnet-4.6',
  'opus-4.6',
  'haiku-4.5',
  'gpt-5.4-mini',
];

export const MODEL_EXTENDED_ORDER: RouterModel[] = MODEL_ORDER.filter(
  (id) => !MODEL_HIGHLIGHTS.includes(id),
);
