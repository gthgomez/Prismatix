// @vitest-environment node
// PX01 entitlement & worker-auth security tests.
//
// Covers the server-managed approved-user entitlement primitives in
// supabase/functions/_shared/access_policy.ts (fail closed: null grant denied,
// disabled denied, feature not listed denied, active+allowed allowed, query
// errors throw EntitlementError('entitlement_unavailable')), plus the real
// video-worker / video-intake edge-function gates: a missing or incorrect
// worker secret must perform zero queue mutations and zero provider calls, and
// unentitled subjects must be rejected before any queue mutation, storage
// write, or provider call.
//
// The edge-function entrypoints are Deno modules; they are loaded with a
// stubbed globalThis.Deno and computed import specifiers (opaque to tsc), and
// the Deno-style `npm:` specifiers they use are resolved by the
// `deno-npm-stubs` plugin in vite.config.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertEntitled,
  EntitlementError,
  isEntitled,
  isGrantActive,
  loadAccessGrant,
  type AccessFeature,
  type AccessGrant,
  type AccessPolicyClient,
} from '../../supabase/functions/_shared/access_policy.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUBJECT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUBJECT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ASSET_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const JOB_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const WORKER_SECRET = 'px01-test-worker-secret';

const ALL_FEATURES: AccessFeature[] = ['chat', 'review', 'video', 'memory', 'smd'];

function makeGrant(overrides: Partial<AccessGrant> = {}): AccessGrant {
  return {
    subject_id: SUBJECT_A,
    role: 'user',
    enabled: true,
    allowed_features: ['chat', 'video'],
    max_daily_usd: '5.000000',
    max_per_execution_usd: '1.000000',
    created_at: '2026-10-06T00:00:00.000Z',
    updated_at: '2026-10-06T00:00:00.000Z',
    updated_by: null,
    ...overrides,
  };
}

function expectEntitlementCode(fn: () => void, code: 'not_entitled' | 'entitlement_unavailable'): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EntitlementError);
    expect((error as EntitlementError).code).toBe(code);
    return;
  }
  throw new Error(`expected EntitlementError(${code}), but nothing was thrown`);
}

// ---------------------------------------------------------------------------
// Mock supabase client for loadAccessGrant (dependency injection)
// ---------------------------------------------------------------------------

interface RpcCall {
  fn: string;
  params: Record<string, unknown>;
}

type RpcResult = { data?: unknown; error?: { message?: string } | null };

function stubClient(result: RpcResult | Error): { client: AccessPolicyClient; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const client: AccessPolicyClient = {
    rpc(fn: string, params?: Record<string, unknown>): Promise<RpcResult> {
      calls.push({ fn, params: params ?? {} });
      if (result instanceof Error) {
        return Promise.reject(result);
      }
      return Promise.resolve(result);
    },
  };
  return { client, calls };
}

// ---------------------------------------------------------------------------
// Entitlement primitives
// ---------------------------------------------------------------------------

