import { describe, expect, it } from 'vitest';
import { createNormalizedProxyStream } from '../../supabase/functions/router/sse_normalizer.ts';

describe('end-to-end cancellation semantics & abort propagation', () => {
  it('propagates downstream cancellation to upstream abort signal, halts generation, and cleans up slots', async () => {
    const abortController = new AbortController();
    let upstreamAborted = false;
    let slotReleasedCount = 0;
    let persistedMessageCount = 0;

    // Track upstream abort signal
    abortController.signal.addEventListener('abort', () => {
      upstreamAborted = true;
    });

    // Mock upstream stream that periodically produces chunks
    let upstreamController: ReadableStreamDefaultController<Uint8Array>;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(c) {
        upstreamController = c;
      },
      cancel() {
        upstreamAborted = true;
      },
    });

    const releaseStreamSlot = () => {
      slotReleasedCount++;
    };

    const encoder = new TextEncoder();
    const emittedDeltas: string[] = [];

    // Create normalized proxy stream with abort wiring
    const proxyStream = createNormalizedProxyStream({
      upstreamBody,
      extractDeltas: (payload: any) => [payload.delta?.text || ''],
      onDelta: (delta) => {
        emittedDeltas.push(delta);
      },
      onCancel: () => {
        abortController.abort();
      },
      onComplete: async () => {
        releaseStreamSlot();
        if (!abortController.signal.aborted) {
          persistedMessageCount++;
        }
      },
    });

    const reader = proxyStream.getReader();

    // 1. Upstream emits chunk 1
    upstreamController!.enqueue(
      encoder.encode('data: {"type":"content_block_delta","delta":{"text":"First part"}}\n\n'),
    );

    const chunk1 = await reader.read();
    expect(chunk1.done).toBe(false);
    expect(emittedDeltas).toEqual(['First part']);
    expect(abortController.signal.aborted).toBe(false);
    expect(upstreamAborted).toBe(false);

    // 2. Downstream client disconnects / cancels
    await reader.cancel('Client navigated away');

    // 3. Verify complete abort chain
    // (a) Abort signal must be true
    expect(abortController.signal.aborted).toBe(true);
    expect(upstreamAborted).toBe(true);

    // (b) Slot released exactly once
    expect(slotReleasedCount).toBe(1);

    // (c) No persistence of completed message because generation was aborted
    expect(persistedMessageCount).toBe(0);

    // (d) Further upstream attempts to write are rejected or ignored
    try {
      upstreamController!.enqueue(
        encoder.encode('data: {"type":"content_block_delta","delta":{"text":"Ignored"}}\n\n'),
      );
    } catch {
      // Expected if stream is closed
    }

    expect(emittedDeltas).toEqual(['First part']);
  });
});
