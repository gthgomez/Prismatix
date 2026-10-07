// @vitest-environment node
// PX06 terminal receipt projection + authenticated lookup tests.
//
// `projectReceipt` is a pure projection over the PX03 execution ledger
// (`executions`, `model_calls`) and the PX05 reservation. `loadExecutionReceipt`
// talks to the service-role-only `px03_get_execution_receipt` RPC.
//
// The final describe invokes the REAL router handler (Deno.serve stub seam, as
// in tests/integration/deployment-contract.test.ts) to prove the authenticated
// `{ action: 'execution_receipt' }` contract: owned → 200 receipt, unknown or
// foreign → 404, missing id → 400, zero provider calls, no entitlement check.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TERMINAL_EXECUTION_STATUSES,
  projectReceipt,
  type RawReceiptCall,
  type RawReceiptExecution,
  type RawReceiptReservation,
} from '../../supabase/functions/_shared/execution_receipt.ts';
import {
  ExecutionStoreError,
  loadExecutionReceipt,
  type ExecutionStoreClient,
  type ExecutionStoreRpcResponse,
} from '../../supabase/functions/router/execution_store.ts';

// PX06 final-review: inject a deterministic synchronous throw in the response
// HEADER region (after admission, outside the upstream try/catch) so the outer
// catch/timeout path can be exercised. `buildDebateHeaders` is called only while
// building the stream response headers.
const debateHeaderInject = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock('../../supabase/functions/router/debate_runtime.ts', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../supabase/functions/router/debate_runtime.ts')
  >();
  return {
    ...actual,
    buildDebateHeaders: (
      params: Parameters<typeof actual.buildDebateHeaders>[0],
    ): ReturnType<typeof actual.buildDebateHeaders> => {
      if (debateHeaderInject.shouldThrow) {
        throw new Error('injected post-admission header failure');
      }
      return actual.buildDebateHeaders(params);
    },
  };
});

const SUBJECT = '11111111-1111-4111-8111-111111111111';

function execution(overrides: Partial<RawReceiptExecution> = {}): RawReceiptExecution {
  return {
    id: 'e0000000-0000-4000-8000-000000000001',
    status: 'completed',
    terminal_outcome: 'ok',
    requested_model: 'gpt-5.6-sol',
    resolved_model: 'gpt-5.6-sol',
    served_model: 'gpt-5.6-sol',
    created_at: '2026-10-06T00:00:00.000Z',
    updated_at: '2026-10-06T00:00:05.000Z',
    ...overrides,
  };
}

function call(overrides: Partial<RawReceiptCall> = {}): RawReceiptCall {
  return {
    stage: 'baseline',
    participant: 'anthropic',
    attempt_number: 1,
    served_model: 'claude-5-haiku',
    cost_status: 'settled',
    total_cost: 0.25,
    ...overrides,
  };
}

function reservation(overrides: Partial<RawReceiptReservation> = {}): RawReceiptReservation {
  return { state: 'committed', committed_usd: 0.25, ...overrides };
}