describe('access policy primitives (fail closed)', () => {
  it('denies a null grant', () => {
    expect(isEntitled(null, 'chat')).toBe(false);
    expectEntitlementCode(() => assertEntitled(null, 'chat'), 'not_entitled');
  });

  it('denies a disabled grant', () => {
    const grant = makeGrant({ enabled: false, allowed_features: ALL_FEATURES });
    expect(isGrantActive(grant)).toBe(false);
    for (const feature of ALL_FEATURES) {
      expect(isEntitled(grant, feature)).toBe(false);
    }
    expectEntitlementCode(() => assertEntitled(grant, 'chat'), 'not_entitled');
  });

  it('denies a feature not in allowed_features', () => {
    const grant = makeGrant({ enabled: true, allowed_features: ['chat'] });
    expect(isEntitled(grant, 'chat')).toBe(true);
    for (const feature of ALL_FEATURES.filter((f) => f !== 'chat')) {
      expect(isEntitled(grant, feature)).toBe(false);
      expectEntitlementCode(() => assertEntitled(grant, feature), 'not_entitled');
    }
  });

  it('denies everything for an empty allowed_features list', () => {
    const grant = makeGrant({ enabled: true, allowed_features: [] });
    for (const feature of ALL_FEATURES) {
      expect(isEntitled(grant, feature)).toBe(false);
    }
  });

  it('allows an active grant listing the feature', () => {
    const grant = makeGrant({ enabled: true, allowed_features: ALL_FEATURES });
    expect(isGrantActive(grant)).toBe(true);
    for (const feature of ALL_FEATURES) {
      expect(isEntitled(grant, feature)).toBe(true);
      expect(() => assertEntitled(grant, feature)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// loadAccessGrant
// ---------------------------------------------------------------------------

describe('loadAccessGrant', () => {
  it('queries the server RPC with the subject id and returns the grant', async () => {
    const grant = makeGrant();
    const { client, calls } = stubClient({ data: grant, error: null });

    const loaded = await loadAccessGrant(client, SUBJECT_A);

    expect(calls).toEqual([{ fn: 'get_access_grant', params: { p_subject_id: SUBJECT_A } }]);
    expect(loaded).not.toBeNull();
    expect(loaded?.subject_id).toBe(SUBJECT_A);
    expect(loaded?.enabled).toBe(true);
    expect(loaded?.allowed_features).toEqual(['chat', 'video']);
  });

  it('returns null when the subject has no grant row (default deny at call sites)', async () => {
    const { client } = stubClient({ data: null, error: null });
    expect(await loadAccessGrant(client, SUBJECT_A)).toBeNull();
  });

  it('throws entitlement_unavailable on a query error', async () => {
    const { client } = stubClient({ data: null, error: { message: 'permission denied for function get_access_grant' } });

    await expect(loadAccessGrant(client, SUBJECT_A)).rejects.toThrow(EntitlementError);
    await expect(loadAccessGrant(client, SUBJECT_A)).rejects.toMatchObject({ code: 'entitlement_unavailable' });
  });

  it('throws entitlement_unavailable when the client rejects (network failure)', async () => {
    const { client } = stubClient(new Error('fetch failed'));

    await expect(loadAccessGrant(client, SUBJECT_A)).rejects.toThrow(EntitlementError);
    await expect(loadAccessGrant(client, SUBJECT_A)).rejects.toMatchObject({ code: 'entitlement_unavailable' });
  });

  it('throws entitlement_unavailable when the row does not match the requested subject', async () => {
    const { client } = stubClient({ data: makeGrant({ subject_id: SUBJECT_B }), error: null });

    await expect(loadAccessGrant(client, SUBJECT_A)).rejects.toThrow(EntitlementError);
    await expect(loadAccessGrant(client, SUBJECT_A)).rejects.toMatchObject({ code: 'entitlement_unavailable' });
  });

  it('throws entitlement_unavailable on an unexpected payload shape', async () => {
    const garbage = stubClient({ data: 'not-an-object', error: null });
    await expect(loadAccessGrant(garbage.client, SUBJECT_A)).rejects.toMatchObject({ code: 'entitlement_unavailable' });

    const list = stubClient({ data: [makeGrant()], error: null });
    await expect(loadAccessGrant(list.client, SUBJECT_A)).rejects.toMatchObject({ code: 'entitlement_unavailable' });
  });

  it('normalizes malformed payloads fail-closed', async () => {
    const { client } = stubClient({
      data: {
        subject_id: SUBJECT_A,
        role: 'root', // not a valid role -> normalized to 'user'
        enabled: 'yes', // not boolean true -> normalized to false (deny)
        allowed_features: ['chat', 'hacked', 42, null, 'video'],
        max_daily_usd: null,
        max_per_execution_usd: null,
        created_at: '2026-10-06T00:00:00.000Z',
        updated_at: '2026-10-06T00:00:00.000Z',
        updated_by: null,
      },
      error: null,
    });

    const loaded = await loadAccessGrant(client, SUBJECT_A);
    expect(loaded).not.toBeNull();
    expect(loaded?.role).toBe('user');
    expect(loaded?.enabled).toBe(false);
    expect(loaded?.allowed_features).toEqual(['chat', 'video']);
    expect(isEntitled(loaded, 'chat')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Real edge-function gates (Deno entrypoints loaded with stubs)
// ---------------------------------------------------------------------------

// Computed specifiers keep tsc from type-checking the Deno modules; the
// `deno-npm-stubs` vite plugin resolves their `npm:` imports under vitest.
const WORKER_ENTRY = ['../../supabase/functions/video-worker/index.ts'].join('');
const INTAKE_ENTRY = ['../../supabase/functions/video-intake/index.ts'].join('');

interface ServeHandler {
  (req: Request): Promise<Response>;
}

interface FetchCall {
  url: string;
  method: string;
  body: string;
}

interface GoogleAiStubState {
  constructions: number;
  getFileCalls: number;
  uploadFileCalls: number;
}

const BASE_ENV: Record<string, string> = {
  ENABLE_VIDEO_PIPELINE: 'true',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'px01-test-service-role-key',
  GOOGLE_API_KEY: 'px01-test-google-key',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function emptyResponse(): Response {
  return new Response(null, { status: 204 });
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
    writeFile: async (): Promise<void> => {
      throw new Error('unexpected Deno.writeFile: provider upload path was reached');
    },
    remove: async (): Promise<void> => {
      throw new Error('unexpected Deno.remove: provider upload path was reached');
    },
  };
  return handlers;
}

async function loadServeHandler(entry: string, env: Record<string, string | undefined>): Promise<ServeHandler> {
  vi.resetModules();
  const handlers = installDenoStub(env);
  await import(/* @vite-ignore */ entry);
  const handler = handlers[0];
  if (!handler) {
    throw new Error(`Deno.serve handler was not registered for ${entry}`);
  }
  return handler;
}

function googleAiStubState(): GoogleAiStubState {
  const state = (globalThis as unknown as Record<string, unknown>).__px01GoogleAiServerStub;
  if (!state) {
    throw new Error('google ai server stub missing: is the deno-npm-stubs vite plugin configured?');
  }
  return state as GoogleAiStubState;
}

function workerRequest(secretHeaderValue?: string): Request {
  const headers: Record<string, string> = {};
  if (secretHeaderValue !== undefined) {
    headers['x-worker-secret'] = secretHeaderValue;
  }
  return new Request('http://127.0.0.1:54321/functions/v1/video-worker', {
    method: 'POST',
    headers,
  });
}

function queuedJobRow(ownerId: string): Record<string, unknown> {
  // PostgREST many-to-one embed: a single object at runtime.
  return {
    id: JOB_ID,
    asset_id: ASSET_ID,
    status: 'queued',
    attempt: 0,
    created_at: '2026-10-06T00:00:00.000Z',
    video_assets: { user_id: ownerId },
  };
}

function queuedJobRowArrayEmbed(ownerId: string): Record<string, unknown> {
  // Array embed shape (as typed by the untyped supabase-js select parser).
  return {
    ...queuedJobRow(ownerId),
    video_assets: [{ user_id: ownerId }],
  };
}

beforeEach(() => {
  const state = (globalThis as unknown as Record<string, unknown>).__px01GoogleAiServerStub as
    | GoogleAiStubState
    | undefined;
  if (state) {
    state.constructions = 0;
    state.getFileCalls = 0;
    state.uploadFileCalls = 0;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('video-worker auth gate (real handler)', () => {
  it('missing VIDEO_WORKER_SECRET denies with zero queue mutations and zero provider calls', async () => {
    const calls = installFetchRecorder();
    const handler = await loadServeHandler(WORKER_ENTRY, { ...BASE_ENV });

    const res = await handler(workerRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Server misconfigured' });
    expect(calls).toEqual([]);
    const google = googleAiStubState();
    expect(google.constructions).toBe(0);
    expect(google.uploadFileCalls).toBe(0);
    expect(google.getFileCalls).toBe(0);
  });

  it('incorrect worker secret denies with zero queue mutations and zero provider calls', async () => {
    const calls = installFetchRecorder();
    const handler = await loadServeHandler(WORKER_ENTRY, {
      ...BASE_ENV,
      VIDEO_WORKER_SECRET: WORKER_SECRET,
    });

    const res = await handler(workerRequest('definitely-the-wrong-secret'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(calls).toEqual([]);
    const google = googleAiStubState();
    expect(google.constructions).toBe(0);
    expect(google.uploadFileCalls).toBe(0);
    expect(google.getFileCalls).toBe(0);
  });

  it('valid secret with an empty queue performs no mutations and no provider calls', async () => {
    const calls = installFetchRecorder((call) => {
      if (call.method === 'GET' && call.url.includes('/rest/v1/video_jobs')) {
        return jsonResponse([]);
      }
      return null;
    });
    const handler = await loadServeHandler(WORKER_ENTRY, {
      ...BASE_ENV,
      VIDEO_WORKER_SECRET: WORKER_SECRET,
    });

    const res = await handler(workerRequest(WORKER_SECRET));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, processed: 0 });
    // Only the read-only queue poll happened.
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    const google = googleAiStubState();
    expect(google.uploadFileCalls).toBe(0);
    expect(google.getFileCalls).toBe(0);
  });

  it('refuses a queued job whose owner has no grant: no lock, no provider calls, job failed closed', async () => {
    const calls = installFetchRecorder((call) => {
      if (call.method === 'GET' && call.url.includes('/rest/v1/video_jobs')) {
        return jsonResponse([queuedJobRow(SUBJECT_B)]);
      }
      if (call.url.includes('/rest/v1/rpc/get_access_grant')) {
        return jsonResponse(null); // no grant row -> not entitled
      }
      if (call.method === 'PATCH') {
        return emptyResponse();
      }
      return null;
    });
    const handler = await loadServeHandler(WORKER_ENTRY, {
      ...BASE_ENV,
      VIDEO_WORKER_SECRET: WORKER_SECRET,
    });

    const res = await handler(workerRequest(WORKER_SECRET));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: 'not_entitled' });

    // The entitlement lookup targeted the asset OWNER.
    const rpcCall = calls.find((call) => call.url.includes('/rest/v1/rpc/get_access_grant'));
    expect(rpcCall?.body).toContain(SUBJECT_B);

    // The job was never locked to 'running'; it was failed closed instead.
    const patchBodies = calls
      .filter((call) => call.method === 'PATCH')
      .map((call) => JSON.parse(call.body) as Record<string, unknown>);
    expect(patchBodies.some((body) => body.status === 'running')).toBe(false);
    expect(patchBodies.some((body) => body.status === 'failed' && body.error_code === 'not_entitled')).toBe(true);

    const google = googleAiStubState();
    expect(google.uploadFileCalls).toBe(0);
    expect(google.getFileCalls).toBe(0);
  });

  it('fails closed without any mutation when the entitlement lookup errors', async () => {
    const calls = installFetchRecorder((call) => {
      if (call.method === 'GET' && call.url.includes('/rest/v1/video_jobs')) {
        // Array embed shape must resolve the owner identically.
        return jsonResponse([queuedJobRowArrayEmbed(SUBJECT_B)]);
      }
      if (call.url.includes('/rest/v1/rpc/get_access_grant')) {
        return jsonResponse(
          { message: 'grant lookup failed', code: 'XX000', details: null, hint: null },
          500,
        );
      }
      return null;
    });
    const handler = await loadServeHandler(WORKER_ENTRY, {
      ...BASE_ENV,
      VIDEO_WORKER_SECRET: WORKER_SECRET,
    });

    const res = await handler(workerRequest(WORKER_SECRET));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'entitlement_unavailable' });
    // Zero queue mutations: the job stays queued for a later retry. (The only
    // non-GET call allowed is the entitlement RPC itself.)
    expect(calls.filter((call) => ['PATCH', 'PUT', 'DELETE'].includes(call.method))).toEqual([]);
    expect(calls.filter((call) => call.method === 'POST').every((call) => call.url.includes('/rpc/get_access_grant'))).toBe(true);
    const google = googleAiStubState();
    expect(google.uploadFileCalls).toBe(0);
    expect(google.getFileCalls).toBe(0);
  });
});

describe('video-intake entitlement gate (real handler)', () => {
  function intakeInitRequest(): Request {
    return new Request('http://127.0.0.1:54321/functions/v1/video-intake/init', {
      method: 'POST',
      headers: {
        authorization: 'Bearer px01-user-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        fileName: 'probe.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 2048,
      }),
    });
  }

  it('denies init with not_entitled before any asset row, queue, or storage write', async () => {
    const calls = installFetchRecorder((call) => {
      if (call.url.includes('/auth/v1/user')) {
        return jsonResponse({
          id: SUBJECT_B,
          aud: 'authenticated',
          role: 'authenticated',
          email: 'px01-b@example.test',
        });
      }
      if (call.url.includes('/rest/v1/rpc/get_access_grant')) {
        return jsonResponse(null); // no grant row -> not entitled
      }
      return null;
    });
    const handler = await loadServeHandler(INTAKE_ENTRY, { ...BASE_ENV });

    const res = await handler(intakeInitRequest());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not_entitled' });

    // Entitlement was checked for the authenticated subject.
    const rpcCall = calls.find((call) => call.url.includes('/rest/v1/rpc/get_access_grant'));
    expect(rpcCall?.body).toContain(SUBJECT_B);

    // No asset rows, no queue rows, no signed upload URLs.
    expect(calls.some((call) => call.url.includes('/rest/v1/video_assets'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/rest/v1/video_jobs'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/storage/v1'))).toBe(false);
  });
});
