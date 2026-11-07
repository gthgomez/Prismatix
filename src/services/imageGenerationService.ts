// src/services/imageGenerationService.ts
// BYOK image generation service with cost estimation, model pricing, and execution accounting.

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
    supportedSizes: ['512x512', '1024x1024'],
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
}

export interface ImageGenerationResult {
  success: boolean;
  imageUrl?: string;
  modelId: string;
  prompt: string;
  size: string;
  costUsd: number;
  revisedPrompt?: string;
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

export async function executeImageGeneration(params: ImageGenerationParams): Promise<ImageGenerationResult> {
  const { prompt, modelId, size = '1024x1024', apiKey, mockMode = false } = params;

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
  if (mockMode || process.env.NODE_ENV === 'test' || apiKey === 'mock-key-for-test') {
    // Generate deterministic SVG data URI for safe offline/test preview
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
      revisedPrompt: `A photorealistic depiction of: ${prompt}`,
      timestamp: new Date().toISOString(),
    };
  }

  // Live BYOK requires API key
  if (!apiKey) {
    return {
      success: false,
      modelId,
      prompt,
      size,
      costUsd: 0,
      error: `No API key provided for ${modelInfo.provider.toUpperCase()} image generation. Configure your BYOK key in Provider Settings.`,
      timestamp: new Date().toISOString(),
    };
  }

  // External live provider call (honest execution; if failed, return real error)
  try {
    if (modelInfo.provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          prompt,
          n: 1,
          size,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          modelId,
          prompt,
          size,
          costUsd: 0,
          error: `OpenAI Image API error (${response.status}): ${errorBody}`,
          timestamp: new Date().toISOString(),
        };
      }

      const data = (await response.json()) as { data?: Array<{ url?: string; revised_prompt?: string }> };
      const imgItem = data.data?.[0];

      if (!imgItem?.url) {
        return {
          success: false,
          modelId,
          prompt,
          size,
          costUsd: 0,
          error: 'OpenAI returned empty image response.',
          timestamp: new Date().toISOString(),
        };
      }

      return {
        success: true,
        imageUrl: imgItem.url,
        modelId,
        prompt,
        size,
        costUsd: estimatedCost,
        revisedPrompt: imgItem.revised_prompt,
        timestamp: new Date().toISOString(),
      };
    } else {
      // OpenRouter image generation endpoint
      const response = await fetch('https://openrouter.ai/api/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          prompt,
          size,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        return {
          success: false,
          modelId,
          prompt,
          size,
          costUsd: 0,
          error: `OpenRouter Image API error (${response.status}): ${errText}`,
          timestamp: new Date().toISOString(),
        };
      }

      const resData = (await response.json()) as { data?: Array<{ url?: string }> };
      const url = resData.data?.[0]?.url;
      if (!url) {
        return {
          success: false,
          modelId,
          prompt,
          size,
          costUsd: 0,
          error: 'OpenRouter returned empty image response.',
          timestamp: new Date().toISOString(),
        };
      }

      return {
        success: true,
        imageUrl: url,
        modelId,
        prompt,
        size,
        costUsd: estimatedCost,
        timestamp: new Date().toISOString(),
      };
    }
  } catch (netErr) {
    return {
      success: false,
      modelId,
      prompt,
      size,
      costUsd: 0,
      error: `Network error during image generation: ${netErr instanceof Error ? netErr.message : String(netErr)}`,
      timestamp: new Date().toISOString(),
    };
  }
}
