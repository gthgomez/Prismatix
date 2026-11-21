import { describe, expect, it, vi } from 'vitest';
import { createAuthTimeoutFetch } from './authFetch';

describe('createAuthTimeoutFetch', () => {
  it('aborts a stalled auth response and exposes a retryable timeout reason', async () => {
    let seenSignal: AbortSignal | null | undefined;
    const stalledFetch: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
      seenSignal = init?.signal;
      seenSignal?.addEventListener('abort', () => reject(seenSignal?.reason), { once: true });
    });

    await expect(createAuthTimeoutFetch(stalledFetch, 5)('https://project.test/auth/v1/token', {}))
      .rejects.toMatchObject({
        name: 'TimeoutError',
        message: 'Authentication request timed out. Check your connection and try again.',
      });
    expect(seenSignal?.aborted).toBe(true);
  });

  it('keeps the deadline active while an auth response body is being read', async () => {
    let seenSignal: AbortSignal | null | undefined;
    const stalledBodyFetch: typeof fetch = async (_input, init) => {
      seenSignal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({
        start() {},
      }), { status: 200 });
    };

    await expect(createAuthTimeoutFetch(stalledBodyFetch, 5)('https://project.test/auth/v1/token', {}))
      .rejects.toMatchObject({ name: 'TimeoutError' });
    expect(seenSignal?.aborted).toBe(true);
  });

  it('does not expose a late successful response from a fetch implementation that ignores abort', async () => {
    let resolveLate!: (response: Response) => void;
    const ignoresAbort: typeof fetch = () => new Promise<Response>((resolve) => { resolveLate = resolve; });
    let returned = false;
    const request = createAuthTimeoutFetch(ignoresAbort, 5)('https://project.test/auth/v1/token', {})
      .then(() => { returned = true; });

    await expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
    resolveLate(new Response(JSON.stringify({ access_token: 'late-session' }), { status: 200 }));
    await Promise.resolve();
    expect(returned).toBe(false);
  });

  it('preserves caller cancellation and leaves non-auth requests untouched', async () => {
    const caller = new AbortController();
    const callerReason = new DOMException('Caller cancelled', 'AbortError');
    const fetchSpy = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const timedFetch = createAuthTimeoutFetch(fetchSpy, 1000);
    const authRequest = timedFetch('https://project.test/auth/v1/user', { signal: caller.signal });
    caller.abort(callerReason);
    await expect(authRequest).rejects.toBe(callerReason);

    const alreadyAborted = new AbortController();
    alreadyAborted.abort(callerReason);
    const callCount = fetchSpy.mock.calls.length;
    await expect(timedFetch('https://project.test/auth/v1/user', { signal: alreadyAborted.signal }))
      .rejects.toBe(callerReason);
    expect(fetchSpy).toHaveBeenCalledTimes(callCount);

    fetchSpy.mockResolvedValueOnce(new Response('ok'));
    await timedFetch('https://project.test/rest/v1/messages');
    expect(fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]?.[1]).toBeUndefined();
  });
});
