// @vitest-environment node
// PX02 deployment-contract tests.
//
// Covers the containment-release contract at the real edge-function handler
// level (no behaviour is mocked away):
//   1. `_shared/release_identity.ts` pure resolution: env overrides, labelled
//      defaults, and the rule that releaseSha defaults to the literal
//      'unknown' (never invented).
//   2. Router responses carry the X-Prismatix-* release headers and list them
//      in Access-Control-Expose-Headers so a cross-origin browser can read them.
//   3. Authenticated capabilities contract: POST { action: 'capabilities' }
//      requires a valid user token but NOT a chat entitlement, and reflects
//      actual runtime flags (video off by default, review = debate enablement,
//      SMD flag) without leaking secrets.
//   4. Strict unknown manual model rejection (F17): an unknown modelOverride
//      returns HTTP 400 { error: 'unknown_model', code: 'unknown_model' } with
//      ZERO provider calls — never a silent fallback to Auto. 'auto' and the
//      documented 'debate' compatibility toggle are not model selections.
//   5. Mobile memory isolation at the handler level: platform === 'mobile'
//      performs zero server memory retrieval/extraction calls (web control
//      proves the detector works).
//   6. spend_stats manual auth seam: missing/invalid bearer tokens are
//      rejected and valid ones succeed irrespective of the gateway verify_jwt
//      configuration (the function verifies tokens itself).
//
// The edge-function entrypoints are Deno modules; they are loaded with a
// stubbed globalThis.Deno and computed import specifiers (opaque to tsc), and
// their Deno-style `npm:` specifiers are resolved by the `deno-npm-stubs`
// plugin in vite.config.ts — the same handler-invocation seam pattern used by
// tests/security/entitlements.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROTOCOL_VERSION,
  releaseHeaders,
  resolveReleaseIdentity,
  type ReleaseIdentity,
} from '../../supabase/functions/_shared/release_identity.ts';

// Computed specifiers keep tsc from type-checking the Deno entrypoints; the
// `deno-npm-stubs` vite plugin resolves their `npm:` imports under vitest.
const ROUTER_ENTRY = ['../../supabase/functions/router/index.ts'].join('');
const SPEND_STATS_ENTRY = ['../../supabase/functions/spend_stats/index.ts'].join('');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUBJECT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = 'px02-test-service-role-key';
const ANTHROPIC_KEY = 'px02-test-anthropic-key';

const IDENTITY_ENV: Record<string, string> = {
  PRISMATIX_PROTOCOL_VERSION: 'test-protocol-9',
  PRISMATIX_SCHEMA_VERSION: 'test-schema-9',
  PRISMATIX_CATALOG_VERSION: 'test-catalog-9',
  PRISMATIX_TARIFF_VERSION: 'test-tariff-9',
  RELEASE_SHA: 'abc123testsha',
};

const BASE_ROUTER_ENV: Record<string, string> = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  ANTHROPIC_API_KEY: ANTHROPIC_KEY,
  ...IDENTITY_ENV,
};

const RELEASE_HEADER_NAMES = [
  'X-Prismatix-Protocol',
  'X-Prismatix-Schema',
  'X-Prismatix-Catalog',
  'X-Prismatix-Tariff',
  'X-Prismatix-Release',
];

// Every host the router may dispatch paid provider traffic to. Used to prove
// "zero provider calls" on rejected requests.
const PROVIDER_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'opencode.ai',
  'api.nvidia.com',
  'api.deepinfra.com',
];

// A query engineered to route (auto) to the 'max'/'strong' legacy role, which
// maps to anthropic opus/sonnet — the only provider with credentials in the
// test env — so the debate-toggle/auto paths deterministically stream.
const RICH_QUERY =
  'Please analyze and evaluate the trade-offs, synthesize a comprehensive ' +
  'strategy, critique the design, architect the reasoning, and explain why ' +
  'and how we should manage the implications in-depth?';

