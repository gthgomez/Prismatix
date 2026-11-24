export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

function isAuthRequest(input: RequestInfo | URL): boolean {
  const value = typeof Request !== 'undefined' && input instanceof Request
    ? input.url
    : input.toString();
  try {
    return new URL(value, 'http://localhost').pathname.startsWith('/auth/v1/');
  } catch {
    return false;
  }
}

/** Abort stalled Supabase Auth requests before auth-js can persist a late session. */
export function createAuthTimeoutFetch(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
): typeof fetch {
  return async (input, init) => {
    if (!isAuthRequest(input)) return fetchImpl(input, init);

    const controller = new AbortController();
    const requestSignal = init?.signal
      ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const abortFromController = () => rejectAbort(controller.signal.reason
      ?? new DOMException('Authentication request was cancelled.', 'AbortError'));
    controller.signal.addEventListener('abort', abortFromController, { once: true });
    const abortFromRequest = () => controller.abort(requestSignal?.reason
      ?? new DOMException('Authentication request was cancelled.', 'AbortError'));
    if (requestSignal?.aborted) {
      abortFromRequest();
    } else {
      requestSignal?.addEventListener('abort', abortFromRequest, { once: true });
    }

    const timeout = setTimeout(() => {
      controller.abort(new DOMException(
        'Authentication request timed out. Check your connection and try again.',
        'TimeoutError',
      ));
    }, timeoutMs);

    try {
      if (controller.signal.aborted) await aborted;
      const response = await Promise.race([
        fetchImpl(input, { ...init, signal: controller.signal }),
        aborted,
      ]);
      // Supabase auth-js reads JSON after fetch resolves. Buffer the small auth
      // response while the deadline is active so a stalled body cannot hang it.
      const body = await Promise.race([response.arrayBuffer(), aborted]);
      if (controller.signal.aborted) await aborted;
      const headers = new Headers(response.headers);
      // Fetch exposes decoded body bytes, so transport-level encoding and
      // length headers from the original response are no longer applicable.
      headers.delete('content-encoding');
      headers.delete('content-length');
      return new Response(body.byteLength ? body : null, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', abortFromController);
      requestSignal?.removeEventListener('abort', abortFromRequest);
    }
  };
}
