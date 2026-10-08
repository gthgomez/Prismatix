import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({
  CONFIG: {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    ROUTER_ENDPOINT: 'https://project.supabase.co/functions/v1/router',
  },
}));

const { getSessionMock, signOutMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      signOut: signOutMock,
    },
  },
}));

import { askPrismatix, DuplicateRequestError, resetConversation } from './smartFetch';

function createJwt(iss: string): string {
  const enc = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ iss })}.sig`;
}

function makeStream(content: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(content));
      controller.close();
    },
  });
}

function okResponse(): Response {
  return new Response(makeStream('data: {"type":"meta"}\n\n'), {
    status: 200,
    headers: { 'X-Router-Model': 'deepseek-v4-pro' },
  });
}

describe('PX07 smartFetch continuity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    resetConversation();
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: createJwt('https://project.supabase.co/auth/v1') } },
      error: null,
    });
    signOutMock.mockResolvedValue(undefined);
  });

  it('sends a stable x-client-request-id and reuses it on the 401 retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 401 }))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const result = await askPrismatix('Hello');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstHeaders = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const secondHeaders = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    const firstId = firstHeaders['x-client-request-id'];
    expect(firstId).toBeTruthy();
    expect(secondHeaders['x-client-request-id']).toBe(firstId);
    expect(result?.clientRequestId).toBe(firstId);
  });

  it('throws a DuplicateRequestError carrying the execution id for 409 duplicate_request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'duplicate_request',
          code: 'duplicate_request',
          executionId: 'e0000000-0000-4000-8000-000000000001',
        }),
        { status: 409 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const promise = askPrismatix('Hello');
    await expect(promise).rejects.toBeInstanceOf(DuplicateRequestError);
    await promise.catch((error: DuplicateRequestError) => {
      expect(error.executionId).toBe('e0000000-0000-4000-8000-000000000001');
    });
  });

  it('surfaces request_key_conflict as a plain error (never a silent reload)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'request_key_conflict', code: 'request_key_conflict' }),
        { status: 409 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const error = await askPrismatix('Hello').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DuplicateRequestError);
    expect((error as Error).message).toBe('request_key_conflict');
  });
});
