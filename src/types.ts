// src/types.ts

export type AnthropicModel = 'opus-4.6' | 'sonnet-4.6' | 'haiku-4.5';

export type OpenCodeModel =
  | 'deepseek-v4-flash'
  | 'deepseek-v4-flash-free'
  | 'deepseek-v4-pro'
  | 'gpt-5.6-luna'
  | 'gpt-5.6-terra'
  | 'gpt-5.6-sol'
  | 'claude-sonnet-5'
  | 'claude-opus-5'
  | 'claude-haiku-4-5'
  | 'gemini-3.7-flash'
  | 'grok-4.6'
  | 'mimo-v2.5-free';

export type RouterModel =
  | OpenCodeModel
  | AnthropicModel
  | 'gpt-5.4-mini'
  | 'gemini-3-flash'
  | 'gemini-2.5-flash'
  | 'gemini-3.1-pro'
  | 'nemotron-3-super'
  | 'llama-4-scout'
  | 'qwen3-235b'
  | 'llama-3.3-70b-turbo'
  | 'mistral-small-24b'
  | 'qwen3-32b'
  | 'deepseek-v3'
  | 'glm-4.7-flash'
  | 'qwen3.5-4b'
  | 'qwen3.5-9b'
  | 'step-3.5-flash'
  | 'llama-3.1-8b-turbo'
  | 'mistral-nemo'
  | 'nemotron-nano-30b';

export type RouterProvider =
  | 'opencode'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'nvidia'
  | 'deepinfra'
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

export type GeminiFlashThinkingLevel = 'low' | 'high';
export type DebateProfile = 'general' | 'code' | 'video_ui';
export type DebateRole = 'proposer' | 'contrarian';

export interface DebateParticipant {
  model: RouterModel;
  role: DebateRole;
  response: string;
  keyPoints?: string[];
}
export type AttachmentKind = 'image' | 'text' | 'video';
export type VideoAssetStatus =
  | 'pending_upload'
  | 'uploaded'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'expired';

export interface MessageCost {
  estimatedUsd?: number;
  finalUsd?: number;
  pricingVersion?: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string | unknown[]; // Supports multimodal content
  timestamp: number;
  model?: RouterModel;
  provider?: RouterProvider;
  modelId?: string;
  modelOverride?: string;
  routeRole?: RouteRole;
  geminiFlashThinkingLevel?: GeminiFlashThinkingLevel;
  debateActive?: boolean;
  debateProfile?: DebateProfile;
  debateTrigger?: string;
  debateModel?: string;
  debateCostNote?: string;
  debateParticipants?: DebateParticipant[];
  imageData?: string;            // Base64 image data (first image for display)
  mediaType?: string;            // MIME type
  imageStorageUrl?: string;      // Private Supabase storage reference
  attachments?: FileUploadPayload[]; // All attachments for reference
  thinkingLog?: string[];
  thinkingDurationMs?: number;
  cost?: MessageCost;
}

export interface FileUploadPayload {
  clientId?: string;
  name: string;
  kind?: AttachmentKind;
  isImage: boolean;
  imageData?: string;   // Base64 (without data URL prefix)
  mediaType?: string;
  sizeBytes?: number;
  size?: number;
  storageUrl?: string;  // Set after uploading to Supabase Storage
  extractedText?: string;
  fileText?: string;
  content?: string;
  file?: File;
  status?: string;
  errorCode?: string;
  uploadProgress?: number;
  durationMs?: number;
  videoAssetId?: string;
  videoStatus?: VideoAssetStatus;
  videoDurationSeconds?: number;
  videoMimeType?: string;
  videoError?: string;
}

export interface ModelOption {
  value: string;
  label: string;
  description: string;
  provider: RouterProvider;
  icon: string;
  badge?: string;
}

export interface ChatStats {
  totalMessages: number;
  totalTokens: number;
  estimatedCost: number;
}
