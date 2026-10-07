// @vitest-environment node
// PX05 admission / metered fan-out tests.
//
// These tests exercise the DB-authoritative admission boundary in
// supabase/functions/router/admission.ts with an injected fake service-role
// client that mirrors the `px05_*` RPCs defined in
// supabase/migrations/20261006020000_px05_budgets_leases.sql. The invariants
// proven here:
//   * numeric admission configuration is validated at startup and fails CLOSED
//     on malformed/negative/nonfinite values;
//   * an admission RPC failure never admits (fail closed) and reports
//     `admission_unavailable`;
//   * a denied admission dispatches ZERO pipeline stages, while an admitted one
//     meters every stage/retry through the PX03 metered boundary;
//   * commit/release never silently forgive uncertain paid work (unknown usage
//     becomes `pending_reconcile`);
//   * a disabled video path cannot consume any capacity (zero admission calls).
//
// The real router handler wiring (deny => 402/429 with zero provider calls) is
// asserted at the handler level in tests/integration/deployment-contract.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AdmissionConfigError,
  DEFAULT_ADMISSION_CONFIG,
  admitExecution,
  admissionDenialStatus,
  commitReservation,
  deriveOutputTokenCap,
  loadAdmissionConfig,
  releaseReservation,
  resolveEffectiveLimits,
  ADMISSION_ENV_KEYS,
  type AdmissionClient,
  type AdmitExecutionParams,
} from '../../supabase/functions/router/admission.ts';
import {
  runMeteredCall,
} from '../../supabase/functions/router/metered_call.ts';
import type {
  ExecutionRecord,
  ExecutionStoreClient,
  ExecutionStoreRpcResponse,
} from '../../supabase/functions/router/execution_store.ts';

// ============================================================================
// FAKE CLIENTS
// ============================================================================

interface RpcCall {
  fn: string;
  params: Record<string, unknown>;
}

type RpcResponse = { data?: unknown; error?: { code?: string; message?: string } | null };

function fakeAdmissionClient(
  respond: (fn: string, params: Record<string, unknown>) => RpcResponse | Error,
): { client: AdmissionClient; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const client: AdmissionClient = {
    rpc(fn: string, params: Record<string, unknown> = {}): PromiseLike<RpcResponse> {
      calls.push({ fn, params });
      const result = respond(fn, params);
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    },
  };
  return { client, calls };
}

