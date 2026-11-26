// usage.ts - PX05 best-effort provider usage extraction.
//
// The router must settle priced calls from what the provider ACTUALLY reports.
// This module is a small, dependency-injected seam that:
//   * observes provider SSE/structured payloads and accumulates the reported
//     usage (Anthropic message_start/message_delta, Google usageMetadata,
//     OpenAI-compatible `usage`), and
//   * consumes a teed SSE branch to return the final usage without blocking the
//     client stream.
//
// It NEVER invents usage: when a provider reports nothing, `usage()` returns
// null and the caller keeps the call pending (the execution-level bounded
// estimate handles that case separately). Deno-free and unit-testable.

import type { Provider } from './router_logic.ts';
import type { InferenceProtocol } from '../_shared/serving_routes.ts';
import { createSseParser, isDoneData } from '../_shared/sse_parser.ts';

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
}

export interface UsageTracker {
  observe(payload: unknown): void;
  usage(): NormalizedUsage | null;
  servedModel?(): string | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/**
 * Creates a provider-aware usage accumulator. Only fields the provider actually
 * reports are recorded; absent fields stay null and `usage()` returns null when
 * nothing at all was reported.
 */
export function createUsageTracker(provider: Provider, protocol?: InferenceProtocol): UsageTracker {
  let input: number | null = null;
  let output: number | null = null;
  let thinking: number | null = null;
  let cachedRead: number | null = null;
  let cachedWrite: number | null = null;
  let servedModel: string | undefined;

  const observe = (payload: unknown): void => {
    const data = asRecord(payload);
    if (!data) return;
    const model = data.model ?? data.modelVersion ?? asRecord(data.response)?.model ?? asRecord(data.message)?.model;
    if (typeof model === 'string' && /^[A-Za-z0-9._:/-]{1,250}$/.test(model)) servedModel = model;

    if (protocol === 'anthropic_messages' || provider === 'anthropic' || (provider === 'opencode' &&
      (data.type === 'message_start' || data.type === 'message_delta'))) {
      if (data.type === 'message_start') {
        const usage = asRecord(asRecord(data.message)?.usage);
        if (usage) {
          input = nonNegativeInt(usage.input_tokens) ?? input;
          output = nonNegativeInt(usage.output_tokens) ?? output;
          cachedRead = nonNegativeInt(usage.cache_read_input_tokens) ?? cachedRead;
          cachedWrite = nonNegativeInt(usage.cache_creation_input_tokens) ?? cachedWrite;
        }
      } else if (data.type === 'message_delta') {
        const usage = asRecord(data.usage);
        if (usage) {
          output = nonNegativeInt(usage.output_tokens) ?? output;
          input = nonNegativeInt(usage.input_tokens) ?? input;
        }
      }
      return;
    }

    if (protocol === 'google_generate_content' || provider === 'google' || (provider === 'opencode' && data.usageMetadata)) {
      const usage = asRecord(data.usageMetadata);
      if (usage) {
        input = nonNegativeInt(usage.promptTokenCount) ?? input;
        output = nonNegativeInt(usage.candidatesTokenCount) ?? output;
        thinking = nonNegativeInt(usage.thoughtsTokenCount) ?? thinking;
        cachedRead = nonNegativeInt(usage.cachedContentTokenCount) ?? cachedRead;
      }
      return;
    }

    if ((protocol === 'responses' || provider === 'opencode') &&
        (data.type === 'response.completed' || data.type === 'response.incomplete')) {
      const usage = asRecord(asRecord(data.response)?.usage);
      if (usage) {
        input = nonNegativeInt(usage.input_tokens) ?? input;
        cachedRead = nonNegativeInt(asRecord(usage.input_tokens_details)?.cached_tokens) ?? cachedRead;
        const completion = nonNegativeInt(usage.output_tokens);
        if (completion !== null) {
          const reasoning = nonNegativeInt(asRecord(usage.output_tokens_details)?.reasoning_tokens) ?? 0;
          output = Math.max(0, completion - reasoning);
          thinking = reasoning;
        }
      }
      return;
    }

    // openai / opencode / nvidia / deepinfra: OpenAI-compatible `usage`.
    const usage = asRecord(data.usage);
    if (usage) {
      const prompt = nonNegativeInt(usage.prompt_tokens);
      const completion = nonNegativeInt(usage.completion_tokens);
      const reasoning = nonNegativeInt(asRecord(usage.completion_tokens_details)?.reasoning_tokens);
      if (prompt !== null) input = prompt;
      cachedRead = nonNegativeInt(asRecord(usage.prompt_tokens_details)?.cached_tokens) ?? cachedRead;
      if (completion !== null) {
        // Reasoning tokens are a SUBSET of completion tokens: keep them separate
        // so cost computation never bills the reasoning portion twice.
        const reasoningTokens = reasoning ?? 0;
        output = Math.max(0, completion - reasoningTokens);
        thinking = reasoningTokens;
      }
    }
  };

  const usage = (): NormalizedUsage | null => {
    if (input === null && output === null && thinking === null) return null;
    return {
      inputTokens: (input ?? 0) + ((protocol === 'anthropic_messages' || provider === 'anthropic')
        ? (cachedRead ?? 0) + (cachedWrite ?? 0) : 0),
      ...(cachedRead !== null ? { cachedReadTokens: cachedRead } : {}),
      ...(cachedWrite !== null ? { cachedWriteTokens: cachedWrite } : {}),
      outputTokens: output ?? 0,
      thinkingTokens: thinking ?? 0,
    };
  };

  return { observe, usage, servedModel: () => servedModel };
}

/**
 * Consumes a teed SSE branch, feeding every data frame to the tracker, and
 * resolves with the accumulated usage once the stream ends (or errors). Never
 * throws: a stream error yields whatever was observed so far.
 *
 * Parsing is delegated to the shared SSE authority (`createSseParser`) so the
 * router and the browser client agree on framing (CRLF/CR/LF, multi-line data,
 * comments). This remains best-effort: malformed frames are ignored and no
 * usage is ever invented.
 */
export async function consumeStreamUsage(
  body: ReadableStream<Uint8Array>,
  tracker: UsageTracker,
): Promise<NormalizedUsage | null> {
  const reader = body.getReader();
  const parser = createSseParser();
  const observeEvents = (events: ReturnType<typeof parser.push>): void => {
    for (const event of events) {
      if (event.comment || isDoneData(event)) continue;
      if (!event.data) continue;
      try {
        tracker.observe(JSON.parse(event.data));
      } catch {
        // Ignore malformed frames; usage stays whatever was already observed.
      }
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      observeEvents(parser.push(value));
    }
    observeEvents(parser.flush());
  } catch {
    // Stream error: return whatever usage was observed before the failure.
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  return tracker.usage();
}

/**
 * Extracts usage from a non-streaming Google `generateContent` response body
 * (SMD skeptic/synth stages). Returns null when no usage is reported.
 */
export function extractGoogleStructuredUsage(responseText: string): NormalizedUsage | null {
  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    return null;
  }
  const tracker = createUsageTracker('google');
  tracker.observe(payload);
  return tracker.usage();
}
