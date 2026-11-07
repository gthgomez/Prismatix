// supabase/functions/image-generation/index.ts
// F28: Server-owned authenticated BYOK Image Generation with authoritative admission,
// private encrypted BYOK resolution, durable execution accounting, storage persistence,
// and tamper-proof message persistence.

import { createClient } from '@supabase/supabase-js';
import { decryptKey } from '../_shared/byok_crypto.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
};

interface ImageModelConfig {
  id: string;
  provider: 'openai' | 'openrouter';
  openRouterModelId?: string;
  costUsd: number;
  supportedSizes: string[];
}

const SUPPORTED_IMAGE_MODELS: Record<string, ImageModelConfig> = {
  'dall-e-3': {
    id: 'dall-e-3',
    provider: 'openai',
    costUsd: 0.040,
    supportedSizes: ['1024x1024', '1024x1792', '1792x1024'],
  },
  'dall-e-2': {
    id: 'dall-e-2',
    provider: 'openai',
    costUsd: 0.020,
    supportedSizes: ['256x256', '512x512', '1024x1024'],
  },
  'flux-1-schnell': {
    id: 'flux-1-schnell',
    provider: 'openrouter',
    openRouterModelId: 'black-forest-labs/flux-1-schnell',
    costUsd: 0.003,
    supportedSizes: ['1024x1024', '768x1024', '1024x768'],
  },
  'flux-1-dev': {
    id: 'flux-1-dev',
    provider: 'openrouter',
    openRouterModelId: 'black-forest-labs/flux-1-dev',
    costUsd: 0.025,
    supportedSizes: ['1024x1024', '768x1024', '1024x768'],
  },
  'stable-diffusion-3': {
    id: 'stable-diffusion-3',
    provider: 'openrouter',
    openRouterModelId: 'stabilityai/stable-diffusion-3-medium',
    costUsd: 0.035,
    supportedSizes: ['1024x1024'],
  },
};

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function computeSha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handleImageGeneration(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // 1. Authenticate user
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: 'Backend service misconfigured' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: userError } = await serviceClient.auth.getUser(token);
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired auth session' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // 2. Parse request
  let body: {
    prompt?: string;
    modelId?: string;
    size?: string;
    conversationId?: string;
    mockMode?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'Prompt is required' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const modelId = body.modelId || 'flux-1-schnell';
  const size = body.size || '1024x1024';
  const modelConfig = SUPPORTED_IMAGE_MODELS[modelId];

  if (!modelConfig) {
    return new Response(JSON.stringify({ error: `Unsupported image model: "${modelId}"` }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const isMock = Boolean(body.mockMode);

  // 3. Handle explicit mock mode
  if (isMock) {
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
      <text x="256" y="490" font-family="sans-serif" font-size="14" fill="#ffffff" text-anchor="middle">Prismatix Preview: ${encodeURIComponent(prompt.slice(0, 30))}</text>
    </svg>`;
    const mockDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgData)}`;

    const mockResult = {
      success: true,
      imageUrl: mockDataUrl,
      modelId,
      prompt,
      size,
      costUsd: 0,
      costStatus: 'unmetered',
      isMock: true,
      revisedPrompt: `[Mock Preview] ${prompt}`,
      timestamp: new Date().toISOString(),
    };

    if (body.conversationId) {
      await serviceClient.rpc('px28_record_image_message', {
        p_conversation_id: body.conversationId,
        p_content: mockResult.revisedPrompt,
        p_model: modelId,
        p_image_result: mockResult,
        p_is_mock: true,
        p_user_id: user.id,
      });
    }

    return new Response(JSON.stringify(mockResult), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // 4. Resolve encrypted BYOK key server-side
  const { data: ciphertext, error: keyErr } = await serviceClient.rpc('get_user_provider_key_material', {
    p_subject_id: user.id,
    p_provider: modelConfig.provider,
  });

  if (keyErr || !ciphertext || typeof ciphertext !== 'string') {
    return new Response(
      JSON.stringify({
        success: false,
        error: `No ${modelConfig.provider.toUpperCase()} API key configured. Please configure your BYOK key in Provider Settings.`,
      }),
      {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }

  let apiKey: string;
  try {
    apiKey = await decryptKey(ciphertext);
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to decrypt provider key.' }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }

  // 5. Authoritative Cost Admission and Execution Identity
  const estimatedCost = modelConfig.costUsd;
  const clientRequestKey = crypto.randomUUID();
  const payloadHash = await computeSha256(`${prompt}:${modelId}:${size}`);

  const { data: execData, error: execErr } = await serviceClient.rpc('px03_create_execution', {
    p_subject_id: user.id,
    p_conversation_id: body.conversationId || null,
    p_client_request_key: clientRequestKey,
    p_payload_hash: payloadHash,
    p_requested_mode: 'image_generation',
    p_requested_model: modelId,
  });

  if (execErr || !execData?.execution?.id) {
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to create execution identity in ledger.' }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }

  const executionId: string = execData.execution.id;

  // Authoritative admission
  const { data: admitData, error: admitErr } = await serviceClient.rpc('px05_admit_execution', {
    p_subject_id: user.id,
    p_execution_id: executionId,
    p_estimate_usd: estimatedCost,
    p_max_usd: estimatedCost,
    p_lease_seconds: 120,
  });

  if (admitErr || !admitData?.admitted) {
    const reason = admitData?.reason || 'Spending limit or rate limit exceeded';
    return new Response(
      JSON.stringify({ success: false, error: `Execution admission denied: ${reason}` }),
      {
        status: 429,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }

  // 6. External provider call
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  let imageBytes: Uint8Array | null = null;
  let revisedPrompt = prompt;

  try {
    if (modelConfig.provider === 'openai') {
      const resp = await fetch('https://api.openai.com/v1/images/generations', {
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
          response_format: 'b64_json',
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`OpenAI error (${resp.status}): ${errText}`);
      }

      const respJson = (await resp.json()) as {
        data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
      };
      const first = respJson.data?.[0];
      if (first?.revised_prompt) {
        revisedPrompt = first.revised_prompt;
      }

      if (first?.b64_json) {
        imageBytes = base64ToUint8Array(first.b64_json);
      } else if (first?.url) {
        const imgResp = await fetch(first.url, { signal: controller.signal });
        imageBytes = new Uint8Array(await imgResp.arrayBuffer());
      } else {
        throw new Error('OpenAI returned empty image data');
      }
    } else {
      // OpenRouter
      const targetModel = modelConfig.openRouterModelId || modelId;
      const resp = await fetch('https://openrouter.ai/api/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://prismatix.app',
          'X-Title': 'Prismatix BYOK Image Generation',
        },
        body: JSON.stringify({
          model: targetModel,
          prompt,
          size,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`OpenRouter error (${resp.status}): ${errText}`);
      }

      const respJson = (await resp.json()) as {
        data?: Array<{ url?: string; b64_json?: string }>;
      };
      const first = respJson.data?.[0];

      if (first?.b64_json) {
        imageBytes = base64ToUint8Array(first.b64_json);
      } else if (first?.url) {
        const imgResp = await fetch(first.url, { signal: controller.signal });
        imageBytes = new Uint8Array(await imgResp.arrayBuffer());
      } else {
        throw new Error('OpenRouter returned empty image data');
      }
    }
  } catch (provErr: unknown) {
    clearTimeout(timeout);
    // Finalize as failed in ledger and release reservation
    await serviceClient.rpc('px03_finalize_execution', {
      p_execution_id: executionId,
      p_status: 'failed',
      p_terminal_outcome: 'provider_error',
    });
    await serviceClient.rpc('px05_reconcile_reservation', {
      p_execution_id: executionId,
      p_actual_usd: 0,
      p_reason: 'provider_error',
    });

    const msg = provErr instanceof Error ? provErr.message : 'Provider execution error';
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } finally {
    clearTimeout(timeout);
  }

  // 7. Store image to private user storage in 'chat-uploads'
  const storagePath = `${user.id}/images/${executionId}.png`;
  const { error: uploadErr } = await serviceClient.storage
    .from('chat-uploads')
    .upload(storagePath, imageBytes!, {
      contentType: 'image/png',
      upsert: true,
    });

  let displayUrl = '';
  if (!uploadErr) {
    const { data: signedData } = await serviceClient.storage
      .from('chat-uploads')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7); // 7-day signed access
    displayUrl = signedData?.signedUrl || '';
  }

  // 8. Ledger Accounting and Receipt Settlement
  const actualCost = estimatedCost;

  await serviceClient.rpc('px03_record_model_call', {
    p_execution_id: executionId,
    p_stage: 'image_generation',
    p_participant: 'primary',
    p_requested_model: modelId,
    p_resolved_model: modelId,
    p_served_model: modelId,
    p_status: 'completed',
    p_total_cost: actualCost,
    p_cost_status: 'settled',
  });

  await serviceClient.rpc('px03_finalize_execution', {
    p_execution_id: executionId,
    p_status: 'completed',
    p_terminal_outcome: 'completed',
    p_served_model: modelId,
  });

  await serviceClient.rpc('px05_commit_reservation', {
    p_execution_id: executionId,
    p_actual_usd: actualCost,
  });

  const finalResult = {
    success: true,
    imageUrl: displayUrl,
    storagePath,
    modelId,
    prompt,
    revisedPrompt,
    size,
    costUsd: actualCost,
    costStatus: 'settled',
    isMock: false,
    executionId,
    timestamp: new Date().toISOString(),
  };

  // 9. Persist message to conversation via service_role RPC
  if (body.conversationId) {
    await serviceClient.rpc('px28_record_image_message', {
      p_conversation_id: body.conversationId,
      p_content: revisedPrompt || prompt,
      p_model: modelId,
      p_image_result: finalResult,
      p_is_mock: false,
      p_user_id: user.id,
    });
  }

  return new Response(JSON.stringify(finalResult), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve((req: Request): Promise<Response> => handleImageGeneration(req));
