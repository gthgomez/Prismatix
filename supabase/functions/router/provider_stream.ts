import { trustedInferenceEndpoint } from '../_shared/provider_endpoint.ts';
import type { ServingRoute } from '../_shared/serving_routes.ts';
import {
  buildAnthropicStreamPayload,
  buildGoogleStreamPayload,
  buildOpenAILegacyStreamPayload,
  buildOpenAIStreamPayload,
  buildResponsesStreamPayload,
  type GeminiFlashThinkingLevel,
} from './provider_payloads.ts';
import { createStubRoutingDebug, type ImageAttachment, type Message, type RouteDecision } from './router_logic.ts';

interface StreamRequest {
  route: ServingRoute;
  apiKey: string;
  messages: Message[];
  images: ImageAttachment[];
  outputCap: number;
  signal: AbortSignal;
  getEnv: (key: string) => string | undefined;
  fetchFn?: typeof fetch;
  sessionId?: string;
  geminiThinkingLevel?: GeminiFlashThinkingLevel;
}

function record(payload: unknown): Record<string, unknown> | undefined {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : undefined;
}

function text(value: unknown): string[] {
  return typeof value === 'string' && value ? [value] : [];
}

function chatDeltas(payload: unknown): string[] {
  const data = record(payload);
  if (data?.error) throw new Error('provider_stream_failed');
  if (!Array.isArray(data?.choices)) return [];
  return data.choices.flatMap((choice) => {
    const content = record(record(choice)?.delta)?.content;
    return Array.isArray(content) ? content.flatMap((part) => text(record(part)?.text)) : text(content);
  });
}

function responsesDeltas(payload: unknown): string[] {
  const data = record(payload);
  if (data?.type === 'error' || data?.type === 'response.failed') throw new Error('provider_stream_failed');
  return data?.type === 'response.output_text.delta' ? text(data.delta) : [];
}

function messagesDeltas(payload: unknown): string[] {
  const data = record(payload);
  if (data?.type === 'error') throw new Error('provider_stream_failed');
  return data?.type === 'content_block_delta' ? text(record(data.delta)?.text) : [];
}

function googleDeltas(payload: unknown): string[] {
  const data = record(payload);
  if (data?.error) throw new Error('provider_stream_failed');
  if (!Array.isArray(data?.candidates)) return [];
  return data.candidates.flatMap((candidate) => {
    const parts = record(record(candidate)?.content)?.parts;
    return Array.isArray(parts) ? parts.flatMap((part) => {
      const data = record(part);
      return data?.thought === true ? [] : text(data?.text);
    }) : [];
  });
}

export function openRouterPriceControls(route: ServingRoute) {
  return {
    allow_fallbacks: false,
    require_parameters: true,
    max_price: {
      prompt: route.tariff.inputPerMillion,
      completion: route.tariff.outputPerMillion,
      request: route.tariff.requestUsd ?? 0,
      image: 0,
    },
  };
}

/** Translates one exact route into one credential-bearing request. */
export async function dispatchServingRoute(request: StreamRequest) {
  const { route, apiKey, messages, images, outputCap, signal } = request;
  const endpoint = trustedInferenceEndpoint(route, request.getEnv);
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' });
  if (route.provider === 'anthropic') headers.set('x-api-key', apiKey);
  else if (route.provider === 'google') headers.set('x-goog-api-key', apiKey);
  else headers.set('Authorization', `Bearer ${apiKey}`);
  if (route.protocol === 'anthropic_messages') headers.set('anthropic-version', '2023-06-01');
  if (route.provider === 'openrouter') headers.set('X-Title', 'Prismatix');
  if (route.provider === 'opencode' || route.provider === 'opencode_go') {
    headers.set('User-Agent', 'Prismatix/1.0');
    if (request.sessionId) headers.set('x-opencode-session', request.sessionId);
  }

  const decision: RouteDecision = {
    provider: route.provider, model: route.upstreamId, modelTier: route.canonicalId, budgetCap: outputCap,
    complexityScore: 0, rationaleTag: 'provider-dispatch', routingDebug: createStubRoutingDebug(0, 'provider-dispatch'),
  };
  let body: Record<string, unknown>;
  let extractDeltas: (payload: unknown) => string[];
  switch (route.protocol) {
    case 'responses':
      body = buildResponsesStreamPayload(decision, messages, images);
      extractDeltas = responsesDeltas;
      break;
    case 'anthropic_messages':
      body = buildAnthropicStreamPayload(decision, messages, images);
      extractDeltas = messagesDeltas;
      break;
    case 'google_generate_content':
      body = buildGoogleStreamPayload(decision, messages, images, false, request.geminiThinkingLevel ?? 'high');
      if (route.upstreamId === 'gemini-2.5-flash' && request.geminiThinkingLevel) {
        // Gemini 2.5 uses a token budget, while newer families use thinking levels.
        const thinkingBudget = request.geminiThinkingLevel === 'low' ? 0 : Math.min(1024, Math.floor(outputCap / 2));
        body.generationConfig = { maxOutputTokens: outputCap, thinkingConfig: { thinkingBudget } };
      }
      extractDeltas = googleDeltas;
      break;
    case 'chat_completions': {
      const includeUsage = ['openai', 'openrouter', 'commandcode'].includes(route.provider);
      body = route.provider === 'openai'
        ? buildOpenAIStreamPayload(decision, messages, images, includeUsage)
        : buildOpenAILegacyStreamPayload(decision, messages, images, includeUsage);
      if (route.provider === 'openrouter') body.provider = openRouterPriceControls(route);
      extractDeltas = chatDeltas;
      break;
    }
  }
  const response = await (request.fetchFn ?? fetch)(endpoint, {
    method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error',
  });
  if (route.protocol === 'responses') {
    let terminal = false;
    return {
      response, effectiveModelId: route.upstreamId, isComplete: () => terminal,
      extractDeltas: (payload: unknown) => {
        const type = record(payload)?.type;
        terminal ||= type === 'response.completed' || type === 'response.incomplete';
        return extractDeltas(payload);
      },
    };
  }
  return { response, extractDeltas, effectiveModelId: route.upstreamId };
}
