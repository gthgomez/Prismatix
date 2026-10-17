import { describe, expect, it, vi } from 'vitest';
import { readRouterStream, type StreamHandlerCallbacks } from './useStreamHandler';

function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });
}

function createErrorStream(beforeError: string[], error: Error): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < beforeError.length) {
        controller.enqueue(encoder.encode(beforeError[index++]));
      } else {
        controller.error(error);
      }
    },
  });
}

function makeCallbacks(): StreamHandlerCallbacks {
  return {
    onFirstToken: vi.fn(),
    onUsageUpdate: vi.fn(),
    onContentUpdate: vi.fn(),
  };
}

describe('useStreamHandler — readRouterStream', () => {
  it('handles a complete stream with deltas, meta, receipt, and [DONE]', async () => {
    const sse = [
      'data: {"type":"content_block_delta","delta":{"text":"Hello "}}\n\n',
      'data: {"type":"content_block_delta","delta":{"text":"world!"}}\n\n',
      'data: {"type":"meta","cost":{"finalUsd":0.00042}}\n\n',
      'data: {"type":"receipt","executionId":"ex-123","status":"completed","settlement":{"state":"settled","committedUsd":0.00042,"pendingCalls":0},"calls":[]}\n\n',
      'data: [DONE]\n\n',
    ];
    const stream = createMockStream(sse);
    const callbacks = makeCallbacks();

    const result = await readRouterStream(stream, 10, callbacks);

    expect(result.assistantContent).toBe('Hello world!');
    expect(result.streamedFinalUsd).toBe(0.00042);
    expect(result.receipt?.executionId).toBe('ex-123');
    expect(result.receipt?.settlement.state).toBe('settled');
    expect(result.isDoneReceived).toBe(true);
    expect(result.terminationStatus).toBe('completed');
    expect(callbacks.onFirstToken).toHaveBeenCalledTimes(1);
    expect(callbacks.onContentUpdate).toHaveBeenCalled();
  });

  it('detects early EOF as interrupted when stream closes without [DONE] or receipt', async () => {
    // Upstream abruptly closed the socket after partial tokens
    const sse = [
      'data: {"type":"content_block_delta","delta":{"text":"Partial thoughts..."}}\n\n',
    ];
    const stream = createMockStream(sse);
    const callbacks = makeCallbacks();

    const result = await readRouterStream(stream, 10, callbacks);

    expect(result.assistantContent).toBe('Partial thoughts...');
    expect(result.isDoneReceived).toBe(false);
    expect(result.receipt).toBeUndefined();
    expect(result.streamedFinalUsd).toBeUndefined();
    expect(result.terminationStatus).toBe('interrupted');
  });

  it('handles client cancellation via AbortSignal', async () => {
    const abortController = new AbortController();
    const sse = [
      'data: {"type":"content_block_delta","delta":{"text":"Will be stopped"}}\n\n',
    ];
    const stream = createMockStream(sse);
    const callbacks = makeCallbacks();

    // Abort before or during stream read
    abortController.abort();
    const result = await readRouterStream(stream, 10, callbacks, abortController.signal);

    expect(result.terminationStatus).toBe('cancelled');
  });

  it('tolerates malformed frames without dropping subsequent deltas', async () => {
    const sse = [
      'data: {"type":"content_block_delta","delta":{"text":"Valid 1 "}}\n\n',
      'data: {corrupted json frame\n\n',
      ': keepalive comment\n\n',
      'data: {"type":"content_block_delta","delta":{"text":"Valid 2"}}\n\n',
      'data: [DONE]\n\n',
    ];
    const stream = createMockStream(sse);
    const callbacks = makeCallbacks();

    const result = await readRouterStream(stream, 10, callbacks);

    expect(result.assistantContent).toBe('Valid 1 Valid 2');
    expect(result.isDoneReceived).toBe(true);
    expect(result.terminationStatus).toBe('completed');
  });

  it('captures transport read errors cleanly and preserves partial content', async () => {
    const stream = createErrorStream(
      ['data: {"type":"content_block_delta","delta":{"text":"Before drop."}}\n\n'],
      new Error('Transport connection reset'),
    );
    const callbacks = makeCallbacks();

    const result = await readRouterStream(stream, 10, callbacks);

    expect(result.assistantContent).toBe('Before drop.');
    expect(result.terminationStatus).toBe('error');
    expect(result.error).toBeDefined();
    expect((result.error as Error).message).toBe('Transport connection reset');
  });

  it('handles pending settlement receipts gracefully', async () => {
    const sse = [
      'data: {"type":"content_block_delta","delta":{"text":"Async task started"}}\n\n',
      'data: {"type":"receipt","executionId":"ex-async","status":"started","settlement":{"state":"pending","committedUsd":0,"pendingCalls":1},"calls":[]}\n\n',
      'data: [DONE]\n\n',
    ];
    const stream = createMockStream(sse);
    const callbacks = makeCallbacks();

    const result = await readRouterStream(stream, 10, callbacks);

    expect(result.assistantContent).toBe('Async task started');
    expect(result.receipt?.settlement.state).toBe('pending');
    expect(result.terminationStatus).toBe('completed');
  });

  it('marks early stream close as interrupted even when a receipt was emitted before [DONE]', async () => {
    const sse = [
      'data: {"type":"content_block_delta","delta":{"text":"Tokens before drop"}}\n\n',
      'data: {"type":"receipt","executionId":"ex-interrupted","status":"started","settlement":{"state":"settled","committedUsd":0.00015,"pendingCalls":0},"calls":[]}\n\n',
      // socket dropped abruptly without [DONE]
    ];
    const stream = createMockStream(sse);
    const callbacks = makeCallbacks();

    const result = await readRouterStream(stream, 10, callbacks);

    expect(result.assistantContent).toBe('Tokens before drop');
    expect(result.isDoneReceived).toBe(false);
    expect(result.receipt).toBeDefined();
    expect(result.receipt?.executionId).toBe('ex-interrupted');
    expect(result.receipt?.settlement.committedUsd).toBe(0.00015);
    // Transport termination is interrupted because [DONE] was never received
    expect(result.terminationStatus).toBe('interrupted');
  });

  it('preserves failed and indeterminate execution receipt outcomes independently of transport completion', async () => {
    const sse = [
      'data: {"type":"receipt","executionId":"ex-fail","status":"failed","terminalOutcome":"upstream_timeout","settlement":{"state":"released","committedUsd":0,"pendingCalls":0},"calls":[]}\n\n',
      'data: [DONE]\n\n',
    ];
    const stream = createMockStream(sse);
    const callbacks = makeCallbacks();

    const result = await readRouterStream(stream, 10, callbacks);

    expect(result.isDoneReceived).toBe(true);
    expect(result.terminationStatus).toBe('completed');
    expect(result.receipt?.status).toBe('failed');
    expect(result.receipt?.terminalOutcome).toBe('upstream_timeout');
    expect(result.receipt?.settlement.state).toBe('released');
  });
});
