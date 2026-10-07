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

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

export interface UsageTracker {
  observe(payload: unknown): void;
  usage(): NormalizedUsage | null;
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
export function createUsageTracker(provider: Provider): UsageTracker {
  let input: number | null = null;
  let output: number | null = null;
  let thinking: number | null = null;

  const observe = (payload: unknown): void => {
    const data = asRecord(payload);
    if (!data) return;

    if (provider === 'anthropic') {
      if (data.type === 'message_start') {
        const usage = asRecord(asRecord(data.message)?.usage);
        if (usage) {
          input = nonNegativeInt(usage.input_tokens) ?? input;
          output = nonNegativeInt(usage.output_tokens) ?? output;
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

    if (provider === 'google') {
      const usage = asRecord(data.usageMetadata);
      if (usage) {
        input = nonNegativeInt(usage.promptTokenCount) ?? input;
        output = nonNegativeInt(usage.candidatesTokenCount) ?? output;
        thinking = nonNegativeInt(usage.thoughtsTokenCount) ?? thinking;
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
      inputTokens: input ?? 0,
      outputTokens: output ?? 0,
      thinkingTokens: thinking ?? 0,
    };
  };

  return { observe, usage };
}

function observeDataLine(line: string, tracker: UsageTracker): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return;
  const dataStr = trimmed.slice(5).trim();
  if (!dataStr || dataStr === '[DONE]') return;
  try {
    tracker.observe(JSON.parse(dataStr));
  } catch {
    // Ignore malformed frames; usage stays whatever was already observed.
  }
}

/**
 * Consumes a teed SSE branch, feeding every data frame to the tracker, and
 * resolves with the accumulated usage once the stream ends (or errors). Never
 * throws: a stream error yields whatever was observed so far.
 */
export async function consumeStreamUsage(
  body: ReadableStream<Uint8Array>,
  tracker: UsageTracker,
): Promise<NormalizedUsage | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) observeDataLine(line, tracker);
    }
    if (buffer.trim()) observeDataLine(buffer, tracker);
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