function grantRow(): Record<string, unknown> {
  return {
    subject_id: SUBJECT_A,
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

// PX03: the router now establishes a ledger execution before any dispatch and
// records each provider call through the `px03_*` service-role RPCs. These are
// stubbed for the happy-path handler tests; the fail-closed test overrides the
// create RPC with a 500.
const EXECUTION_ID = 'e0000000-0000-4000-8000-000000000001';

function px03Routes(call: FetchCall): Response | null {
  if (call.url.includes('/rest/v1/rpc/px03_create_execution')) {
    return jsonResponse({
      execution: {
        id: EXECUTION_ID,
        subject_id: SUBJECT_A,
        conversation_id: CONVERSATION_ID,
        client_request_key: 'px02-test-key',
        payload_hash: 'px02-test-hash',
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
      },
      reused: false,
    });
  }
  if (call.url.includes('/rest/v1/rpc/px03_record_model_call')) {
    return jsonResponse({
      id: 'c0000000-0000-4000-8000-000000000001',
      execution_id: EXECUTION_ID,
      stage: 'baseline',
      participant: 'anthropic',
      attempt_number: 1,
      status: 'completed',
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
  if (call.url.includes('/rest/v1/rpc/px03_finalize_execution')) {
    return jsonResponse({
      execution: { id: EXECUTION_ID, status: 'completed', terminal_outcome: 'ok' },
      finalized: true,
    });
  }
  if (call.url.includes('/rest/v1/rpc/px03_enqueue_reconciliation')) {
    return jsonResponse({
      id: 'j0000000-0000-4000-8000-000000000001',
      kind: 'model_call_unsettled',
      status: 'pending',
    });
  }
  // PX05: DB-authoritative admission. The happy path reserves the max billable
  // work and then commits the actual cost on completion.
  if (call.url.includes('/rest/v1/rpc/px05_admit_execution')) {
    return jsonResponse({
      admitted: true,
      reason: 'admitted',
      reservation_id: 'r0000000-0000-4000-8000-000000000001',
      lease_id: 'l0000000-0000-4000-8000-000000000001',
      retry_after_seconds: 0,
      remaining_usd: '1.5',
    });
  }
  if (call.url.includes('/rest/v1/rpc/px05_commit_from_ledger')) {
    return jsonResponse({
      state: 'committed',
      updated: true,
      reservation_id: 'r0000000-0000-4000-8000-000000000001',
      committed_usd: '0.01',
      calls: 1,
    });
  }
  if (call.url.includes('/rest/v1/rpc/px05_commit_estimated')) {
    return jsonResponse({
      state: 'committed',
      updated: true,
      reservation_id: 'r0000000-0000-4000-8000-000000000001',
      committed_usd: '0.01',
      basis: 'estimated',
    });
  }
  if (call.url.includes('/rest/v1/rpc/px05_commit_reservation')) {
    return jsonResponse({
      state: 'committed',
      updated: true,
      reservation_id: 'r0000000-0000-4000-8000-000000000001',
    });
  }
  if (call.url.includes('/rest/v1/rpc/px05_release_reservation')) {
    return jsonResponse({
      state: 'released',
      updated: true,
      reservation_id: 'r0000000-0000-4000-8000-000000000001',
    });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Deno stub + fetch recorder (same seam pattern as tests/security/entitlements)
// ---------------------------------------------------------------------------

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

function anthropicSseResponse(): Response {
  const sse = [
    'data: {"type":"message_start","message":{"id":"msg_px02"}}',
    '',
    'data: {"type":"content_block_delta","delta":{"text":"Hello from Prism"}}',
    '',
    'data: {"type":"message_stop"}',
    '',
    '',
  ].join('\n');
  return new Response(sse, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function fetchCallInfo(input: RequestInfo | URL, init?: RequestInit): FetchCall {
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
  return { url, method: method.toUpperCase(), body };
}

function installFetchRecorder(routes?: (call: FetchCall) => Response | null): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const call = fetchCallInfo(input, init);
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

async function loadServeHandler(
  entry: string,
  env: Record<string, string | undefined>,
): Promise<ServeHandler> {
  vi.resetModules();
  const handlers = installDenoStub(env);
  await import(/* @vite-ignore */ entry);
  const handler = handlers[0];
  if (!handler) {
    throw new Error(`Deno.serve handler was not registered for ${entry}`);
  }
  return handler;
}

async function loadModuleNamespace<T>(
  entry: string,
  env: Record<string, string | undefined>,
): Promise<{ mod: T; handlers: ServeHandler[] }> {
  vi.resetModules();
  const handlers = installDenoStub(env);
  const mod = (await import(/* @vite-ignore */ entry)) as T;
  return { mod, handlers };
}

function providerCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => PROVIDER_HOSTS.some((host) => call.url.includes(host)));
}

function routerRequest(body: unknown, token?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) {
    headers.authorization = `Bearer ${token}`;
  }
  return new Request('http://127.0.0.1:54321/functions/v1/router', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function chatBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conversationId: CONVERSATION_ID,
    query: 'Hello from Prism',
    platform: 'mobile',
    history: [],
    ...overrides,
  };
}

// Full happy-path supabase routing: auth ok, entitled grant, owned conversation,
// empty spend/memory tables, anthropic streams.
function supabaseRoutes(options?: { authOk?: boolean }): (call: FetchCall) => Response | null {
  const authOk = options?.authOk ?? true;
  return (call: FetchCall): Response | null => {
    if (call.url.includes('/auth/v1/user')) {
      return authOk
        ? jsonResponse({
            id: SUBJECT_A,
            aud: 'authenticated',
            role: 'authenticated',
            email: 'px02-a@example.test',
          })
        : // Realistic GoTrue 401 body (supabase-js builds AuthApiError from it).
          jsonResponse(
            { code: 401, error: 'invalid_token', msg: 'invalid token', error_description: 'invalid token' },
            401,
          );
    }
    if (call.url.includes('/rest/v1/rpc/get_access_grant')) {
      return jsonResponse(grantRow());
    }
    if (call.url.includes('/rest/v1/conversations')) {
      return jsonResponse({ user_id: SUBJECT_A, total_tokens: 0 });
    }
    if (call.url.includes('/rest/v1/cost_logs')) {
      return jsonResponse([]);
    }
    if (call.url.includes('/rest/v1/user_memories')) {
      return jsonResponse([]);
    }
    if (call.url.includes('/rest/v1/conversation_memory_state')) {
      return jsonResponse(null);
    }
    if (call.url.includes('/rest/v1/messages')) {
      return jsonResponse([]);
    }
    const px03 = px03Routes(call);
    if (px03) {
      return px03;
    }
    if (call.url.includes('api.anthropic.com')) {
      return anthropicSseResponse();
    }
    return null;
  };
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Release identity module (pure, no Deno)
// ---------------------------------------------------------------------------

describe('release identity resolution (pure module)', () => {
  it('reads every identity field from the injected env reader', () => {
    const env: Record<string, string> = { ...IDENTITY_ENV };
    const identity = resolveReleaseIdentity((key) => env[key]);

    expect(identity).toEqual({
      protocolVersion: 'test-protocol-9',
      schemaVersion: 'test-schema-9',
      catalogVersion: 'test-catalog-9',
      tariffVersion: 'test-tariff-9',
      releaseSha: 'abc123testsha',
    } satisfies ReleaseIdentity);
  });

  it('falls back to labelled defaults, with releaseSha defaulting to the literal "unknown"', () => {
    const identity = resolveReleaseIdentity(() => undefined);

    expect(identity.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(identity.schemaVersion).toBe('unspecified');
    expect(identity.catalogVersion).toBe('unspecified');
    expect(identity.tariffVersion).toBe('unspecified');
    // Never invent a SHA: the only allowed default is the literal 'unknown'.
    expect(identity.releaseSha).toBe('unknown');
  });

  it('treats empty or whitespace-only env values as unset', () => {
    const identity = resolveReleaseIdentity((key) =>
      key === 'RELEASE_SHA' ? '   ' : '',
    );

    expect(identity.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(identity.releaseSha).toBe('unknown');
  });

  it('maps the identity onto the five X-Prismatix-* response headers', () => {
    const identity: ReleaseIdentity = {
      protocolVersion: 'p1',
      schemaVersion: 's1',
      catalogVersion: 'c1',
      tariffVersion: 't1',
      releaseSha: 'sha1',
    };

    expect(releaseHeaders(identity)).toEqual({
      'X-Prismatix-Protocol': 'p1',
      'X-Prismatix-Schema': 's1',
      'X-Prismatix-Catalog': 'c1',
      'X-Prismatix-Tariff': 't1',
      'X-Prismatix-Release': 'sha1',
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Router release headers + CORS exposure
// ---------------------------------------------------------------------------

describe('router release identity headers', () => {
  it('stamps release headers on responses and exposes them via CORS', async () => {
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(
      new Request('http://127.0.0.1:54321/functions/v1/router', { method: 'OPTIONS' }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Prismatix-Protocol')).toBe('test-protocol-9');
    expect(res.headers.get('X-Prismatix-Schema')).toBe('test-schema-9');
    expect(res.headers.get('X-Prismatix-Catalog')).toBe('test-catalog-9');
    expect(res.headers.get('X-Prismatix-Tariff')).toBe('test-tariff-9');
    expect(res.headers.get('X-Prismatix-Release')).toBe('abc123testsha');

    const exposed = res.headers.get('Access-Control-Expose-Headers') ?? '';
    for (const name of RELEASE_HEADER_NAMES) {
      expect(exposed).toContain(name);
    }
  });

  it('stamps release headers on error responses too (401 without Authorization)', async () => {
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(routerRequest(chatBody()));

    expect(res.status).toBe(401);
    expect(res.headers.get('X-Prismatix-Release')).toBe('abc123testsha');
  });

  it('defaults the release SHA to "unknown" when RELEASE_SHA is not set (never invents one)', async () => {
    const env: Record<string, string | undefined> = { ...BASE_ROUTER_ENV };
    for (const key of [
      'PRISMATIX_PROTOCOL_VERSION',
      'PRISMATIX_SCHEMA_VERSION',
      'PRISMATIX_CATALOG_VERSION',
      'PRISMATIX_TARIFF_VERSION',
      'RELEASE_SHA',
    ]) {
      delete env[key];
    }
    const handler = await loadServeHandler(ROUTER_ENTRY, env);

    const res = await handler(
      new Request('http://127.0.0.1:54321/functions/v1/router', { method: 'OPTIONS' }),
    );

    expect(res.headers.get('X-Prismatix-Release')).toBe('unknown');
    expect(res.headers.get('X-Prismatix-Protocol')).toBe(PROTOCOL_VERSION);
    expect(res.headers.get('X-Prismatix-Schema')).toBe('unspecified');
    expect(res.headers.get('X-Prismatix-Catalog')).toBe('unspecified');
    expect(res.headers.get('X-Prismatix-Tariff')).toBe('unspecified');
  });
});

// ---------------------------------------------------------------------------
// 3. Authenticated capabilities contract
// ---------------------------------------------------------------------------

describe('capabilities contract (router)', () => {
  it('requires authentication: 401 without an Authorization header', async () => {
    const calls = installFetchRecorder(supabaseRoutes());
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(routerRequest({ action: 'capabilities' }));

    expect(res.status).toBe(401);
    expect(calls.some((call) => call.url.includes('/auth/v1/user'))).toBe(false);
  });

  it('requires authentication: 401 with an invalid token', async () => {
    installFetchRecorder(supabaseRoutes({ authOk: false }));
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(routerRequest({ action: 'capabilities' }, 'bogus-token'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized: Invalid or expired token' });
  });

  it('returns the release+capabilities payload for an authenticated user WITHOUT requiring an entitlement', async () => {
    const calls = installFetchRecorder(supabaseRoutes());
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(routerRequest({ action: 'capabilities' }, 'px02-user-token'));

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.release).toEqual({
      protocolVersion: 'test-protocol-9',
      schemaVersion: 'test-schema-9',
      catalogVersion: 'test-catalog-9',
      tariffVersion: 'test-tariff-9',
      releaseSha: 'abc123testsha',
    });
    // Default flags: video off, debate (review) off, SMD off; memory on for web.
    expect(payload.capabilities.modes).toEqual(['chat']);
    expect(payload.capabilities.features).toEqual({
      chat: true,
      review: false,
      video: false,
      memory: true,
      smd: false,
    });
    expect(Array.isArray(payload.capabilities.models)).toBe(true);
    expect(payload.capabilities.models.length).toBeGreaterThan(0);
    expect(payload.capabilities.models).toContain('haiku-4.5');
    for (const model of payload.capabilities.models) {
      expect(typeof model).toBe('string');
    }

    // Read-only capabilities view: entitlement gate must NOT have been consulted.
    expect(calls.some((call) => call.url.includes('get_access_grant'))).toBe(false);
    // Zero provider calls for a metadata request.
    expect(providerCalls(calls)).toEqual([]);

    // Release headers are present on the capabilities response too.
    expect(res.headers.get('X-Prismatix-Release')).toBe('abc123testsha');
  });

  it('does not leak secrets or provider keys in the payload', async () => {
    installFetchRecorder(supabaseRoutes());
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(routerRequest({ action: 'capabilities' }, 'px02-user-token'));

    const raw = await res.text();
    expect(raw).not.toContain(ANTHROPIC_KEY);
    expect(raw).not.toContain(SERVICE_ROLE_KEY);
    expect(raw.toLowerCase()).not.toContain('api_key');
    expect(raw.toLowerCase()).not.toContain('apikey');
  });

  it('reflects actual runtime flags when debate/video/SMD are enabled', async () => {
    installFetchRecorder(supabaseRoutes());
    const handler = await loadServeHandler(ROUTER_ENTRY, {
      ...BASE_ROUTER_ENV,
      ENABLE_DEBATE_MODE: 'true',
      ENABLE_VIDEO_PIPELINE: 'true',
      ENABLE_SMD_LIGHT: 'true',
    });

    const res = await handler(routerRequest({ action: 'capabilities' }, 'px02-user-token'));

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.capabilities.modes).toEqual(['chat', 'debate', 'smd_light']);
    expect(payload.capabilities.features).toEqual({
      chat: true,
      review: true,
      video: true,
      memory: true,
      smd: true,
    });
  });
});

// ---------------------------------------------------------------------------
// 3b. Capabilities size guards & body-error precedence (PX02 fix round 1)
// ---------------------------------------------------------------------------

describe('capabilities size guards & body-error precedence (PX02 fix round 1)', () => {
  const TOO_LARGE_ERROR = 'Payload too large. Max allowed size is 8MB.';

  it('rejects a declared-oversized authenticated capabilities body with 413 (hoisted header guard)', async () => {
    const calls = installFetchRecorder(supabaseRoutes());
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const req = routerRequest({ action: 'capabilities' }, 'px02-user-token');
    req.headers.set('content-length', String(9 * 1024 * 1024));

    const res = await handler(req);

    // The hoisted header-only guard fires before any capabilities dispatch:
    // 413, never a 200 capabilities payload.
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: TOO_LARGE_ERROR });
    expect(providerCalls(calls)).toEqual([]);
  });

  it('rejects a genuinely oversized authenticated capabilities body with 413, not 200', async () => {
    const calls = installFetchRecorder(supabaseRoutes());
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const padding = 'x'.repeat(8 * 1024 * 1024 + 64); // > MAX_REQUEST_BYTES
    const res = await handler(
      routerRequest({ action: 'capabilities', padding }, 'px02-user-token'),
    );

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: TOO_LARGE_ERROR });
    expect(providerCalls(calls)).toEqual([]);
  });

  it('still returns 200 for a normal-size capabilities request after the reorder', async () => {
    installFetchRecorder(supabaseRoutes());
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(routerRequest({ action: 'capabilities' }, 'px02-user-token'));

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.capabilities.modes).toEqual(['chat']);
    expect(payload.release.releaseSha).toBe('abc123testsha');
  });

  it('preserves precedence: unentitled + malformed JSON body gets 403 not_entitled (not 400)', async () => {
    installFetchRecorder((call) => {
      if (call.url.includes('/auth/v1/user')) {
        return jsonResponse({ id: SUBJECT_A, aud: 'authenticated', role: 'authenticated' });
      }
      if (call.url.includes('/rest/v1/rpc/get_access_grant')) {
        return jsonResponse(null); // no grant row -> not entitled
      }
      return null;
    });
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const req = new Request('http://127.0.0.1:54321/functions/v1/router', {
      method: 'POST',
      headers: {
        authorization: 'Bearer px02-user-token',
        'content-type': 'application/json',
      },
      body: 'this-is-not-json{',
    });
    const res = await handler(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not_entitled' });
  });

  it('preserves precedence: entitled + malformed JSON body gets the canonical 400 Invalid JSON', async () => {
    installFetchRecorder(supabaseRoutes());
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const req = new Request('http://127.0.0.1:54321/functions/v1/router', {
      method: 'POST',
      headers: {
        authorization: 'Bearer px02-user-token',
        'content-type': 'application/json',
      },
      body: 'this-is-not-json{',
    });
    const res = await handler(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Bad Request: Invalid JSON' });
  });
});

// ---------------------------------------------------------------------------
// 4. Strict unknown manual model rejection (F17)
// ---------------------------------------------------------------------------

describe('strict unknown manual model rejection (F17)', () => {
  it('rejects an unknown manual model ID with 400 unknown_model and ZERO provider calls', async () => {
    const calls = installFetchRecorder(supabaseRoutes());
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest(
        chatBody({ platform: 'web', modelOverride: 'gpt-9.9-does-not-exist' }),
        'px02-user-token',
      ),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown_model', code: 'unknown_model' });
    // Fail closed BEFORE any paid dispatch: zero provider calls, ever.
    expect(providerCalls(calls)).toEqual([]);
    // Release identity is stamped even on validation errors.
    expect(res.headers.get('X-Prismatix-Release')).toBe('abc123testsha');
  });

  it('rejects an unknown model that substring-matches a known generation (no substring mapping)', async () => {
    const calls = installFetchRecorder(supabaseRoutes());
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest(
        chatBody({ platform: 'web', modelOverride: 'claude-opus-5-max-2027' }),
        'px02-user-token',
      ),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown_model', code: 'unknown_model' });
    expect(providerCalls(calls)).toEqual([]);
  });

  it('does not reject modelOverride "auto" — it streams normally', async () => {
    const calls = installFetchRecorder(supabaseRoutes());
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest(
        chatBody({ platform: 'mobile', query: RICH_QUERY, modelOverride: 'auto' }),
        'px02-user-token',
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('X-Model-Override')).toBe('auto');
    const text = await res.text();
    expect(text).toContain('Hello from Prism');
    await flushAsync();
    expect(providerCalls(calls).length).toBeGreaterThan(0);
  });

  it('does not reject the documented "debate" compatibility toggle (it is not a model selection)', async () => {
    installFetchRecorder(supabaseRoutes());
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest(
        chatBody({ platform: 'mobile', query: RICH_QUERY, modelOverride: 'debate' }),
        'px02-user-token',
      ),
    );

    // ENABLE_DEBATE_MODE is off by default, so the request must stream via the
    // baseline path — it must NOT be rejected as an unknown model. Debate did
    // not run, so X-Model-Override reflects the effective (auto) selection.
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('X-Model-Override')).toBe('auto');
    const text = await res.text();
    expect(text).toContain('Hello from Prism');
    await flushAsync();
  });

  it('still accepts a known manual model synonym and reports it in X-Model-Override', async () => {
    installFetchRecorder(supabaseRoutes());
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest(
        chatBody({ platform: 'mobile', modelOverride: 'anthropic:haiku' }),
        'px02-user-token',
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Model-Override')).toBe('haiku-4.5');
    expect(res.headers.get('X-Router-Model')).toBe('haiku-4.5');
    await res.text();
    await flushAsync();
  });
});

// ---------------------------------------------------------------------------
// 5. Mobile memory isolation (handler level)
// ---------------------------------------------------------------------------

describe('mobile memory isolation (real handler)', () => {
  it('platform=mobile streams with ZERO server memory retrieval/extraction calls', async () => {
    const calls = installFetchRecorder(supabaseRoutes());
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest(
        chatBody({ platform: 'mobile', modelOverride: 'anthropic:haiku' }),
        'px02-user-token',
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('X-Memory-Hits')).toBe('0');
    expect(res.headers.get('X-Memory-Tokens')).toBe('0');
    const text = await res.text();
    expect(text).toContain('Hello from Prism');
    // Let fire-and-forget persistence settle before asserting absence.
    await flushAsync();

    // Retrieval reads user_memories; extraction reads/writes user_memories and
    // conversation_memory_state. Mobile must invoke NEITHER.
    expect(calls.some((call) => call.url.includes('user_memories'))).toBe(false);
    expect(calls.some((call) => call.url.includes('conversation_memory_state'))).toBe(false);
    // The request did stream from the provider.
    expect(providerCalls(calls).length).toBeGreaterThan(0);
  });

  it('control: platform=web DOES invoke server memory retrieval (detector works)', async () => {
    const calls = installFetchRecorder(supabaseRoutes());
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest(
        chatBody({ platform: 'web', modelOverride: 'anthropic:haiku' }),
        'px02-user-token',
      ),
    );

    expect(res.status).toBe(200);
    await res.text();
    await flushAsync();

    expect(calls.some((call) => call.url.includes('user_memories'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5b. PX03 execution ledger fail-closed (real handler)
// ---------------------------------------------------------------------------

describe('PX03 execution ledger fail-closed (real handler)', () => {
  it('returns 503 accounting_unavailable with ZERO provider calls when execution create fails', async () => {
    const happy = supabaseRoutes();
    const calls = installFetchRecorder((call) => {
      // Override the ledger create RPC with a hard failure.
      if (call.url.includes('/rest/v1/rpc/px03_create_execution')) {
        return jsonResponse({ code: '08006', message: 'ledger unavailable' }, 500);
      }
      return happy(call);
    });
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest(
        chatBody({ platform: 'mobile', modelOverride: 'anthropic:haiku' }),
        'px02-user-token',
      ),
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'accounting_unavailable',
      code: 'accounting_unavailable',
    });
    await flushAsync();

    // Fail closed: the execution could not be established, so NO provider call
    // was made (an unmetered inference is what PX03 forbids).
    expect(providerCalls(calls)).toEqual([]);
    // The failure was recorded durably (reconciliation job enqueued) first.
    expect(
      calls.some((call) => call.url.includes('/rest/v1/rpc/px03_enqueue_reconciliation')),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5c. PX05 DB-authoritative admission gate (real handler)
// ---------------------------------------------------------------------------

describe('PX05 admission gate (real handler)', () => {
  function denyRoutes(reason: string, retryAfterSeconds = 0): (call: FetchCall) => Response | null {
    const happy = supabaseRoutes();
    return (call: FetchCall): Response | null => {
      if (call.url.includes('/rest/v1/rpc/px05_admit_execution')) {
        return jsonResponse({
          admitted: false,
          reason,
          reservation_id: null,
          lease_id: null,
          retry_after_seconds: retryAfterSeconds,
          remaining_usd: '0',
        });
      }
      return happy(call);
    };
  }

  it('returns 402 budget_exhausted with ZERO provider calls when the budget is exhausted', async () => {
    const calls = installFetchRecorder(denyRoutes('budget_exhausted'));
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest(
        chatBody({ platform: 'mobile', modelOverride: 'anthropic:haiku' }),
        'px02-user-token',
      ),
    );

    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'budget_exhausted', code: 'budget_exhausted' });
    await flushAsync();
    expect(providerCalls(calls)).toEqual([]);
  });

  it('returns 429 rate_limited with a Retry-After header and ZERO provider calls', async () => {
    const calls = installFetchRecorder(denyRoutes('rate_limited', 17));
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest(
        chatBody({ platform: 'mobile', modelOverride: 'anthropic:haiku' }),
        'px02-user-token',
      ),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('17');
    expect(await res.json()).toEqual({ error: 'rate_limited', code: 'rate_limited' });
    await flushAsync();
    expect(providerCalls(calls)).toEqual([]);
  });

  it('commits a bounded estimate when the ledger has priced-but-unsettled calls (real handler)', async () => {
    const happy = supabaseRoutes();
    const calls = installFetchRecorder((call) => {
      if (call.url.includes('/rest/v1/rpc/px05_commit_from_ledger')) {
        return jsonResponse({
          state: 'pending_reconcile',
          updated: true,
          committed_usd: '0',
          pending_calls: 1,
        });
      }
      if (call.url.includes('/rest/v1/rpc/px05_commit_estimated')) {
        return jsonResponse({
          state: 'committed',
          updated: true,
          committed_usd: '0.01',
          basis: 'estimated',
        });
      }
      return happy(call);
    });
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest(
        chatBody({ platform: 'mobile', modelOverride: 'anthropic:haiku' }),
        'px02-user-token',
      ),
    );

    expect(res.status).toBe(200);
    await res.text();
    await flushAsync();

    const estimateCall = calls.find((call) =>
      call.url.includes('/rest/v1/rpc/px05_commit_estimated'),
    );
    expect(estimateCall).toBeTruthy();
    const params = JSON.parse(estimateCall!.body) as { p_estimated_usd?: number };
    expect(params.p_estimated_usd).toBeGreaterThan(0);
  });

  it('fails CLOSED with 503 admission_unavailable when the admission RPC errors', async () => {
    const happy = supabaseRoutes();
    const calls = installFetchRecorder((call) => {
      if (call.url.includes('/rest/v1/rpc/px05_admit_execution')) {
        return jsonResponse({ code: '08006', message: 'budget authority down' }, 500);
      }
      return happy(call);
    });
    const handler = await loadServeHandler(ROUTER_ENTRY, { ...BASE_ROUTER_ENV });

    const res = await handler(
      routerRequest(
        chatBody({ platform: 'mobile', modelOverride: 'anthropic:haiku' }),
        'px02-user-token',
      ),
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'admission_unavailable',
      code: 'admission_unavailable',
    });
    await flushAsync();
    expect(providerCalls(calls)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. spend_stats manual auth seam (gateway verify_jwt independent)
// ---------------------------------------------------------------------------

interface SpendStatsTestClient {
  auth: {
    getUser(token: string): Promise<{
      data: { user: { id: string } | null };
      error: { message?: string } | null;
    }>;
  };
  rpc(
    fn: string,
    params?: Record<string, unknown>,
  ): Promise<{ data?: unknown; error?: unknown }>;
}

interface SpendStatsModule {
  handleSpendStats: (
    req: Request,
    deps?: {
      getEnv?: (key: string) => string | undefined;
      createClient?: (url: string, serviceRoleKey: string) => SpendStatsTestClient;
    },
  ) => Promise<Response>;
}

const SPEND_STATS_ENV: Record<string, string> = {
  ALLOWED_ORIGIN: 'https://app.example.test',
  SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
};

function spendStatsRequest(authHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) {
    headers.authorization = authHeader;
  }
  return new Request('http://127.0.0.1:54321/functions/v1/spend_stats', {
    method: 'GET',
    headers,
  });
}

function spendStatsStubClient(
  rpcCalls: Array<{ fn: string; params?: Record<string, unknown> }>,
): SpendStatsTestClient {
  return {
    auth: {
      getUser: async (token: string) => {
        if (token === 'px02-valid-token') {
          return { data: { user: { id: SUBJECT_A } }, error: null };
        }
        return { data: { user: null }, error: { message: 'invalid token' } };
      },
    },
    rpc: async (fn: string, params?: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      return {
        data: {
          today: '1.5',
          this_week: 2,
          this_month: null,
          all_time: '10.25',
          last_message_cost: '0.01',
          message_count: '7',
        },
        error: null,
      };
    },
  };
}

describe('spend_stats manual auth seam (verify_jwt independent)', () => {
  // The deployed spend_stats gateway runs with verify_jwt = false (the repo
  // config.toml declares true — a known divergence). Either way the function
  // itself validates the Bearer token, so these tests hold regardless of the
  // gateway configuration: the handler is invoked directly, exactly as
  // Deno.serve invokes it.

  it('registers its Deno.serve handler and rejects a missing Authorization header with 401', async () => {
    const { mod, handlers } = await loadModuleNamespace<SpendStatsModule>(
      SPEND_STATS_ENTRY,
      SPEND_STATS_ENV,
    );
    expect(typeof mod.handleSpendStats).toBe('function');
    expect(handlers.length).toBe(1);

    const viaSeam = await mod.handleSpendStats(spendStatsRequest());
    expect(viaSeam.status).toBe(401);
    expect(await viaSeam.json()).toEqual({
      error: 'Unauthorized: Missing or invalid Authorization header',
    });

    // The registered serve handler behaves identically (it delegates).
    const viaServe = await handlers[0]!(spendStatsRequest());
    expect(viaServe.status).toBe(401);
    expect(await viaServe.json()).toEqual({
      error: 'Unauthorized: Missing or invalid Authorization header',
    });
  });

  it('rejects a non-Bearer Authorization scheme with 401', async () => {
    const { mod } = await loadModuleNamespace<SpendStatsModule>(
      SPEND_STATS_ENTRY,
      SPEND_STATS_ENV,
    );

    const res = await mod.handleSpendStats(spendStatsRequest('Basic px02-creds'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: 'Unauthorized: Missing or invalid Authorization header',
    });
  });

  it('rejects an invalid/expired token with 401 even though the gateway may not verify JWTs', async () => {
    const rpcCalls: Array<{ fn: string; params?: Record<string, unknown> }> = [];
    const { mod } = await loadModuleNamespace<SpendStatsModule>(
      SPEND_STATS_ENTRY,
      SPEND_STATS_ENV,
    );

    const res = await mod.handleSpendStats(spendStatsRequest('Bearer forged-token'), {
      createClient: () => spendStatsStubClient(rpcCalls),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized: Invalid or expired token' });
    // No stats RPC for an unauthenticated subject.
    expect(rpcCalls).toEqual([]);
  });

  it('succeeds with a valid token and maps the stats row exactly', async () => {
    const rpcCalls: Array<{ fn: string; params?: Record<string, unknown> }> = [];
    const { mod } = await loadModuleNamespace<SpendStatsModule>(
      SPEND_STATS_ENTRY,
      SPEND_STATS_ENV,
    );

    const res = await mod.handleSpendStats(spendStatsRequest('Bearer px02-valid-token'), {
      createClient: () => spendStatsStubClient(rpcCalls),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test');
    expect(await res.json()).toEqual({
      today: 1.5,
      thisWeek: 2,
      thisMonth: 0,
      allTime: 10.25,
      lastMessageCost: 0.01,
      messageCount: 7,
    });
    expect(rpcCalls).toEqual([{ fn: 'get_spend_stats', params: { p_user_id: SUBJECT_A } }]);
  });

  it('fails closed with 500 when Supabase env is missing', async () => {
    const { mod } = await loadModuleNamespace<SpendStatsModule>(SPEND_STATS_ENTRY, {
      ALLOWED_ORIGIN: 'https://app.example.test',
    });

    const res = await mod.handleSpendStats(spendStatsRequest('Bearer px02-valid-token'));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Server misconfigured: missing Supabase env vars',
    });
  });
});
