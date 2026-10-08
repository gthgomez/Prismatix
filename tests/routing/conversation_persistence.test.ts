// @vitest-environment node
// PX07 conversation persistence (real router handler).
//
// Proves the durable message-persistence contract end to end against the REAL
// router entrypoint (Deno.serve stub seam, as in PX06 tests):
//   * the user turn is persisted BEFORE any provider dispatch, with the user's
//     ORIGINAL query as content (never the memory/video-expanded effectiveQuery);
//   * a pre-inference persist failure fails CLOSED: 503 transcript_unavailable,
//     the reservation is released, and ZERO provider calls happen;
//   * an idempotent replay (`inserted: false`) still proceeds, and a genuine
//     (execution_id, role) conflict (SQLSTATE PT409) is rejected;
//   * a post-inference assistant persist failure still completes the stream but
//     reports `transcript.saved = false` on the terminal receipt.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectReceipt } from '../../supabase/functions/_shared/execution_receipt.ts';

const ROUTER_ENTRY = ['../../supabase/functions/router/index.ts'].join('');
const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = 'px07-test-service-role-key';
const ANTHROPIC_KEY = 'px07-test-anthropic-key';
const USER_TOKEN = 'px07-user-token';

const SUBJECT = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const EXECUTION_ID = 'e0000000-0000-4000-8000-0000000000dd';
const IMAGE_ORDINAL_REF = {
  ordinal: 1,
  kind: 'image' as const,
  storageRef: `supabase://chat-uploads/${SUBJECT}/1700000000_photo.png`,
  videoAssetId: null,
  available: true,
};

const BASE_ROUTER_ENV: Record<string, string> = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  ANTHROPIC_API_KEY: ANTHROPIC_KEY,
};

const PROVIDER_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'opencode.ai',
  'api.nvidia.com',
];

interface ServeHandler {
  (req: Request): Promise<Response>;
}

interface FetchCall {
  url: string;
  method: string;
  body: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetchRecorder(
  routes: (call: FetchCall) => Response | null,
): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    let url: string;
    let method: string;
    if (typeof input === 'string') {
      url = input;
      method = init?.method ?? 'GET';
    } else if (input instanceof URL) {
      url = input.href;
      method = init?.method ?? 'GET';
    } else {
      url = input.url;
      method = init?.method ?? input.method;
    }
    const body = typeof init?.body === 'string' ? init.body : '';
    const call = { url, method: method.toUpperCase(), body };
    calls.push(call);
    return routes(call) ?? jsonResponse(null);
  });
  return calls;
}

function installDenoStub(env: Record<string, string | undefined>): ServeHandler[] {
  const handlers: ServeHandler[] = [];
  (globalThis as unknown as Record<string, unknown>).Deno = {
    env: { get: (key: string): string | undefined => env[key] },
    serve: (handler: ServeHandler): void => {
      handlers.push(handler);
    },
  };
  return handlers;
}

async function loadRouterHandler(
  env: Record<string, string | undefined>,
): Promise<ServeHandler> {
  vi.resetModules();
  const handlers = installDenoStub(env);
  await import(/* @vite-ignore */ ROUTER_ENTRY);
  const handler = handlers[0];
  if (!handler) throw new Error('router handler was not registered');
  return handler;
}

function providerCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => PROVIDER_HOSTS.some((host) => call.url.includes(host)));
}

function findCall(calls: FetchCall[], needle: string): number {
  return calls.findIndex((call) => call.url.includes(needle));
}

function persistBodies(calls: FetchCall[]): Array<Record<string, unknown>> {
  return calls
    .filter((call) => call.url.includes('/rpc/px07_persist_message'))
    .map((call) => JSON.parse(call.body) as Record<string, unknown>);
}

const STREAM_BODY =
  'data: {"type":"message_start","message":{"id":"m"}}\n\n' +
  'data: {"type":"content_block_delta","delta":{"text":"durable answer"}}\n\n';

function grantRow(): Record<string, unknown> {
  return {
    subject_id: SUBJECT,
    role: 'user',
    enabled: true,
    allowed_features: ['chat'],
    max_daily_usd: '5.000000',
    max_per_execution_usd: '1.000000',
    created_at: '2026-10-06T00:00:00.000Z',
    updated_at: '2026-10-06T00:00:00.000Z',
    updated_by: null,
  };
}

