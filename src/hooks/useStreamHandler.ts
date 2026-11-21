// useStreamHandler.ts - Consumes a Prismatix SSE stream and returns content + cost metadata

import { estimateTokenCount } from '../costEngine';
import type { UsageEstimate } from '../costEngine';
import type { DebateParticipant } from '../types';
import type { TerminalReceipt } from '../../supabase/functions/_shared/execution_receipt';
import { createSseParser, isDoneData, type SseEvent } from '../sseParser';

export type StreamTerminationStatus =
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'error';

export interface StreamChunkResult {
  assistantContent: string;
  thinkingLog: string[];
  streamedFinalUsd?: number;
  debateParticipants?: DebateParticipant[];
  receipt?: TerminalReceipt;
  terminationStatus: StreamTerminationStatus;
  isDoneReceived: boolean;
  error?: unknown;
}

export interface StreamHandlerCallbacks {
  onFirstToken: () => void;
  onUsageUpdate: (usage: UsageEstimate) => void;
  onContentUpdate: (content: string, thinkingLog: string[]) => void;
}

const RECEIPT_STATUSES = new Set(['completed', 'cancelled', 'failed', 'indeterminate', 'started']);
const SETTLEMENT_STATES = new Set(['settled', 'pending', 'released']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Treat the wire receipt as untrusted input: only settlement fields that are
 * internally consistent may reach UI code that records authoritative cost. */
function parseReceipt(value: unknown): TerminalReceipt | undefined {
  if (!isRecord(value)
    || typeof value.executionId !== 'string'
    || value.executionId.trim().length === 0
    || typeof value.status !== 'string'
    || !RECEIPT_STATUSES.has(value.status)
    || !Array.isArray(value.calls)
    || !isRecord(value.settlement)) return undefined;

  const { state, committedUsd, pendingCalls } = value.settlement;
  if (typeof state !== 'string' || !SETTLEMENT_STATES.has(state)
    || typeof pendingCalls !== 'number' || !Number.isSafeInteger(pendingCalls) || pendingCalls < 0) return undefined;

  // Older pending receipts may use null for an unknown amount. That is safe
  // only while state remains pending; normalize it to zero because consumers
  // must consult state before treating the amount as authoritative.
  const amount = committedUsd === null && state === 'pending' ? 0 : committedUsd;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0
    || (state === 'settled' && (pendingCalls !== 0 || value.calls.length === 0))
    || (state === 'settled' && value.calls.some((call) => !isRecord(call) || call.costStatus !== 'settled'))
    || (state === 'released' && (amount !== 0 || pendingCalls !== 0 || value.calls.length !== 0))) return undefined;

  const { type: _type, ...body } = value;
  const transcript = isRecord(body.transcript) && typeof body.transcript.saved === 'boolean'
    ? { saved: body.transcript.saved }
    : undefined;
  const { transcript: _untrustedTranscript, ...safeBody } = body;
  return {
    ...safeBody,
    settlement: { state, committedUsd: amount, pendingCalls },
    ...(transcript ? { transcript } : {}),
  } as unknown as TerminalReceipt;
}

/**
 * Reads SSE events from a ReadableStream produced by the Prismatix router.
 * Handles content_block_delta, thought, meta and receipt event types and calls
 * the provided callbacks for live UI updates. Parsing is delegated to the
 * shared SSE authority so the client and router agree on framing.
 *
 * The router sends debate participant data in the meta event under
 * json.debate_participants as a JSON array of DebateParticipant objects.
 *
 * When `signal` aborts (the user pressed Stop), the upstream reader is
 * cancelled and the function resolves with whatever was streamed so far.
 */
