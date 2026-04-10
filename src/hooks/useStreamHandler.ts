// useStreamHandler.ts - Consumes a Prismatix SSE stream and returns content + cost metadata

import { estimateTokenCount } from '../costEngine';
import type { UsageEstimate } from '../costEngine';

export interface StreamChunkResult {
  assistantContent: string;
  thinkingLog: string[];
  streamedFinalUsd?: number;
}

export interface StreamHandlerCallbacks {
  onFirstToken: () => void;
  onUsageUpdate: (usage: UsageEstimate) => void;
  onContentUpdate: (content: string, thinkingLog: string[]) => void;
}

/**
 * Reads SSE lines from a ReadableStream produced by the Prismatix router.
 * Handles content_block_delta, thought, and meta event types.
 * Calls the provided callbacks for live UI updates.
 */
export async function readRouterStream(
  stream: ReadableStream<Uint8Array>,
  promptTokenEstimate: number,
  callbacks: StreamHandlerCallbacks,
): Promise<StreamChunkResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let assistantContent = '';
  const thinkingLog: string[] = [];
  let streamedFinalUsd: number | undefined;
  let firstTokenReceived = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          if (line.startsWith('data: ')) {
            const json = JSON.parse(line.slice(6));
            if (json.type === 'content_block_delta') {
              const deltaText = json.delta?.text || '';
              if (deltaText) {
                assistantContent += deltaText;
                if (!firstTokenReceived) {
                  firstTokenReceived = true;
                  callbacks.onFirstToken();
                }
              }
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
              const finalUsd = Number(
                json.cost?.finalUsd ?? json.usage?.final_cost_usd ?? json.usage?.cost_usd,
              );
              if (Number.isFinite(finalUsd)) {
                streamedFinalUsd = finalUsd;
              }
            }
          } else if (!line.startsWith('event:')) {
            if (line) {
              assistantContent += line;
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                callbacks.onFirstToken();
              }
            }
          }
        } catch {
          // Ignore partial JSON
        }
      }

      callbacks.onUsageUpdate({
        promptTokens: promptTokenEstimate,
        completionTokens: estimateTokenCount(assistantContent),
        thinkingTokens: estimateTokenCount(thinkingLog.join('')),
      });

      callbacks.onContentUpdate(assistantContent, [...thinkingLog]);
    }
  } finally {
    reader.releaseLock();
  }

  return { assistantContent, thinkingLog, streamedFinalUsd };
}
