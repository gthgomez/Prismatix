// src/services/imageGenerationService.ts
// BYOK image generation service with cost estimation, model pricing,
// and server-owned Edge Function execution accounting.

import { supabase } from '../lib/supabase';

export interface ImageModelInfo {
  id: string;
  name: string;
  provider: 'openai' | 'openrouter';
  costPerImageUsd: number;
  supportedSizes: string[];
  description: string;
}

export const SUPPORTED_IMAGE_MODELS: ImageModelInfo[] = [
  {
    id: 'dall-e-3',
    name: 'DALL-E 3',
    provider: 'openai',
    costPerImageUsd: 0.040,
    supportedSizes: ['1024x1024', '1024x1792', '1792x1024'],
    description: 'High-detail standard generation with prompt refinement',
  },
  {
    id: 'dall-e-2',
    name: 'DALL-E 2',
    provider: 'openai',
    costPerImageUsd: 0.020,
    supportedSizes: ['256x256', '512x512', '1024x1024'],
    description: 'Economy legacy image generation',
  },
  {
    id: 'flux-1-schnell',
    name: 'FLUX.1 Schnell',
    provider: 'openrouter',
    costPerImageUsd: 0.003,
    supportedSizes: ['1024x1024', '768x1024', '1024x768'],
    description: 'Ultra-fast, low-cost open weights model',
  },
  {
    id: 'flux-1-dev',
    name: 'FLUX.1 Dev',
    provider: 'openrouter',
    costPerImageUsd: 0.025,
    supportedSizes: ['1024x1024', '768x1024', '1024x768'],
    description: 'High quality open weights development checkpoint',
  },
  {
    id: 'stable-diffusion-3',
    name: 'Stable Diffusion 3 Medium',
    provider: 'openrouter',
    costPerImageUsd: 0.035,
    supportedSizes: ['1024x1024'],
    description: 'Photorealistic multi-subject diffusion',
  },
];

export interface ImageGenerationParams {
  prompt: string;
  modelId: string;
  size?: string;
  apiKey?: string;
  mockMode?: boolean;
  conversationId?: string;
}

export interface ImageGenerationResult {
  success: boolean;
  imageUrl?: string;
  storagePath?: string;
  modelId: string;
  prompt: string;
  size: string;
  costUsd: number;
  costStatus?: 'settled' | 'unmetered' | 'failed';
  isMock?: boolean;
  revisedPrompt?: string;
  executionId?: string;
  error?: string;
  timestamp: string;
}

export function getImageModelInfo(modelId: string): ImageModelInfo | undefined {
  return SUPPORTED_IMAGE_MODELS.find((m) => m.id === modelId);
}

export function estimateImageCost(modelId: string, _size?: string): number {
  const model = getImageModelInfo(modelId);
  return model ? model.costPerImageUsd : 0.03;
}

export async function executeImageGeneration(
  params: ImageGenerationParams,
  client: any = supabase,
): Promise<ImageGenerationResult> {
  const { prompt, modelId, size = '1024x1024', apiKey, mockMode = false, conversationId } = params;

  if (!prompt.trim()) {
    return {
      success: false,
      modelId,
      prompt,
      size,
      costUsd: 0,
      error: 'Image generation prompt cannot be empty.',
      timestamp: new Date().toISOString(),
    };
  }

  const modelInfo = getImageModelInfo(modelId);
  if (!modelInfo) {
    return {
      success: false,
      modelId,
      prompt,
      size,
      costUsd: 0,
      error: `Unsupported image model: ${modelId}`,
      timestamp: new Date().toISOString(),
    };
  }

  const estimatedCost = modelInfo.costPerImageUsd;

  // Mock mode for testing / preview without external billing
  if (mockMode || (process.env.NODE_ENV === 'test' && !client?.functions?.invoke) || apiKey === 'mock-key-for-test') {
    const svgData = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#4ECDC4"/>
          <stop offset="100%" stop-color="#1A535C"/>
        </linearGradient>
      </defs>
      <rect width="512" height="512" fill="url(#g)"/>
      <circle cx="256" cy="200" r="80" fill="#FFE66D" opacity="0.8"/>
      <path d="M 50 450 L 200 300 L 350 450 Z" fill="#292F36" opacity="0.9"/>
      <path d="M 250 450 L 380 340 L 480 450 Z" fill="#FF6B6B" opacity="0.7"/>
      <text x="256" y="490" font-family="sans-serif" font-size="14" fill="#ffffff" text-anchor="middle">Prismatix Generated: ${encodeURIComponent(prompt.slice(0, 30))}</text>
    </svg>`;

    const mockDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgData)}`;

    return {
      success: true,
      imageUrl: mockDataUrl,
      modelId,
      prompt,
      size,
      costUsd: estimatedCost,
      costStatus: 'unmetered',
      isMock: true,
      revisedPrompt: `A photorealistic depiction of: ${prompt}`,
      timestamp: new Date().toISOString(),
    };
  }

  // Authoritative server-owned execution via Edge Function
  if (client?.functions?.invoke) {
    try {
      const { data, error } = await client.functions.invoke('image-generation', {
        body: {
          prompt: prompt.trim(),
          modelId,
          size,
          conversationId,
          mockMode,
        },
      });

      if (error) {
        return {
          success: false,
          modelId,
          prompt,
          size,
          costUsd: 0,
          costStatus: 'failed',
          isMock: false,
          error: error.message || 'Image generation service error',
          timestamp: new Date().toISOString(),
        };
      }

      if (!data || !data.success) {
        return {
          success: false,
          modelId,
          prompt,
          size,
          costUsd: 0,
          costStatus: 'failed',
          isMock: false,
          error: data?.error || 'Image generation failed',
          timestamp: new Date().toISOString(),
        };
      }

      return data as ImageGenerationResult;
    } catch (invokeErr) {
      return {
        success: false,
        modelId,
        prompt,
        size,
        costUsd: 0,
        costStatus: 'failed',
        isMock: false,
        error: `Image generation service unreachable: ${invokeErr instanceof Error ? invokeErr.message : String(invokeErr)}`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Fallback for isolated offline test harnesses without edge function
  if (process.env.NODE_ENV === 'test') {
    return {
      success: true,
      imageUrl: 'data:image/svg+xml;utf8,<svg></svg>',
      modelId,
      prompt,
      size,
      costUsd: estimatedCost,
      costStatus: 'unmetered',
      isMock: true,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    success: false,
    modelId,
    prompt,
    size,
    costUsd: 0,
    costStatus: 'failed',
    isMock: false,
    error: 'Image generation service is unavailable.',
    timestamp: new Date().toISOString(),
  };
}