function executionRow(): Record<string, unknown> {
  return {
    id: EXECUTION_ID,
    subject_id: SUBJECT,
    conversation_id: CONVERSATION_ID,
    client_request_key: 'px07-key',
    payload_hash: 'px07-hash',
    status: 'started',
    requested_mode: null,
    requested_model: null,
    resolved_model: null,
    served_model: null,
    route_version: null,
    pricing_version: null,
    catalog_version: null,
    terminal_outcome: null,
    created_at: '2026-10-06T00:00:00.000Z',
    updated_at: '2026-10-06T00:00:00.000Z',
  };
}

function receiptPayload(): Record<string, unknown> {
  return {
    execution: {
      id: EXECUTION_ID,
      status: 'completed',
      terminal_outcome: 'ok',
      requested_model: null,
      resolved_model: null,
      served_model: null,
      created_at: '2026-10-06T00:00:00.000Z',
      updated_at: '2026-10-06T00:00:05.000Z',
    },
    calls: [
      {
        stage: 'baseline',
        participant: 'anthropic',
        attempt_number: 1,
        served_model: null,
        cost_status: 'settled',
        total_cost: 0.01,
      },
    ],
    reservation: { state: 'committed', committed_usd: 0.01 },
  };
}

/**
 * Base route table for a mobile (memory-bypassed) request. `persist` receives
 * the parsed px07 RPC body and may return a Response or null to fall through to
 * the default success stub.
 */