describe('projectReceipt', () => {
  it('projects a settled execution with its finalized timestamp', () => {
    const receipt = projectReceipt({
      execution: execution(),
      calls: [call()],
      reservation: reservation(),
    });

    expect(receipt).toEqual({
      executionId: 'e0000000-0000-4000-8000-000000000001',
      status: 'completed',
      terminalOutcome: 'ok',
      requestedModel: 'gpt-5.6-sol',
      resolvedModel: 'gpt-5.6-sol',
      servedModel: 'gpt-5.6-sol',
      createdAt: '2026-10-06T00:00:00.000Z',
      finalizedAt: '2026-10-06T00:00:05.000Z',
      settlement: { state: 'settled', committedUsd: 0.25, pendingCalls: 0 },
      calls: [
        {
          stage: 'baseline',
          participant: 'anthropic',
          attemptNumber: 1,
          servedModel: 'claude-5-haiku',
          costStatus: 'settled',
          totalCost: 0.25,
        },
      ],
    });
  });

  it('reports pending when any call is not settled (never $0-as-settled)', () => {
    const receipt = projectReceipt({
      execution: execution({ status: 'indeterminate', terminal_outcome: 'aborted' }),
      calls: [call(), call({ participant: 'openai', cost_status: 'pending', total_cost: 0 })],
      reservation: reservation({ committed_usd: 0 }),
    });

    expect(receipt.settlement.state).toBe('pending');
    expect(receipt.settlement.pendingCalls).toBe(1);
    // Money is still reported from the reservation (here the retained hold).
    expect(receipt.settlement.committedUsd).toBe(0);
    // A terminal status has a finalizedAt; indeterminate is terminal.
    expect(receipt.finalizedAt).toBe('2026-10-06T00:00:05.000Z');
  });

  it('reports released only for zero calls with a released reservation', () => {
    const receipt = projectReceipt({
      execution: execution({ status: 'cancelled', terminal_outcome: 'client_cancelled' }),
      calls: [],
      reservation: reservation({ state: 'released', committed_usd: 0 }),
    });

    expect(receipt.settlement).toEqual({ state: 'released', committedUsd: 0, pendingCalls: 0 });
    expect(receipt.calls).toEqual([]);
  });

  it('reports pending (never settled $0) for zero calls with a held/pending_reconcile reservation', () => {
    for (const state of ['held', 'pending_reconcile'] as const) {
      const receipt = projectReceipt({
        execution: execution({ status: 'cancelled', terminal_outcome: 'client_cancelled' }),
        calls: [],
        reservation: reservation({ state, committed_usd: 0 }),
      });
      expect(receipt.settlement).toEqual({ state: 'pending', committedUsd: 0, pendingCalls: 0 });
    }
  });

  it('reports pending for zero calls with no reservation row at all', () => {
    const receipt = projectReceipt({
      execution: execution({ status: 'started', terminal_outcome: null }),
      calls: [],
      reservation: null,
    });

    expect(receipt.settlement).toEqual({ state: 'pending', committedUsd: 0, pendingCalls: 0 });
  });

  it('falls back to the settled call sum when there is no reservation', () => {
    const receipt = projectReceipt({
      execution: execution(),
      calls: [call({ total_cost: 0.1 }), call({ participant: 'openai', total_cost: 0.2 })],
      reservation: null,
    });

    expect(receipt.settlement.state).toBe('settled');
    expect(receipt.settlement.committedUsd).toBeCloseTo(0.3, 6);
  });

  it('falls back to the settled call sum when the reservation committed_usd is null', () => {
    const receipt = projectReceipt({
      execution: execution(),
      calls: [call({ total_cost: 0.1 }), call({ participant: 'openai', total_cost: 0.2 })],
      reservation: reservation({ state: 'committed', committed_usd: null }),
    });

    expect(receipt.settlement.state).toBe('settled');
    expect(receipt.settlement.committedUsd).toBeCloseTo(0.3, 6);
  });

  it('coerces numeric(12,6) strings from PostgREST', () => {
    const receipt = projectReceipt({
      execution: execution(),
      calls: [call({ total_cost: '0.123456' })],
      reservation: reservation({ committed_usd: '0.123456' }),
    });

    expect(receipt.settlement.committedUsd).toBeCloseTo(0.123456, 6);
    expect(receipt.calls[0]!.totalCost).toBeCloseTo(0.123456, 6);
  });

  it('reports finalizedAt null while the execution is not terminal', () => {
    const receipt = projectReceipt({
      execution: execution({ status: 'started', terminal_outcome: null }),
      calls: [],
      reservation: null,
    });

    expect(receipt.status).toBe('started');
    expect(receipt.finalizedAt).toBeNull();
  });

  it('only treats completed/cancelled/failed/indeterminate as terminal', () => {
    expect([...TERMINAL_EXECUTION_STATUSES].sort()).toEqual([
      'cancelled',
      'completed',
      'failed',
      'indeterminate',
    ]);
  });
});

// ---------------------------------------------------------------------------
// loadExecutionReceipt — service-role RPC loader
// ---------------------------------------------------------------------------

interface FakeReceiptClient {
  client: ExecutionStoreClient;
  calls: Array<{ fn: string; params: Record<string, unknown> }>;
}

