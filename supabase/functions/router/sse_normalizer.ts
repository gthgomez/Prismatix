// sse_normalizer.ts
// Normalizes an upstream provider SSE stream into the Prismatix client wire
// protocol. Shared between the router and tests.
//
// PX06 lifecycle contract (invariant 7 — a disconnect is never success):
//   * `onComplete` runs ONCE and ONLY on upstream completion.
//   * `onCancel`  runs ONCE and ONLY on downstream cancellation.
//   * `onError`   runs ONCE for a mid-stream upstream read error.
// A single-run guard makes every terminal path exclusive. `content_block_delta`
// JSON and the `data: [DONE]` terminator are unchanged for mobile clients; the
// `receipt` event is additive and emitted immediately before `[DONE]`.

import {
  createSseParser,
  encodeSseComment,
  encodeSseEvent,
  isDoneData,
  type SseEvent,
} from '../_shared/sse_parser.ts';
import type { TerminalReceipt } from '../_shared/execution_receipt.ts';

function tryParseJson(input: string): unknown | undefined {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

export interface NormalizedProxyStreamParams {
  upstreamBody: ReadableStream<Uint8Array>;
  extractDeltas: (payload: unknown) => string[];
  onDelta: (delta: string) => void;
  onComplete: () =>
    | Promise<{ receipt?: TerminalReceipt } | void>
    | { receipt?: TerminalReceipt }
    | void;
  onCancel?: (reason: unknown) => void | Promise<void>;
  onError?: (err: unknown) => void | Promise<void>;
  /** Heartbeat interval while waiting on upstream. Defaults to 15s. */
  heartbeatMs?: number;
}

export function createNormalizedProxyStream(
  params: NormalizedProxyStreamParams,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const parser = createSseParser();
  const heartbeatMs = params.heartbeatMs ?? 15_000;

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let heartbeatId: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  // Single-run guard: at most one of complete / cancel / error terminal path
  // ever runs. This is what forbids a disconnect finalizing as success.
  let terminalRan = false;

  const clearHeartbeat = () => {
    if (heartbeatId !== null) {
      clearInterval(heartbeatId);
      heartbeatId = null;
    }
  };

  const safeEnqueue = (chunk: string): void => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      closed = true;
    }
  };

  const emitDelta = (delta: string) => {
    if (!delta) return;
    params.onDelta(delta);
    // Byte-for-byte identical to the legacy wire shape.
    safeEnqueue(
      encodeSseEvent({
        data: JSON.stringify({ type: 'content_block_delta', delta: { text: delta } }),
      }),
    );
  };

  const handleEvent = (event: SseEvent): boolean => {
    if (event.comment) return false;
    if (isDoneData(event)) return true;
    const payload = tryParseJson(event.data);
    if (!payload) return false;
    const deltas = params.extractDeltas(payload);
    for (const delta of deltas) emitDelta(delta);
    return false;
  };

  const runComplete = async (): Promise<void> => {
    if (terminalRan) return;
    terminalRan = true;
    clearHeartbeat();
    let result: { receipt?: TerminalReceipt } | void;
    try {
      result = await params.onComplete();
    } catch (err) {
      // The upstream already completed; a completion-side failure must still
      // terminate the client stream rather than hang it.
      console.error('[sse_normalizer] onComplete failed:', err);
      result = undefined;
    }
    const receipt = result && typeof result === 'object' ? result.receipt : undefined;
    if (receipt) {
      safeEnqueue(encodeSseEvent({ data: JSON.stringify({ type: 'receipt', ...receipt }) }));
    }
    safeEnqueue(encodeSseEvent({ data: '[DONE]' }));
    closed = true;
    if (controller) {
      try {
        controller.close();
      } catch {
        // already closed
      }
    }
  };

  const runCancel = async (reason: unknown): Promise<void> => {
    if (terminalRan) return;
    terminalRan = true;
    clearHeartbeat();
    // The client is gone: emit nothing, and NEVER finalize as complete.
    try {
      await params.onCancel?.(reason);
    } catch (err) {
      console.error('[sse_normalizer] onCancel failed:', err);
    }
    try {
      if (reader) await reader.cancel(reason);
    } catch {
      // ignore
    }
  };

  const runError = async (err: unknown): Promise<void> => {
    if (terminalRan) return;
    terminalRan = true;
    clearHeartbeat();
    closed = true;
    if (controller) {
      try {
        controller.error(err);
      } catch {
        // already errored/closed
      }
    }
    // Await the router's terminal handling so a reclaimed isolate cannot drop
    // the settlement/finalize (mirrors runComplete awaiting onComplete).
    try {
      await params.onError?.(err);
    } catch (onErrorErr) {
      console.error('[sse_normalizer] onError failed:', onErrorErr);
    }
  };

  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
      reader = params.upstreamBody.getReader();

      if (heartbeatMs > 0 && Number.isFinite(heartbeatMs)) {
        heartbeatId = setInterval(() => {
          safeEnqueue(encodeSseComment('keepalive'));
        }, heartbeatMs);
      }

      (async () => {
        let doneSeen = false;
        try {
          for (;;) {
            const { done, value } = await reader!.read();
            if (done) break;
            if (!value) continue;
            for (const event of parser.push(value)) {
              if (handleEvent(event)) {
                doneSeen = true;
                break;
              }
            }
            if (doneSeen) break;
          }
          if (!doneSeen) {
            for (const event of parser.flush()) {
              handleEvent(event);
            }
          }
          // Upstream completion is the ONLY path to onComplete.
          await runComplete();
        } catch (err) {
          await runError(err);
        }
      })();
    },
    async cancel(reason) {
      await runCancel(reason);
    },
  });
}