function makeRoutes(
  persist: (body: Record<string, unknown>, call: FetchCall) => Response | null,
): (call: FetchCall) => Response | null {
  return (call) => {
    if (call.url.includes('/auth/v1/user')) {
      return jsonResponse({ id: SUBJECT, aud: 'authenticated', role: 'authenticated' });
    }
    if (call.url.includes('/rest/v1/rpc/get_access_grant')) return jsonResponse(grantRow());
    if (call.url.includes('/rest/v1/conversations')) {
      return jsonResponse({ user_id: SUBJECT, total_tokens: 0 });
    }
    if (call.url.includes('/rest/v1/user_memories')) return jsonResponse([]);
    if (call.url.includes('/rest/v1/conversation_memory_state')) return jsonResponse(null);
    if (call.url.includes('/rest/v1/messages')) return jsonResponse([]);
    if (call.url.includes('/rest/v1/cost_logs')) return jsonResponse([]);
    if (call.url.includes('/rest/v1/rpc/px03_create_execution')) {
      return jsonResponse({ execution: executionRow(), reused: false });
    }
    if (call.url.includes('/rest/v1/rpc/px05_admit_execution')) {
      return jsonResponse({
        admitted: true,
        reason: 'admitted',
        reservation_id: 'r0000000-0000-4000-8000-0000000000dd',
        lease_id: 'l0000000-0000-4000-8000-0000000000dd',
        retry_after_seconds: 0,
        remaining_usd: '1.5',
      });
    }
    if (call.url.includes('/rest/v1/rpc/px07_persist_message')) {
      const body = JSON.parse(call.body) as Record<string, unknown>;
      const custom = persist(body, call);
      if (custom) return custom;
      return jsonResponse({
        message_id: body.p_role === 'assistant' ? 'msg-assistant' : 'msg-user',
        inserted: true,
      });
    }
    if (call.url.includes('/rest/v1/rpc/px03_record_model_call')) {
      return jsonResponse({
        id: 'c0000000-0000-4000-8000-0000000000dd',
        execution_id: EXECUTION_ID,
        stage: 'baseline',
        participant: 'anthropic',
        attempt_number: 1,
        status: 'streaming',
        input_tokens: 0,
        output_tokens: 0,
        thinking_tokens: 0,
        input_cost: 0,
        output_cost: 0,
        thinking_cost: 0,
        total_cost: 0,
        cost_status: 'pending',
      });
    }
    if (call.url.includes('/rest/v1/rpc/px05_commit_from_ledger')) {
      return jsonResponse({
        state: 'committed',
        updated: true,
        reservation_id: 'r0000000-0000-4000-8000-0000000000dd',
        committed_usd: '0.01',
        pending_calls: 0,
      });
    }
    if (call.url.includes('/rest/v1/rpc/px05_release_reservation')) {
      return jsonResponse({ state: 'released', updated: true, committed_usd: '0' });
    }
    if (call.url.includes('/rest/v1/rpc/px03_finalize_execution')) {
      return jsonResponse({ execution: { id: EXECUTION_ID, status: 'completed' }, finalized: true });
    }
    if (call.url.includes('/rest/v1/rpc/px03_get_execution_receipt')) {
      return jsonResponse(receiptPayload());
    }
    if (call.url.includes('api.anthropic.com')) {
      return new Response(STREAM_BODY, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return null;
  };
}

function routerRequest(body: unknown): Request {
  return new Request('http://127.0.0.1:54321/functions/v1/router', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${USER_TOKEN}`,
    },
    body: JSON.stringify({ platform: 'mobile', history: [], ...body as object }),
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

function receiptFromStream(text: string): Record<string, unknown> | undefined {
  const match = text.match(/data: (\{"type":"receipt".*?\})\n\n/);
  return match ? (JSON.parse(match[1]!) as Record<string, unknown>) : undefined;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PX07 user persist before dispatch', () => {
  it('persists the ORIGINAL query with owned attachments and ordinals, before any provider call', async () => {
    const calls = installFetchRecorder(makeRoutes(() => null));
    const handler = await loadRouterHandler({ ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest({
        conversationId: CONVERSATION_ID,
        query: 'Hello from Prism',
        attachmentRefs: [IMAGE_ORDINAL_REF],
        modelOverride: 'anthropic:haiku',
      }),
    );

    expect(res.status).toBe(200);
    const persisted = persistBodies(calls);
    const userPersist = persisted.find((body) => body.p_role === 'user');
    expect(userPersist).toBeTruthy();
    // The persisted content is the original query, never the effective prompt.
    expect(userPersist!.p_content).toBe('Hello from Prism');
    expect(String(userPersist!.p_content)).not.toContain('Current request:');
    // The attachment ordinal is preserved (this was the second draft item).
    expect(userPersist!.p_attachments).toEqual([IMAGE_ORDINAL_REF]);
    expect(userPersist!.p_legacy_image_url).toBe(IMAGE_ORDINAL_REF.storageRef);

    // Persist before dispatch.
    const persistIdx = findCall(calls, '/rpc/px07_persist_message');
    const providerIdx = findCall(calls, 'api.anthropic.com');
    expect(persistIdx).toBeGreaterThanOrEqual(0);
    expect(providerIdx).toBeGreaterThan(persistIdx);

    await readAll(res.body!);
  });

  it('drops a foreign image ref rather than persisting another subject path', async () => {
    const calls = installFetchRecorder(makeRoutes(() => null));
    const handler = await loadRouterHandler({ ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest({
        conversationId: CONVERSATION_ID,
        query: 'Hello',
        attachmentRefs: [
          {
            ordinal: 0,
            kind: 'image',
            storageRef: 'supabase://chat-uploads/99999999-9999-4999-8999-999999999999/a.png',
            videoAssetId: null,
            available: true,
          },
        ],
        modelOverride: 'anthropic:haiku',
      }),
    );

    expect(res.status).toBe(200);
    const userPersist = persistBodies(calls).find((body) => body.p_role === 'user');
    expect(userPersist!.p_attachments).toEqual([]);
    await readAll(res.body!);
  });
});

describe('PX07 pre-inference persistence failure', () => {
  it('returns 503 transcript_unavailable, releases the reservation, and calls ZERO providers', async () => {
    const calls = installFetchRecorder(
      makeRoutes((body) =>
        body.p_role === 'user'
          ? jsonResponse({ code: '08006', message: 'persist down' }, 500)
          : null,
      ),
    );
    const handler = await loadRouterHandler({ ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest({
        conversationId: CONVERSATION_ID,
        query: 'Hello',
        modelOverride: 'anthropic:haiku',
      }),
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'transcript_unavailable',
      code: 'transcript_unavailable',
    });
    expect(providerCalls(calls)).toEqual([]);
    expect(findCall(calls, '/rpc/px05_release_reservation')).toBeGreaterThanOrEqual(0);
  });

  it('rejects a genuine (execution_id, role) conflict (PT409) with 503 and zero provider calls', async () => {
    const calls = installFetchRecorder(
      makeRoutes((body) =>
        body.p_role === 'user'
          ? jsonResponse({ code: 'PT409', message: 'message_conflict' }, 409)
          : null,
      ),
    );
    const handler = await loadRouterHandler({ ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest({
        conversationId: CONVERSATION_ID,
        query: 'Hello',
        modelOverride: 'anthropic:haiku',
      }),
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'transcript_unavailable' });
    expect(providerCalls(calls)).toEqual([]);
  });
});

describe('PX07 idempotent replay', () => {
  it('proceeds (no duplicate turn) when the user turn is already durably recorded', async () => {
    const calls = installFetchRecorder(
      makeRoutes((body) =>
        body.p_role === 'user'
          ? jsonResponse({ message_id: 'msg-user', inserted: false })
          : null,
      ),
    );
    const handler = await loadRouterHandler({ ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest({
        conversationId: CONVERSATION_ID,
        query: 'Hello again',
        modelOverride: 'anthropic:haiku',
      }),
    );

    expect(res.status).toBe(200);
    const userPersists = persistBodies(calls).filter((body) => body.p_role === 'user');
    expect(userPersists).toHaveLength(1);
    expect(providerCalls(calls)).toHaveLength(1);
    await readAll(res.body!);
  });
});

describe('PX07 post-inference assistant persistence failure', () => {
  it('still completes the stream but reports transcript.saved = false', async () => {
    const calls = installFetchRecorder(
      makeRoutes((body) =>
        body.p_role === 'assistant'
          ? jsonResponse({ code: '08006', message: 'assistant persist down' }, 500)
          : null,
      ),
    );
    const handler = await loadRouterHandler({ ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest({
        conversationId: CONVERSATION_ID,
        query: 'Hello',
        modelOverride: 'anthropic:haiku',
      }),
    );

    expect(res.status).toBe(200);
    const text = await readAll(res.body!);
    expect(text).toContain('[DONE]');
    const receipt = receiptFromStream(text);
    expect(receipt).toBeTruthy();
    expect(receipt!.transcript).toEqual({ saved: false });
    // Billing/execution truth is unchanged: the execution still completed.
    expect(receipt!.status).toBe('completed');
    // A durable reconciliation job records the lost transcript.
    expect(findCall(calls, 'px03_enqueue_reconciliation')).toBeGreaterThanOrEqual(0);
  });

  it('reports transcript.saved = true when the assistant turn persists', async () => {
    installFetchRecorder(makeRoutes(() => null));
    const handler = await loadRouterHandler({ ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest({
        conversationId: CONVERSATION_ID,
        query: 'Hello',
        modelOverride: 'anthropic:haiku',
      }),
    );

    const receipt = receiptFromStream(await readAll(res.body!));
    expect(receipt!.transcript).toEqual({ saved: true });
  });
});

describe('projectReceipt transcript passthrough', () => {
  it('passes an optional transcript marker through unchanged', () => {
    const receipt = projectReceipt({
      execution: {
        id: EXECUTION_ID,
        status: 'completed',
        terminal_outcome: 'ok',
        requested_model: null,
        resolved_model: null,
        served_model: null,
        created_at: '2026-10-06T00:00:00.000Z',
        updated_at: '2026-10-06T00:00:05.000Z',
      },
      calls: [],
      reservation: { state: 'released', committed_usd: 0 },
      transcript: { saved: false },
    });
    expect(receipt.transcript).toEqual({ saved: false });
  });

  it('omits the transcript marker when absent', () => {
    const receipt = projectReceipt({
      execution: {
        id: EXECUTION_ID,
        status: 'completed',
        terminal_outcome: 'ok',
        requested_model: null,
        resolved_model: null,
        served_model: null,
        created_at: '2026-10-06T00:00:00.000Z',
        updated_at: '2026-10-06T00:00:05.000Z',
      },
      calls: [],
      reservation: { state: 'released', committed_usd: 0 },
    });
    expect('transcript' in receipt).toBe(false);
  });
});
