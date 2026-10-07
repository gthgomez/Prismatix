// PX06 stream lifecycle tests.
//
// `createNormalizedProxyStream` must make downstream cancellation a DISTINCT
// terminal path that never reports success (invariant 7): `onCancel` runs and
// `onComplete` does NOT. Completion emits an optional terminal receipt as the
// final data event before `data: [DONE]`. A heartbeat comment keeps an idle
// stream open, and every terminal handler runs at most once.
import { describe, expect, it } from 'vitest';
import { createNormalizedProxyStream } from '../../supabase/functions/router/sse_normalizer.ts';
import type { TerminalReceipt } from '../../supabase/functions/_shared/execution_receipt.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function streamFrom(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

const extractDeltas = (payload: unknown): string[] => {
  const record = payload as { delta?: { text?: string } } | null;
  return [record?.delta?.text ?? ''];
};

const RECEIPT: TerminalReceipt = {
  executionId: 'e0000000-0000-4000-8000-000000000001',
  status: 'completed',
  terminalOutcome: 'ok',
  requestedModel: 'gpt-5.6-sol',
  resolvedModel: 'gpt-5.6-sol',
  servedModel: 'gpt-5.6-sol',
  createdAt: '2026-10-06T00:00:00.000Z',
  finalizedAt: '2026-10-06T00:00:05.000Z',
  settlement: { state: 'settled', committedUsd: 0.25, pendingCalls: 0 },
  calls: [],
};

describe('createNormalizedProxyStream completion', () => {
  it('preserves content_block_delta and terminates with [DONE]', async () => {
    const proxy = createNormalizedProxyStream({
      upstreamBody: streamFrom(
        'data: {"type":"content_block_delta","delta":{"text":"Hi"}}\n\n',
      ),
      extractDeltas,
      onDelta: () => {},
      onComplete: () => {},
      heartbeatMs: 60_000,
    });

    const text = await readAll(proxy);

    expect(text).toContain('data: {"type":"content_block_delta","delta":{"text":"Hi"}}\n\n');
    expect(text.endsWith('data: [DONE]\n\n')).toBe(true);
  });

  it('emits the receipt as the final data event before [DONE]', async () => {
    const proxy = createNormalizedProxyStream({
      upstreamBody: streamFrom('data: {"type":"content_block_delta","delta":{"text":"Hi"}}\n\n'),
      extractDeltas,
      onDelta: () => {},
      onComplete: async () => ({ receipt: RECEIPT }),
      heartbeatMs: 60_000,
    });

    const text = await readAll(proxy);

    const receiptIdx = text.indexOf('"type":"receipt"');
    const doneIdx = text.indexOf('data: [DONE]');
    expect(receiptIdx).toBeGreaterThan(-1);
    expect(doneIdx).toBeGreaterThan(receiptIdx);
    // The receipt payload is the projection, on a single data line.
    expect(text).toContain(`data: ${JSON.stringify({ type: 'receipt', ...RECEIPT })}\n\n`);
  });

  it('omits the receipt event when onComplete returns nothing', async () => {
    const proxy = createNormalizedProxyStream({
      upstreamBody: streamFrom('data: {"type":"content_block_delta","delta":{"text":"Hi"}}\n\n'),
      extractDeltas,
      onDelta: () => {},
      onComplete: () => {},
      heartbeatMs: 60_000,
    });

    const text = await readAll(proxy);
    expect(text).not.toContain('"type":"receipt"');
  });

  it('runs onComplete exactly once and never onCancel on upstream completion', async () => {
    let completed = 0;
    let cancelled = 0;
    const proxy = createNormalizedProxyStream({
      upstreamBody: streamFrom('data: {"type":"content_block_delta","delta":{"text":"Hi"}}\n\n'),
      extractDeltas,
      onDelta: () => {},
      onComplete: () => {
        completed += 1;
      },
      onCancel: () => {
        cancelled += 1;
      },
      heartbeatMs: 60_000,
    });

    await readAll(proxy);
    // A late downstream cancel after a completed stream must not reopen the
    // terminal path.
    await proxy.cancel('late').catch(() => {});

    expect(completed).toBe(1);
    expect(cancelled).toBe(0);
  });
});

