// useStreamHandler.ts - Consumes a Prismatix SSE stream and returns content + cost metadata

import { estimateTokenCount } from '../costEngine';
import type { UsageEstimate } from '../costEngine';
import type { DebateParticipant } from '../types';
import type { TerminalReceipt } from '../../supabase/functions/_shared/execution_receipt';
import { createSseParser, isDoneData, type SseEvent } from '../sseParser';

export interface StreamChunkResult {
  assistantContent: string;
  thinkingLog: string[];
  streamedFinalUsd?: number;
  debateParticipants?: DebateParticipant[];
  receipt?: TerminalReceipt;
}

export interface StreamHandlerCallbacks {
  onFirstToken: () => void;
  onUsageUpdate: (usage: UsageEstimate) => void;
  onContentUpdate: (content: string, thinkingLog: string[]) => void;
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
      const { type: _type, ...body } = json;
      receipt = body as unknown as TerminalReceipt;
    }
  };

  const processEvents = (events: SseEvent[]) => {
    for (const event of events) {
      if (event.comment || isDoneData(event)) continue;
      if (!event.data) continue;
      try {
        handleJson(JSON.parse(event.data) as Record<string, unknown>);
      } catch {
        // Ignore malformed/partial JSON frames.
      }
    }
  };

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

    processEvents(parser.flush());
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

  return { assistantContent, thinkingLog, streamedFinalUsd, debateParticipants, receipt };
}
