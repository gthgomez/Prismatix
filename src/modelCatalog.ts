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
];