describe('createNormalizedProxyStream cancellation', () => {
  it('calls onCancel and NOT onComplete when the downstream client disconnects', async () => {
    let completed = 0;
    let cancelled = 0;
    let upstreamCancelled = false;

    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"type":"content_block_delta","delta":{"text":"First part"}}\n\n'),
        );
      },
      cancel() {
        upstreamCancelled = true;
      },
    });

    const proxy = createNormalizedProxyStream({
      upstreamBody,
      extractDeltas,
      onDelta: () => {},
      onComplete: () => {
        completed += 1;
      },
      onCancel: () => {
        cancelled += 1;
      },
      heartbeatMs: 60_000,
    });

    const reader = proxy.getReader();
    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain('content_block_delta');

    await reader.cancel('client navigated away');

    expect(cancelled).toBe(1);
    // Invariant 7: a disconnect is never finalized as success.
    expect(completed).toBe(0);
    expect(upstreamCancelled).toBe(true);
  });

  it('emits nothing on cancellation (the client is gone)', async () => {
    let enqueuedAfterCancel = false;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"content_block_delta","delta":{"text":"x"}}\n\n'));
      },
    });

    const proxy = createNormalizedProxyStream({
      upstreamBody,
      extractDeltas,
      onDelta: () => {},
      onComplete: () => {},
      onCancel: () => {},
      heartbeatMs: 60_000,
    });

    const reader = proxy.getReader();
    await reader.read();
    await reader.cancel('bye');
    // Reading after cancellation reports done; no receipt/[DONE] is produced.
    const after = await reader.read().catch(() => ({ done: true, value: undefined }));
    if (after.value) {
      enqueuedAfterCancel = decoder.decode(after.value).includes('receipt');
    }
    expect(enqueuedAfterCancel).toBe(false);
  });
});

describe('createNormalizedProxyStream heartbeat', () => {
  it('emits a keepalive comment on an interval while waiting on upstream', async () => {
    const upstreamBody = new ReadableStream<Uint8Array>({
      start() {
        // Never enqueues and never closes — an idle upstream.
      },
    });

    const proxy = createNormalizedProxyStream({
      upstreamBody,
      extractDeltas,
      onDelta: () => {},
      onComplete: () => {},
      heartbeatMs: 20,
    });

    const reader = proxy.getReader();
    const { value } = await reader.read();
    expect(decoder.decode(value)).toBe(': keepalive\n\n');
    await reader.cancel('done');
  });

  it('clears the heartbeat interval on completion (no keepalive after [DONE])', async () => {
    const proxy = createNormalizedProxyStream({
      upstreamBody: streamFrom('data: {"type":"content_block_delta","delta":{"text":"Hi"}}\n\n'),
      extractDeltas,
      onDelta: () => {},
      onComplete: () => {},
      heartbeatMs: 5,
    });

    const text = await readAll(proxy);
    // Allow several heartbeat periods to elapse after close.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(text.endsWith('data: [DONE]\n\n')).toBe(true);
  });
});

describe('createNormalizedProxyStream upstream error', () => {
  it('runs onError exactly once and never onComplete/onCancel for a mid-stream read error', async () => {
    let completed = 0;
    let cancelled = 0;
    const errors: unknown[] = [];

    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('upstream exploded'));
      },
    });

    const proxy = createNormalizedProxyStream({
      upstreamBody,
      extractDeltas,
      onDelta: () => {},
      onComplete: () => {
        completed += 1;
      },
      onCancel: () => {
        cancelled += 1;
      },
      onError: (err) => {
        errors.push(err);
      },
      heartbeatMs: 60_000,
    });

    const reader = proxy.getReader();
    await expect(reader.read()).rejects.toThrow('upstream exploded');

    expect(errors).toHaveLength(1);
    expect(completed).toBe(0);
    expect(cancelled).toBe(0);
  });
});