function fakeReceiptClient(
  responder: (fn: string, params: Record<string, unknown>) => ExecutionStoreRpcResponse,
): FakeReceiptClient {
  const calls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      rpc(fn: string, params: Record<string, unknown> = {}): PromiseLike<ExecutionStoreRpcResponse> {
        calls.push({ fn, params });
        return Promise.resolve(responder(fn, params));
      },
    },
  };
}

describe('loadExecutionReceipt', () => {
  it('calls the px03 receipt RPC with the subject + execution id and projects the payload', async () => {
    const fake = fakeReceiptClient(() => ({
      data: { execution: execution(), calls: [call()], reservation: reservation() },
      error: null,
    }));

    const receipt = await loadExecutionReceipt(fake.client, SUBJECT, 'e0000000-0000-4000-8000-000000000001');

    expect(fake.calls).toEqual([
      {
        fn: 'px03_get_execution_receipt',
        params: {
          p_subject_id: SUBJECT,
          p_execution_id: 'e0000000-0000-4000-8000-000000000001',
        },
      },
    ]);
    expect(receipt?.executionId).toBe('e0000000-0000-4000-8000-000000000001');
    expect(receipt?.settlement.state).toBe('settled');
  });

  it('returns null when the RPC returns null (unknown OR not owned by the subject)', async () => {
    const fake = fakeReceiptClient(() => ({ data: null, error: null }));

    await expect(
      loadExecutionReceipt(fake.client, SUBJECT, 'e0000000-0000-4000-8000-000000000099'),
    ).resolves.toBeNull();
  });

  it('fails closed with a typed error when the ledger RPC errors', async () => {
    const fake = fakeReceiptClient(() => ({
      data: null,
      error: { code: '08006', message: 'ledger down' },
    }));

    await expect(
      loadExecutionReceipt(fake.client, SUBJECT, 'e0000000-0000-4000-8000-000000000001'),
    ).rejects.toBeInstanceOf(ExecutionStoreError);
  });
});

// ---------------------------------------------------------------------------
// Router action: { action: 'execution_receipt', executionId }
// ---------------------------------------------------------------------------

const ROUTER_ENTRY = ['../../supabase/functions/router/index.ts'].join('');
const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = 'px06-test-service-role-key';
const ANTHROPIC_KEY = 'px06-test-anthropic-key';
const USER_TOKEN = 'px06-user-token';
const FOREIGN_EXECUTION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

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
  'api.deepinfra.com',
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
  routes?: (call: FetchCall) => Response | null,
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
    const routed = routes ? routes(call) : null;
    return routed ?? jsonResponse(null);
  });
  return calls;
}