export async function readRouterStream(
  stream: ReadableStream<Uint8Array>,
  promptTokenEstimate: number,
  callbacks: StreamHandlerCallbacks,
  signal?: AbortSignal,
): Promise<StreamChunkResult> {
  const reader = stream.getReader();
  const parser = createSseParser();
  let assistantContent = '';
  const thinkingLog: string[] = [];
  let streamedFinalUsd: number | undefined;
  let debateParticipants: DebateParticipant[] | undefined;
  let receipt: TerminalReceipt | undefined;
  let isDoneReceived = false;
  let firstTokenReceived = false;
  let lastEmittedCompletion = 0;
  let lastEmittedThinking = 0;

  const onAbort = () => {
    void reader.cancel('client_aborted').catch(() => {});
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  const appendContent = (text: string) => {
    if (!text) return;
    assistantContent += text;
    if (!firstTokenReceived) {
      firstTokenReceived = true;
      callbacks.onFirstToken();
    }
  };

  const handleJson = (json: Record<string, unknown>) => {
    if (json.type === 'content_block_delta') {
      const delta = json.delta as { text?: unknown } | undefined;
      appendContent(typeof delta?.text === 'string' ? delta.text : '');
    } else if (json.type === 'thought') {
      const thoughtChunk = typeof json.chunk === 'string' ? json.chunk : '';
      if (thoughtChunk) {
        thinkingLog.push(thoughtChunk);
        callbacks.onUsageUpdate({
          promptTokens: promptTokenEstimate,
          completionTokens: estimateTokenCount(assistantContent),
          thinkingTokens: estimateTokenCount(thinkingLog.join('')),
        });
      }
    } else if (json.type === 'meta') {
      const cost = json.cost as { finalUsd?: unknown } | undefined;
      const usage = json.usage as { final_cost_usd?: unknown; cost_usd?: unknown } | undefined;
      const finalUsd = Number(cost?.finalUsd ?? usage?.final_cost_usd ?? usage?.cost_usd);
      if (Number.isFinite(finalUsd)) {
        streamedFinalUsd = finalUsd;
      }
      if (Array.isArray(json.debate_participants) && json.debate_participants.length > 0) {
        debateParticipants = json.debate_participants as DebateParticipant[];
      }
    } else if (json.type === 'receipt') {
      const parsed = parseReceipt(json);
      if (parsed) receipt = parsed;
    }
  };

  const processEvents = (events: SseEvent[]) => {
    for (const event of events) {
      if (event.comment) continue;
      if (isDoneData(event)) {
        isDoneReceived = true;
        continue;
      }
      if (!event.data) continue;
      try {
        handleJson(JSON.parse(event.data) as Record<string, unknown>);
      } catch {
        // Ignore malformed/partial JSON frames.
      }
    }
  };

  let streamError: unknown;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      processEvents(parser.push(value));

      const completionTokens = estimateTokenCount(assistantContent);
      const thinkingTokens = estimateTokenCount(thinkingLog.join(''));
      if (completionTokens !== lastEmittedCompletion || thinkingTokens !== lastEmittedThinking) {
        lastEmittedCompletion = completionTokens;
        lastEmittedThinking = thinkingTokens;
        callbacks.onUsageUpdate({
          promptTokens: promptTokenEstimate,
          completionTokens,
          thinkingTokens,
        });
      }

      callbacks.onContentUpdate(assistantContent, [...thinkingLog]);
    }
  } catch (err) {
    streamError = err;
  } finally {
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  // A valid final event may arrive without its blank-line delimiter when a
  // connection closes or fails. Flush it and notify the UI as well as the
  // returned result so useful trailing text does not disappear on screen.
  try {
    const previousContent = assistantContent;
    const previousThinkingCount = thinkingLog.length;
    processEvents(parser.flush());
    if (assistantContent !== previousContent || thinkingLog.length !== previousThinkingCount) {
      callbacks.onUsageUpdate({
        promptTokens: promptTokenEstimate,
        completionTokens: estimateTokenCount(assistantContent),
        thinkingTokens: estimateTokenCount(thinkingLog.join('')),
      });
      callbacks.onContentUpdate(assistantContent, [...thinkingLog]);
    }
  } catch (err) {
    streamError ??= err;
  }

  let terminationStatus: StreamTerminationStatus;
  if (signal?.aborted) {
    terminationStatus = 'cancelled';
  } else if (streamError) {
    terminationStatus = 'error';
  } else if (isDoneReceived) {
    terminationStatus = 'completed';
  } else {
    terminationStatus = 'interrupted';
  }

  return {
    assistantContent,
    thinkingLog,
    streamedFinalUsd,
    debateParticipants,
    receipt,
    terminationStatus,
    isDoneReceived,
    ...(streamError ? { error: streamError } : {}),
  };
}