function fakeExecutionStore(): {
  client: ExecutionStoreClient;
  modelCalls: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
} {
  const modelCalls: Array<Record<string, unknown>> = [];
  const jobs: Array<Record<string, unknown>> = [];
  const client: ExecutionStoreClient = {
    rpc(fn: string, params: Record<string, unknown> = {}): PromiseLike<ExecutionStoreRpcResponse> {
      if (fn === 'px03_record_model_call') {
        // Mirror the real ledger identity: a retry of the same accounting event
        // (execution, stage, participant, attempt) dedupes to one row.
        const existing = modelCalls.find(
          (row) =>
            row.p_execution_id === params.p_execution_id &&
            row.p_stage === params.p_stage &&
            row.p_participant === params.p_participant &&
            row.p_attempt_number === params.p_attempt_number,
        );
        if (existing) {
          Object.assign(existing, params);
          return Promise.resolve({ data: existing, error: null });
        }
        const row = { id: `call-${modelCalls.length + 1}`, ...params };
        modelCalls.push(row);
        return Promise.resolve({ data: row, error: null });
      }
      if (fn === 'px03_enqueue_reconciliation') {
        jobs.push(params);
        return Promise.resolve({ data: { id: `job-${jobs.length}` }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${fn}` } });
    },
  };
  return { client, modelCalls, jobs };
}

// ============================================================================
// FIXTURES
// ============================================================================

const SUBJECT = '11111111-1111-4111-8111-111111111111';
const EXECUTION_ID = 'e0000000-0000-4000-8000-000000000001';

const ADMIT_PARAMS: AdmitExecutionParams = {
  subjectId: SUBJECT,
  executionId: EXECUTION_ID,
  estimateUsd: 0.05,
  maxUsd: 0.5,
  leaseSeconds: 900,
  requestLimit: 10,
  userDailyUsd: 2,
  projectDailyUsd: 5,
  activeLimit: 1,
};

const EXECUTION: ExecutionRecord = {
  id: EXECUTION_ID,
  subject_id: SUBJECT,
  conversation_id: null,
  client_request_key: 'req-1',
  payload_hash: 'hash-1',
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

function admittedResponse(overrides: Record<string, unknown> = {}): RpcResponse {
  return {
    data: {
      admitted: true,
      reason: 'admitted',
      reservation_id: 'r0000000-0000-4000-8000-000000000001',
      lease_id: 'l0000000-0000-4000-8000-000000000001',
      retry_after_seconds: 0,
      remaining_usd: '1.5',
      ...overrides,
    },
    error: null,
  };
}

// ============================================================================
// loadAdmissionConfig — fail closed at startup
// ============================================================================

describe('loadAdmissionConfig', () => {
  it('returns the owner-configurable default policy when no env is set', () => {
    const config = loadAdmissionConfig(() => undefined);
    expect(config).toEqual(DEFAULT_ADMISSION_CONFIG);
    // Default policy: 10 starts/min/user, one active execution/user, $2/day/user,
    // $0.50/execution, $5/day project.
    expect(config.requestLimitPerMinute).toBe(10);
    expect(config.activeLimit).toBe(1);
    expect(config.userDailyUsd).toBe(2);
    expect(config.maxPerExecutionUsd).toBe(0.5);
    expect(config.projectDailyUsd).toBe(5);
  });

  it('applies valid numeric overrides from the injected env reader', () => {
    const env: Record<string, string> = {
      [ADMISSION_ENV_KEYS.requestLimitPerMinute]: '25',
      [ADMISSION_ENV_KEYS.activeLimit]: '2',
      [ADMISSION_ENV_KEYS.userDailyUsd]: '3.25',
      [ADMISSION_ENV_KEYS.projectDailyUsd]: '12',
      [ADMISSION_ENV_KEYS.maxPerExecutionUsd]: '0.75',
      [ADMISSION_ENV_KEYS.leaseSeconds]: '60',
    };
    const config = loadAdmissionConfig((key) => env[key]);
    expect(config).toEqual({
      requestLimitPerMinute: 25,
      activeLimit: 2,
      userDailyUsd: 3.25,
      projectDailyUsd: 12,
      maxPerExecutionUsd: 0.75,
      leaseSeconds: 60,
    });
  });

  it('treats unset, empty, and whitespace-only values as the default', () => {
    for (const value of [undefined, '', '   ']) {
      const config = loadAdmissionConfig((key) =>
        key === ADMISSION_ENV_KEYS.userDailyUsd ? value : undefined,
      );
      expect(config.userDailyUsd).toBe(DEFAULT_ADMISSION_CONFIG.userDailyUsd);
    }
  });

  it.each([
    ['not-a-number'],
    ['-1'],
    ['0'],
    ['Infinity'],
    ['-Infinity'],
    ['NaN'],
  ])('throws AdmissionConfigError for malformed value %s', (value) => {
    let thrown: unknown;
    try {
      loadAdmissionConfig((key) =>
        key === ADMISSION_ENV_KEYS.maxPerExecutionUsd ? value : undefined,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AdmissionConfigError);
    expect((thrown as AdmissionConfigError).field).toBe(ADMISSION_ENV_KEYS.maxPerExecutionUsd);
  });

  it('validates every numeric field (a malformed project limit also fails closed)', () => {
    expect(() =>
      loadAdmissionConfig((key) =>
        key === ADMISSION_ENV_KEYS.projectDailyUsd ? 'oops' : undefined,
      ),
    ).toThrow(AdmissionConfigError);
  });
});

// ============================================================================
// resolveEffectiveLimits — server-admin grant may tighten, never loosen
// ============================================================================

describe('resolveEffectiveLimits', () => {
  it('uses the configured policy when there is no grant', () => {
    expect(resolveEffectiveLimits(DEFAULT_ADMISSION_CONFIG, null)).toEqual({
      maxPerExecutionUsd: DEFAULT_ADMISSION_CONFIG.maxPerExecutionUsd,
      userDailyUsd: DEFAULT_ADMISSION_CONFIG.userDailyUsd,
    });
  });

  it('tightens to the grant ceilings when the grant is smaller', () => {
    const limits = resolveEffectiveLimits(DEFAULT_ADMISSION_CONFIG, {
      max_daily_usd: '1.000000',
      max_per_execution_usd: '0.10',
    });
    expect(limits).toEqual({ maxPerExecutionUsd: 0.1, userDailyUsd: 1 });
  });

  it('never loosens above the configured policy', () => {
    const limits = resolveEffectiveLimits(DEFAULT_ADMISSION_CONFIG, {
      max_daily_usd: '100',
      max_per_execution_usd: '100',
    });
    expect(limits).toEqual({
      maxPerExecutionUsd: DEFAULT_ADMISSION_CONFIG.maxPerExecutionUsd,
      userDailyUsd: DEFAULT_ADMISSION_CONFIG.userDailyUsd,
    });
  });

  it('ignores malformed grant values (uses the configured policy)', () => {
    const limits = resolveEffectiveLimits(DEFAULT_ADMISSION_CONFIG, {
      max_daily_usd: 'not-a-number',
      max_per_execution_usd: null,
    });
    expect(limits).toEqual({
      maxPerExecutionUsd: DEFAULT_ADMISSION_CONFIG.maxPerExecutionUsd,
      userDailyUsd: DEFAULT_ADMISSION_CONFIG.userDailyUsd,
    });
  });
});

// ============================================================================
// admitExecution — the transactional reserve/admit RPC boundary
// ============================================================================

describe('admitExecution', () => {
  it('passes the exact admission parameters and returns the admitted decision', async () => {
    const { client, calls } = fakeAdmissionClient(() => admittedResponse());

    const result = await admitExecution(client, ADMIT_PARAMS);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe('px05_admit_execution');
    expect(calls[0]!.params).toEqual({
      p_subject_id: SUBJECT,
      p_execution_id: EXECUTION_ID,
      p_estimate_usd: 0.05,
      p_max_usd: 0.5,
      p_lease_seconds: 900,
      p_request_limit: 10,
      p_user_daily_usd: 2,
      p_project_daily_usd: 5,
      p_active_limit: 1,
    });
    expect(result.admitted).toBe(true);
    expect(result.reservationId).toBe('r0000000-0000-4000-8000-000000000001');
    expect(result.leaseId).toBe('l0000000-0000-4000-8000-000000000001');
    expect(result.remainingUsd).toBe(1.5);
    expect(result.retryAfterSeconds).toBe(0);
  });

  it('returns budget_exhausted with zero reservation when the RPC denies the budget', async () => {
    const { client } = fakeAdmissionClient(() => ({
      data: {
        admitted: false,
        reason: 'budget_exhausted',
        reservation_id: null,
        lease_id: null,
        retry_after_seconds: 0,
        remaining_usd: '0',
      },
      error: null,
    }));

    const result = await admitExecution(client, ADMIT_PARAMS);

    expect(result.admitted).toBe(false);
    expect(result.reason).toBe('budget_exhausted');
    expect(result.reservationId).toBeNull();
    expect(result.leaseId).toBeNull();
  });

  it('returns rate_limited with a retry hint when the per-minute limit is hit', async () => {
    const { client } = fakeAdmissionClient(() => ({
      data: {
        admitted: false,
        reason: 'rate_limited',
        retry_after_seconds: 42,
        remaining_usd: '1.5',
      },
      error: null,
    }));

    const result = await admitExecution(client, ADMIT_PARAMS);
    expect(result.admitted).toBe(false);
    expect(result.reason).toBe('rate_limited');
    expect(result.retryAfterSeconds).toBe(42);
  });

  it('fails CLOSED with admission_unavailable when the RPC errors (never admits)', async () => {
    const { client } = fakeAdmissionClient(() => ({
      data: null,
      error: { code: '08006', message: 'connection failure' },
    }));

    const result = await admitExecution(client, ADMIT_PARAMS);

    expect(result.admitted).toBe(false);
    expect(result.reason).toBe('admission_unavailable');
    expect(result.reservationId).toBeNull();
  });

  it('fails CLOSED with admission_unavailable when the client rejects', async () => {
    const { client } = fakeAdmissionClient(() => new Error('fetch failed'));
    const result = await admitExecution(client, ADMIT_PARAMS);
    expect(result.admitted).toBe(false);
    expect(result.reason).toBe('admission_unavailable');
  });

  it.each([[null], ['not-an-object'], [42]])(
    'fails CLOSED on a malformed RPC payload (%s)',
    async (payload) => {
      const { client } = fakeAdmissionClient(() => ({ data: payload, error: null }));
      const result = await admitExecution(client, ADMIT_PARAMS);
      expect(result.admitted).toBe(false);
      expect(result.reason).toBe('admission_unavailable');
    },
  );

  it('maps denial reasons to stable HTTP statuses (429 rate/active, 402 budget)', () => {
    expect(admissionDenialStatus('rate_limited')).toBe(429);
    expect(admissionDenialStatus('active_limit')).toBe(429);
    expect(admissionDenialStatus('budget_exhausted')).toBe(402);
    expect(admissionDenialStatus('already_settled')).toBe(409);
    expect(admissionDenialStatus('admission_unavailable')).toBe(503);
    expect(admissionDenialStatus('something_unknown')).toBe(503);
  });
});

// ============================================================================
// commit / release — never silently forgive uncertain paid work
// ============================================================================

describe('commitReservation', () => {
  it('commits a known actual amount', async () => {
    const { client, calls } = fakeAdmissionClient(() => ({
      data: { state: 'committed', updated: true, reservation_id: 'r1', committed_usd: '0.0123' },
      error: null,
    }));

    const result = await commitReservation(client, EXECUTION_ID, 0.0123);

    expect(calls[0]!.fn).toBe('px05_commit_reservation');
    expect(calls[0]!.params).toEqual({
      p_execution_id: EXECUTION_ID,
      p_actual_usd: 0.0123,
    });
    expect(result).toEqual({ ok: true, state: 'committed', updated: true });
  });

  it('marks unknown usage pending_reconcile (passes null actual, never $0)', async () => {
    const { client, calls } = fakeAdmissionClient(() => ({
      data: { state: 'pending_reconcile', updated: true, reservation_id: 'r1' },
      error: null,
    }));

    const result = await commitReservation(client, EXECUTION_ID, null);

    expect(calls[0]!.params).toEqual({ p_execution_id: EXECUTION_ID, p_actual_usd: null });
    expect(result.ok).toBe(true);
    expect(result.state).toBe('pending_reconcile');
  });

  it('does NOT report success when the commit RPC fails (so callers can reconcile)', async () => {
    const { client } = fakeAdmissionClient(() => ({
      data: null,
      error: { message: 'deadlock detected' },
    }));

    const result = await commitReservation(client, EXECUTION_ID, 0.5);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('deadlock');
  });
});

describe('releaseReservation', () => {
  it('releases a confirmed-zero reservation', async () => {
    const { client, calls } = fakeAdmissionClient(() => ({
      data: { state: 'released', updated: true, reservation_id: 'r1' },
      error: null,
    }));

    const result = await releaseReservation(client, EXECUTION_ID, 'no_provider_call');

    expect(calls[0]!.fn).toBe('px05_release_reservation');
    expect(calls[0]!.params).toEqual({
      p_execution_id: EXECUTION_ID,
      p_reason: 'no_provider_call',
    });
    expect(result).toEqual({ ok: true, state: 'released', updated: true });
  });

  it('does NOT report success when the release RPC fails', async () => {
    const { client } = fakeAdmissionClient(() => ({ data: null, error: { message: 'boom' } }));
    const result = await releaseReservation(client, EXECUTION_ID, 'no_provider_call');
    expect(result.ok).toBe(false);
  });
});

// ============================================================================
// deriveOutputTokenCap — size output caps from the admitted budget
// ============================================================================

describe('deriveOutputTokenCap', () => {
  it('caps output by the admitted budget when the budget is the binding constraint', () => {
    // $0.50 at $15/1M output => ~33,333 tokens; hard cap 200,000 is looser.
    expect(deriveOutputTokenCap(0.5, 15, 200_000)).toBe(33_333);
  });

  it('keeps the model hard cap when the budget affords more', () => {
    // $2 at $1/1M => 2,000,000 tokens; hard cap 8192 binds.
    expect(deriveOutputTokenCap(2, 1, 8192)).toBe(8192);
  });

  it('does not tighten when the output rate is unknown (0) — the hard cap remains', () => {
    expect(deriveOutputTokenCap(0.5, 0, 8192)).toBe(8192);
  });

  it('returns 0 when the admitted budget is nonpositive or nonfinite', () => {
    expect(deriveOutputTokenCap(0, 15, 8192)).toBe(0);
    expect(deriveOutputTokenCap(-1, 15, 8192)).toBe(0);
    expect(deriveOutputTokenCap(Number.NaN, 15, 8192)).toBe(0);
    expect(deriveOutputTokenCap(Number.POSITIVE_INFINITY, 15, 8192)).toBe(0);
  });
});

// ============================================================================
// Fan-out contract: deny => zero dispatch; admit => every stage/retry metered
// ============================================================================

interface StagePlan {
  name: string;
  attempts: number;
}

async function runFanout(opts: {
  admission: AdmissionClient;
  admitParams: AdmitExecutionParams;
  store: ExecutionStoreClient;
  execution: ExecutionRecord;
  stages: StagePlan[];
}): Promise<{ admitted: boolean; dispatched: number }> {
  const admission = await admitExecution(opts.admission, opts.admitParams);
  if (!admission.admitted) {
    return { admitted: false, dispatched: 0 };
  }

  let dispatched = 0;
  for (const stage of opts.stages) {
    for (let attempt = 1; attempt <= stage.attempts; attempt++) {
      await runMeteredCall(
        {
          store: opts.store,
          execution: opts.execution,
          stage: stage.name,
          participant: 'primary',
          attemptNumber: attempt,
          requestedModel: 'test-model',
          priceSnapshot: null,
        },
        async () => {
          dispatched += 1;
          return { result: 'ok' };
        },
      );
    }
  }
  return { admitted: true, dispatched };
}

describe('metered fan-out contract', () => {
  const stages: StagePlan[] = [
    { name: 'baseline', attempts: 1 },
    { name: 'debate-challenger', attempts: 2 },
    { name: 'debate-synthesis', attempts: 1 },
  ];

  it('dispatches ZERO stages when admission is denied', async () => {
    const { client: admission } = fakeAdmissionClient(() => ({
      data: {
        admitted: false,
        reason: 'budget_exhausted',
        retry_after_seconds: 0,
        remaining_usd: '0',
      },
      error: null,
    }));
    const store = fakeExecutionStore();

    const outcome = await runFanout({
      admission,
      admitParams: ADMIT_PARAMS,
      store: store.client,
      execution: EXECUTION,
      stages,
    });

    expect(outcome.admitted).toBe(false);
    expect(outcome.dispatched).toBe(0);
    expect(store.modelCalls).toHaveLength(0);
  });

  it('dispatches every stage/retry only after admission, metering each one', async () => {
    const { client: admission, calls } = fakeAdmissionClient(() => admittedResponse());
    const store = fakeExecutionStore();

    const outcome = await runFanout({
      admission,
      admitParams: ADMIT_PARAMS,
      store: store.client,
      execution: EXECUTION,
      stages,
    });

    // Admission is established exactly once, before any dispatch.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe('px05_admit_execution');
    // Every stage/retry dispatched and got its own metered ledger row.
    expect(outcome.dispatched).toBe(4);
    expect(store.modelCalls).toHaveLength(4);
    expect(store.modelCalls.map((row) => row.p_stage)).toEqual([
      'baseline',
      'debate-challenger',
      'debate-challenger',
      'debate-synthesis',
    ]);
  });
});

// ============================================================================
// Disabled video path consumes zero capacity (real handler)
// ============================================================================

const INTAKE_ENTRY = ['../../supabase/functions/video-intake/index.ts'].join('');

interface ServeHandler {
  (req: Request): Promise<Response>;
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('disabled video path (real handler)', () => {
  it('returns 404 and makes ZERO calls (no admission, no storage, no queue)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.resetModules();
    const handlers = installDenoStub({
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      // ENABLE_VIDEO_PIPELINE intentionally unset -> disabled.
    });
    await import(/* @vite-ignore */ INTAKE_ENTRY);
    const handler = handlers[0]!;

    const res = await handler(
      new Request('http://127.0.0.1:54321/functions/v1/video-intake/init', {
        method: 'POST',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: 'a.mp4', mimeType: 'video/mp4', fileSizeBytes: 1024 }),
      }),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'video_pipeline_disabled' });
    // Zero fetch calls: a disabled video path cannot consume capacity and never
    // reaches the admission RPC.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Video enqueue admission (real handler): denied => no queue row
// ============================================================================

interface IntakeFetchCall {
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

function emptyResponse(): Response {
  return new Response(null, { status: 204 });
}

function installIntakeFetchRecorder(
  routes: (call: IntakeFetchCall) => Response | null,
): IntakeFetchCall[] {
  const calls: IntakeFetchCall[] = [];
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
    const call = {
      url,
      method: method.toUpperCase(),
      body: typeof init?.body === 'string' ? init.body : '',
    };
    calls.push(call);
    return routes(call) ?? jsonResponse(null);
  });
  return calls;
}

describe('video enqueue admission (real handler)', () => {
  const ASSET_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  function completeRequest(): Request {
    return new Request('http://127.0.0.1:54321/functions/v1/video-intake/complete', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: ASSET_ID }),
    });
  }

  function intakeRoutes(admission: Response): (call: IntakeFetchCall) => Response | null {
    return (call) => {
      if (call.url.includes('/auth/v1/user')) {
        return jsonResponse({ id: SUBJECT, aud: 'authenticated', role: 'authenticated' });
      }
      if (call.url.includes('/rest/v1/rpc/get_access_grant')) {
        return jsonResponse({
          subject_id: SUBJECT,
          role: 'user',
          enabled: true,
          allowed_features: ['video'],
          max_daily_usd: null,
          max_per_execution_usd: null,
          created_at: '2026-10-06T00:00:00.000Z',
          updated_at: '2026-10-06T00:00:00.000Z',
          updated_by: null,
        });
      }
      if (call.url.includes('/rest/v1/rpc/px05_admit_execution')) {
        return admission;
      }
      if (call.method === 'GET' && call.url.includes('/rest/v1/video_assets')) {
        return jsonResponse([
          {
            id: ASSET_ID,
            user_id: SUBJECT,
            storage_bucket: 'video-uploads',
            storage_path: `${SUBJECT}/${ASSET_ID}/source.mp4`,
            status: 'pending_upload',
          },
        ]);
      }
      if (call.url.includes('/storage/v1/object/list/')) {
        return jsonResponse([{ name: 'source.mp4' }]);
      }
      if (call.method === 'PATCH') {
        return emptyResponse();
      }
      return null;
    };
  }

  it('denies the enqueue with 429 and inserts NO video_jobs row when admission denies', async () => {
    const calls = installIntakeFetchRecorder(
      intakeRoutes(
        jsonResponse({
          admitted: false,
          reason: 'rate_limited',
          retry_after_seconds: 12,
          remaining_usd: '1.5',
        }),
      ),
    );
    vi.resetModules();
    const handlers = installDenoStub({
      ENABLE_VIDEO_PIPELINE: 'true',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    });
    await import(/* @vite-ignore */ INTAKE_ENTRY);
    const handler = handlers[0]!;

    const res = await handler(completeRequest());

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('12');
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    // No queue row was written: a denied enqueue consumes no capacity.
    expect(
      calls.some((call) => call.method === 'POST' && call.url.includes('/rest/v1/video_jobs')),
    ).toBe(false);
  });
});