function installDenoStub(env: Record<string, string | undefined>): ServeHandler[] {
  const handlers: ServeHandler[] = [];
  (globalThis as unknown as Record<string, unknown>).Deno = {
    env: {
      get: (key: string): string | undefined => env[key],
    },
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

function routerRequest(body: unknown): Request {
  return new Request('http://127.0.0.1:54321/functions/v1/router', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${USER_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

function providerCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => PROVIDER_HOSTS.some((host) => call.url.includes(host)));
}

function ownedPayload(): Record<string, unknown> {
  return {
    execution: execution(),
    calls: [call()],
    reservation: reservation(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("action execution_receipt (real router handler)", () => {
  function receiptRoutes(receipt: unknown): (call: FetchCall) => Response | null {
    return (call) => {
      if (call.url.includes('/auth/v1/user')) {
        return jsonResponse({
          id: SUBJECT,
          aud: 'authenticated',
          role: 'authenticated',
          email: 'px06@example.test',
        });
      }
      if (call.url.includes('/rest/v1/rpc/px03_get_execution_receipt')) {
        return jsonResponse(receipt);
      }
      return null;
    };
  }

  it('requires authentication (401 without a valid token)', async () => {
    installFetchRecorder((call) =>
      call.url.includes('/auth/v1/user')
        ? jsonResponse({ code: 401, msg: 'invalid token' }, 401)
        : null,
    );
    const handler = await loadRouterHandler({ ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest({ action: 'execution_receipt', executionId: FOREIGN_EXECUTION_ID }),
    );

    expect(res.status).toBe(401);
  });

  it('returns 400 when executionId is missing', async () => {
    const calls = installFetchRecorder(receiptRoutes(ownedPayload()));
    const handler = await loadRouterHandler({ ...BASE_ROUTER_ENV });

    const res = await handler(routerRequest({ action: 'execution_receipt' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Bad Request: executionId required' });
    // No ledger lookup for a malformed request.
    expect(calls.some((call) => call.url.includes('px03_get_execution_receipt'))).toBe(false);
  });

  it('returns 400 invalid_execution_id for a non-UUID id before calling the RPC', async () => {
    const calls = installFetchRecorder(receiptRoutes(ownedPayload()));
    const handler = await loadRouterHandler({ ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest({ action: 'execution_receipt', executionId: 'not-a-uuid' }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_execution_id' });
    // The malformed id must never reach Postgres as a cast error (503).
    expect(calls.some((call) => call.url.includes('px03_get_execution_receipt'))).toBe(false);
    expect(providerCalls(calls)).toEqual([]);
  });

  it('returns the projected receipt for an owned execution WITHOUT requiring an entitlement', async () => {
    const calls = installFetchRecorder(receiptRoutes(ownedPayload()));
    const handler = await loadRouterHandler({ ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest({ action: 'execution_receipt', executionId: execution().id }),
    );

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.executionId).toBe(execution().id);
    expect(payload.status).toBe('completed');
    expect(payload.settlement).toEqual({ state: 'settled', committedUsd: 0.25, pendingCalls: 0 });

    // Read-only accounting view: entitlement gate is never consulted.
    expect(calls.some((call) => call.url.includes('get_access_grant'))).toBe(false);
    // Zero provider calls.
    expect(providerCalls(calls)).toEqual([]);
  });

  it('returns 404 for an unknown or foreign-subject execution (existence never leaked)', async () => {
    const calls = installFetchRecorder(receiptRoutes(null));
    const handler = await loadRouterHandler({ ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest({ action: 'execution_receipt', executionId: FOREIGN_EXECUTION_ID }),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'execution_not_found' });
    expect(providerCalls(calls)).toEqual([]);
  });

  it('fails closed with 503 when the receipt ledger lookup errors', async () => {
    const calls = installFetchRecorder((call) => {
      if (call.url.includes('/auth/v1/user')) {
        return jsonResponse({ id: SUBJECT, aud: 'authenticated', role: 'authenticated' });
      }
      if (call.url.includes('/rest/v1/rpc/px03_get_execution_receipt')) {
        return jsonResponse({ code: '08006', message: 'ledger down' }, 500);
      }
      return null;
    });
    const handler = await loadRouterHandler({ ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest({ action: 'execution_receipt', executionId: execution().id }),
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'accounting_unavailable',
      code: 'accounting_unavailable',
    });
    expect(providerCalls(calls)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PX06 fix round 1, finding 1: a client disconnect that rejects the upstream
// read must finalize `cancelled`, not `indeterminate`.
// ---------------------------------------------------------------------------

const STREAM_EXECUTION_ID = 'e0000000-0000-4000-8000-0000000000aa';
const STREAM_CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

function streamGrantRow(): Record<string, unknown> {
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

describe('PX06 finding 1: abort-driven upstream error finalizes cancelled', () => {
  it('finalizes cancelled/client_cancelled when a disconnect rejects the upstream read', async () => {
    // Silence the intentional error-path logging for clean output.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    let upstreamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        upstreamController = controller;
        controller.enqueue(
          encoder.encode('data: {"type":"content_block_delta","delta":{"text":"partial"}}\n\n'),
        );
        // Stay open: the disconnect/error below is the terminal event.
      },
    });

    const finalizeBodies: Array<Record<string, unknown>> = [];
    const calls = installFetchRecorder((call) => {
      if (call.url.includes('/auth/v1/user')) {
        return jsonResponse({ id: SUBJECT, aud: 'authenticated', role: 'authenticated' });
      }
      if (call.url.includes('/rest/v1/rpc/get_access_grant')) {
        return jsonResponse(streamGrantRow());
      }
      if (call.url.includes('/rest/v1/conversations')) {
        return jsonResponse({ user_id: SUBJECT, total_tokens: 0 });
      }
      if (call.url.includes('/rest/v1/cost_logs')) return jsonResponse([]);
      if (call.url.includes('/rest/v1/user_memories')) return jsonResponse([]);
      if (call.url.includes('/rest/v1/conversation_memory_state')) return jsonResponse(null);
      if (call.url.includes('/rest/v1/messages')) return jsonResponse([]);
      if (call.url.includes('/rest/v1/rpc/px03_create_execution')) {
        return jsonResponse({
          execution: {
            id: STREAM_EXECUTION_ID,
            subject_id: SUBJECT,
            conversation_id: STREAM_CONVERSATION_ID,
            client_request_key: 'px06-disconnect-key',
            payload_hash: 'px06-disconnect-hash',
            status: 'started',
            requested_mode: null,
            requested_model: 'haiku-4.5',
            resolved_model: null,
            served_model: null,
            route_version: null,
            pricing_version: null,
            catalog_version: null,
            terminal_outcome: null,
            created_at: '2026-10-06T00:00:00.000Z',
            updated_at: '2026-10-06T00:00:00.000Z',
          },
          reused: false,
        });
      }
      if (call.url.includes('/rest/v1/rpc/px03_record_model_call')) {
        return jsonResponse({
          id: 'c0000000-0000-4000-8000-0000000000aa',
          execution_id: STREAM_EXECUTION_ID,
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
      if (call.url.includes('/rest/v1/rpc/px05_admit_execution')) {
        return jsonResponse({
          admitted: true,
          reason: 'admitted',
          reservation_id: 'r0000000-0000-4000-8000-0000000000aa',
          lease_id: 'l0000000-0000-4000-8000-0000000000aa',
          retry_after_seconds: 0,
          remaining_usd: '1.5',
        });
      }
      if (call.url.includes('/rest/v1/rpc/px05_commit_from_ledger')) {
        return jsonResponse({
          state: 'pending_reconcile',
          updated: true,
          reservation_id: 'r0000000-0000-4000-8000-0000000000aa',
          committed_usd: '0',
          pending_calls: 1,
        });
      }
      if (call.url.includes('/rest/v1/rpc/px03_finalize_execution')) {
        finalizeBodies.push(JSON.parse(call.body) as Record<string, unknown>);
        return jsonResponse({ execution: { id: STREAM_EXECUTION_ID, status: 'cancelled' }, finalized: true });
      }
      if (call.url.includes('api.anthropic.com')) {
        return new Response(upstreamBody, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return null;
    });

    const handler = await loadRouterHandler({ ...BASE_ROUTER_ENV });
    const abortController = new AbortController();
    const req = new Request('http://127.0.0.1:54321/functions/v1/router', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${USER_TOKEN}`,
      },
      body: JSON.stringify({
        conversationId: STREAM_CONVERSATION_ID,
        query: 'Hello from Prism',
        platform: 'mobile',
        history: [],
        modelOverride: 'anthropic:haiku',
      }),
      signal: abortController.signal,
    });

    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Prismatix-Execution-Id')).toBe(STREAM_EXECUTION_ID);

    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);

    // The client disconnects: req.signal aborts (sets clientCancelled) and the
    // upstream read is rejected before the proxy stream's cancel() runs.
    abortController.abort();
    upstreamController!.error(new Error('client disconnected'));
    await reader.read().catch(() => {});
    await flushAsync();

    const finalize = finalizeBodies.find((body) => body.p_status !== undefined);
    expect(finalize).toBeTruthy();
    expect(finalize!.p_status).toBe('cancelled');
    expect(finalize!.p_terminal_outcome).toBe('client_cancelled');
    // Zero provider calls beyond the (mocked) anthropic stream.
    expect(providerCalls(calls).every((c) => c.url.includes('api.anthropic.com'))).toBe(true);
  });

  it('still finalizes indeterminate for an upstream read error with no disconnect', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    let upstreamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        upstreamController = controller;
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"type":"content_block_delta","delta":{"text":"partial"}}\n\n',
          ),
        );
      },
    });

    const finalizeBodies: Array<Record<string, unknown>> = [];
    installFetchRecorder((call) => {
      if (call.url.includes('/auth/v1/user')) {
        return jsonResponse({ id: SUBJECT, aud: 'authenticated', role: 'authenticated' });
      }
      if (call.url.includes('/rest/v1/rpc/get_access_grant')) return jsonResponse(streamGrantRow());
      if (call.url.includes('/rest/v1/conversations')) {
        return jsonResponse({ user_id: SUBJECT, total_tokens: 0 });
      }
      if (call.url.includes('/rest/v1/cost_logs')) return jsonResponse([]);
      if (call.url.includes('/rest/v1/user_memories')) return jsonResponse([]);
      if (call.url.includes('/rest/v1/conversation_memory_state')) return jsonResponse(null);
      if (call.url.includes('/rest/v1/messages')) return jsonResponse([]);
      if (call.url.includes('/rest/v1/rpc/px03_create_execution')) {
        return jsonResponse({
          execution: {
            id: STREAM_EXECUTION_ID,
            subject_id: SUBJECT,
            conversation_id: STREAM_CONVERSATION_ID,
            client_request_key: 'px06-nodisconnect-key',
            payload_hash: 'px06-nodisconnect-hash',
            status: 'started',
            requested_mode: null,
            requested_model: 'haiku-4.5',
            resolved_model: null,
            served_model: null,
            route_version: null,
            pricing_version: null,
            catalog_version: null,
            terminal_outcome: null,
            created_at: '2026-10-06T00:00:00.000Z',
            updated_at: '2026-10-06T00:00:00.000Z',
          },
          reused: false,
        });
      }
      if (call.url.includes('/rest/v1/rpc/px03_record_model_call')) {
        return jsonResponse({
          id: 'c0000000-0000-4000-8000-0000000000bb',
          execution_id: STREAM_EXECUTION_ID,
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
      if (call.url.includes('/rest/v1/rpc/px05_admit_execution')) {
        return jsonResponse({
          admitted: true,
          reason: 'admitted',
          reservation_id: 'r0000000-0000-4000-8000-0000000000bb',
          lease_id: 'l0000000-0000-4000-8000-0000000000bb',
          retry_after_seconds: 0,
          remaining_usd: '1.5',
        });
      }
      if (call.url.includes('/rest/v1/rpc/px05_commit_from_ledger')) {
        return jsonResponse({
          state: 'pending_reconcile',
          updated: true,
          reservation_id: 'r0000000-0000-4000-8000-0000000000bb',
          committed_usd: '0',
          pending_calls: 1,
        });
      }
      if (call.url.includes('/rest/v1/rpc/px03_finalize_execution')) {
        finalizeBodies.push(JSON.parse(call.body) as Record<string, unknown>);
        return jsonResponse({ execution: { id: STREAM_EXECUTION_ID, status: 'indeterminate' }, finalized: true });
      }
      if (call.url.includes('api.anthropic.com')) {
        return new Response(upstreamBody, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return null;
    });

    const handler = await loadRouterHandler({ ...BASE_ROUTER_ENV });
    const req = new Request('http://127.0.0.1:54321/functions/v1/router', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${USER_TOKEN}`,
      },
      body: JSON.stringify({
        conversationId: STREAM_CONVERSATION_ID,
        query: 'Hello from Prism',
        platform: 'mobile',
        history: [],
        modelOverride: 'anthropic:haiku',
      }),
    });

    const res = await handler(req);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read();

    // Upstream explodes without any client disconnect.
    upstreamController!.error(new Error('provider reset'));
    await reader.read().catch(() => {});
    await flushAsync();

    const finalize = finalizeBodies.find((body) => body.p_status !== undefined);
    expect(finalize).toBeTruthy();
    expect(finalize!.p_status).toBe('indeterminate');
    expect(finalize!.p_terminal_outcome).toBe('upstream_stream_error');
  });
});

// ---------------------------------------------------------------------------
// PX06 final-review, important #2: the outer catch/timeout path finalizes
// `indeterminate` / `aborted` for a crash after admission.
// ---------------------------------------------------------------------------

describe('PX06 outer catch: post-admission crash finalizes indeterminate', () => {
  it('finalizes indeterminate/aborted when the handler throws after admission', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const finalizeBodies: Array<Record<string, unknown>> = [];
    installFetchRecorder((call) => {
      if (call.url.includes('/auth/v1/user')) {
        return jsonResponse({ id: SUBJECT, aud: 'authenticated', role: 'authenticated' });
      }
      if (call.url.includes('/rest/v1/rpc/get_access_grant')) return jsonResponse(streamGrantRow());
      if (call.url.includes('/rest/v1/conversations')) {
        return jsonResponse({ user_id: SUBJECT, total_tokens: 0 });
      }
      if (call.url.includes('/rest/v1/cost_logs')) return jsonResponse([]);
      if (call.url.includes('/rest/v1/user_memories')) return jsonResponse([]);
      if (call.url.includes('/rest/v1/conversation_memory_state')) return jsonResponse(null);
      if (call.url.includes('/rest/v1/messages')) return jsonResponse([]);
      if (call.url.includes('/rest/v1/rpc/px03_create_execution')) {
        return jsonResponse({
          execution: {
            id: STREAM_EXECUTION_ID,
            subject_id: SUBJECT,
            conversation_id: STREAM_CONVERSATION_ID,
            client_request_key: 'px06-outer-catch-key',
            payload_hash: 'px06-outer-catch-hash',
            status: 'started',
            requested_mode: null,
            requested_model: 'haiku-4.5',
            resolved_model: null,
            served_model: null,
            route_version: null,
            pricing_version: null,
            catalog_version: null,
            terminal_outcome: null,
            created_at: '2026-10-06T00:00:00.000Z',
            updated_at: '2026-10-06T00:00:00.000Z',
          },
          reused: false,
        });
      }
      if (call.url.includes('/rest/v1/rpc/px03_record_model_call')) {
        return jsonResponse({
          id: 'c0000000-0000-4000-8000-0000000000cc',
          execution_id: STREAM_EXECUTION_ID,
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
      if (call.url.includes('/rest/v1/rpc/px05_admit_execution')) {
        return jsonResponse({
          admitted: true,
          reason: 'admitted',
          reservation_id: 'r0000000-0000-4000-8000-0000000000cc',
          lease_id: 'l0000000-0000-4000-8000-0000000000cc',
          retry_after_seconds: 0,
          remaining_usd: '1.5',
        });
      }
      if (call.url.includes('/rest/v1/rpc/px05_commit_from_ledger')) {
        return jsonResponse({
          state: 'pending_reconcile',
          updated: true,
          reservation_id: 'r0000000-0000-4000-8000-0000000000cc',
          committed_usd: '0',
          pending_calls: 1,
        });
      }
      if (call.url.includes('/rest/v1/rpc/px03_finalize_execution')) {
        finalizeBodies.push(JSON.parse(call.body) as Record<string, unknown>);
        return jsonResponse({ execution: { id: STREAM_EXECUTION_ID, status: 'indeterminate' }, finalized: true });
      }
      if (call.url.includes('api.anthropic.com')) {
        return new Response(
          'data: {"type":"message_start","message":{"id":"m"}}\n\n' +
            'data: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n',
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      }
      return null;
    });

    const handler = await loadRouterHandler({ ...BASE_ROUTER_ENV });

    debateHeaderInject.shouldThrow = true;
    let res: Response;
    try {
      res = await handler(
        routerRequest({
          conversationId: STREAM_CONVERSATION_ID,
          query: 'Hello from Prism',
          platform: 'mobile',
          history: [],
          modelOverride: 'anthropic:haiku',
        }),
      );
    } finally {
      debateHeaderInject.shouldThrow = false;
    }

    // The injected throw happens outside the upstream try/catch (while building
    // the stream response headers) and is caught by the outer catch.
    expect(res.status).toBe(500);

    const finalize = finalizeBodies.find((body) => body.p_status !== undefined);
    expect(finalize).toBeTruthy();
    expect(finalize!.p_status).toBe('indeterminate');
    expect(finalize!.p_terminal_outcome).toBe('aborted');
  });
});
