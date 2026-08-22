import { describe, expect, it, vi } from 'vitest';
import { normalizeRouterRequestBody } from '../../supabase/functions/router/security_guards.ts';
import { createNormalizedProxyStream } from '../../supabase/functions/router/sse_normalizer.ts';

const VALID_CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';

describe('mobile memory isolation & stream cancellation', () => {
  it('normalizes platform=mobile request cleanly', () => {
    const result = normalizeRouterRequestBody({
      conversationId: VALID_CONVERSATION_ID,
      query: 'Hello from Prism',
      platform: 'mobile',
      history: [{ role: 'user', content: 'Previous local prompt' }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.platform).toBe('mobile');
    expect(result.value.query).toBe('Hello from Prism');
  });

  it('triggers onCancel when downstream proxy stream is cancelled', async () => {
    const onCancel = vi.fn();
    const onDelta = vi.fn();
    const onComplete = vi.fn();

    // Create a mock upstream readable stream that produces chunks
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });

    const proxyStream = createNormalizedProxyStream({
      upstreamBody,
      extractDeltas: (payload: any) => [payload.delta?.text || ''],
      onDelta,
      onComplete,
      onCancel,
    });

    const reader = proxyStream.getReader();

    // Enqueue one valid chunk
    const encoder = new TextEncoder();
    controller!.enqueue(
      encoder.encode('data: {"type":"content_block_delta","delta":{"text":"Chunk 1"}}\n\n'),
    );

    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(onDelta).toHaveBeenCalledWith('Chunk 1');

    // Downstream cancels stream
    await reader.cancel('User aborted request in Prism');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith('User aborted request in Prism');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
