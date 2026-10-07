// PX03 execution/call ledger identity tests.
//
// These tests exercise the ledger store and the metered-call boundary with an
// injected fake client that mirrors the service_role-only `px03_*` RPCs defined
// in supabase/migrations/20261006010000_px03_execution_ledger.sql. The fake is
// deliberately stateful (it enforces the same uniqueness/identity rules as the
// SQL) so the assertions prove the ledger's identity semantics, not just that a
// mock was called.

import { describe, expect, it } from 'vitest';
import {
  computePayloadHash,
  createExecution,
  finalizeExecution,
  recordModelCall,
  RequestKeyConflictError,
  type CostStatus,
  type ExecutionRecord,
  type ExecutionStoreClient,
  type ExecutionStoreRpcResponse,
  type ModelCallRecord,
} from '../../supabase/functions/router/execution_store.ts';
import {
  runMeteredCall,
  type PriceSnapshot,
} from '../../supabase/functions/router/metered_call.ts';

// ============================================================================
// FAKE SERVICE-ROLE CLIENT (in-memory px03_* RPCs)
// ============================================================================

interface FakeClientOptions {
  /** Fail this RPC by name. */
  failRpc?: string;
  /** Fail only the Nth (1-based) invocation of `failRpc`. */
  failAtCall?: number;
}

interface FakeClient {
  client: ExecutionStoreClient;
  executions: ExecutionRecord[];
  modelCalls: ModelCallRecord[];
  jobs: Array<Record<string, unknown>>;
  rpcCalls: Array<{ fn: string; params: Record<string, unknown> }>;
}

function createFakeClient(options: FakeClientOptions = {}): FakeClient {
  const executions: ExecutionRecord[] = [];
  const modelCalls: ModelCallRecord[] = [];
  const jobs: Array<Record<string, unknown>> = [];
  const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  const callCounts = new Map<string, number>();
  let seq = 0;
  const now = () => new Date(1_700_000_000_000 + seq * 1_000).toISOString();

  const client: ExecutionStoreClient = {
    rpc(functionName: string, params: Record<string, unknown> = {}): PromiseLike<ExecutionStoreRpcResponse> {
      rpcCalls.push({ fn: functionName, params });
      const count = (callCounts.get(functionName) ?? 0) + 1;
      callCounts.set(functionName, count);
      if (options.failRpc === functionName && (options.failAtCall ?? count) === count) {
        return Promise.resolve({
          data: null,
          error: { code: '08006', message: 'injected database failure' },
        });
      }

      switch (functionName) {
        case 'px03_create_execution': {
          const subject = params.p_subject_id as string;
          const key = params.p_client_request_key as string;
          const hash = params.p_payload_hash as string;
          const existing = executions.find(
            (e) => e.subject_id === subject && e.client_request_key === key,
          );
          if (existing) {
            if (existing.payload_hash !== hash) {
              return Promise.resolve({
                data: null,
                error: { code: 'PT409', message: 'request_key_conflict' },
              });
            }
            return Promise.resolve({ data: { execution: existing, reused: true }, error: null });
          }
          seq += 1;
          const row: ExecutionRecord = {
            id: `exec-${seq}`,
            subject_id: subject,
            conversation_id: (params.p_conversation_id as string | null) ?? null,
            client_request_key: key,
            payload_hash: hash,
            status: 'started',
            requested_mode: (params.p_requested_mode as string | null) ?? null,
            requested_model: (params.p_requested_model as string | null) ?? null,
            resolved_model: null,
            served_model: null,
            route_version: (params.p_route_version as string | null) ?? null,
            pricing_version: (params.p_pricing_version as string | null) ?? null,
            catalog_version: (params.p_catalog_version as string | null) ?? null,
            terminal_outcome: null,
            created_at: now(),
            updated_at: now(),
          };
          executions.push(row);
          return Promise.resolve({ data: { execution: row, reused: false }, error: null });
        }

        case 'px03_record_model_call': {
          const executionId = params.p_execution_id as string;
          const stage = (params.p_stage as string | null) ?? null;
          const participant = (params.p_participant as string | null) ?? null;
          const attemptNumber = (params.p_attempt_number as number | null) ?? 1;
          const existing = modelCalls.find(
            (c) =>
              c.execution_id === executionId &&
              c.stage === stage &&
              c.participant === participant &&
              c.attempt_number === attemptNumber,
          );
          const row: ModelCallRecord = {
            id: existing?.id ?? `call-${++seq}`,
            execution_id: executionId,
            stage,
            participant,
            attempt_number: attemptNumber,
            requested_model: (params.p_requested_model as string | null) ?? null,
            resolved_model: (params.p_resolved_model as string | null) ?? null,
            served_model: (params.p_served_model as string | null) ?? null,
            upstream_request_id: (params.p_upstream_request_id as string | null) ?? null,
            status: (params.p_status as string | null) ?? null,
            input_tokens: (params.p_input_tokens as number | null) ?? 0,
            output_tokens: (params.p_output_tokens as number | null) ?? 0,
            thinking_tokens: (params.p_thinking_tokens as number | null) ?? 0,
            input_cost: (params.p_input_cost as number | null) ?? 0,
            output_cost: (params.p_output_cost as number | null) ?? 0,
            thinking_cost: (params.p_thinking_cost as number | null) ?? 0,
            total_cost: (params.p_total_cost as number | null) ?? 0,
            price_snapshot: params.p_price_snapshot ?? null,
            cost_status: (params.p_cost_status as CostStatus | null) ?? 'pending',
            created_at: existing?.created_at ?? now(),
          };
          if (existing) {
            Object.assign(existing, row);
          } else {
            modelCalls.push(row);
          }
          return Promise.resolve({ data: row, error: null });
        }

        case 'px03_finalize_execution': {
          const execution = executions.find((e) => e.id === params.p_execution_id);
          if (!execution) {
            return Promise.resolve({
              data: null,
              error: { code: 'P0002', message: 'execution_not_found' },
            });
          }
          let finalized = false;
          if (execution.terminal_outcome === null) {
            execution.status = params.p_status as ExecutionRecord['status'];
            execution.terminal_outcome = (params.p_terminal_outcome as string | null) ?? null;
            if (params.p_served_model) {
              execution.served_model = params.p_served_model as string;
            }
            execution.updated_at = now();
            finalized = true;
          }
          return Promise.resolve({ data: { execution, finalized }, error: null });
        }

        case 'px03_enqueue_reconciliation': {
          seq += 1;
          const row = {
            id: `job-${seq}`,
            execution_id: params.p_execution_id ?? null,
            kind: params.p_kind,
            payload: params.p_payload ?? {},
            status: 'pending',
            attempts: 0,
            last_error: null,
            created_at: now(),
            updated_at: now(),
          };
          jobs.push(row);
          return Promise.resolve({ data: row, error: null });
        }

        default:
          return Promise.resolve({
            data: null,
            error: { code: 'PGRST202', message: `unknown rpc ${functionName}` },
          });
      }
    },
  };

  return { client, executions, modelCalls, jobs, rpcCalls };
}

// ============================================================================
// FIXTURES
// ============================================================================

const SUBJECT = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';

const PRICE: PriceSnapshot = {
  pricingVersion: '2026-10-01',
  inputRatePer1M: 1_000_000,
  outputRatePer1M: 2_000_000,
  thinkingRatePer1M: 0,
};

async function seedExecution(fake: FakeClient): Promise<ExecutionRecord> {
  const { execution } = await createExecution(fake.client, {
    subjectId: SUBJECT,
    conversationId: CONVERSATION,
    clientRequestKey: 'req-1',
    payloadHash: 'hash-1',
    requestedMode: 'chat',
    requestedModel: 'gpt-5.6-sol',
    routeVersion: 'v1',
    pricingVersion: '2026-10-01',
    catalogVersion: 'cat-1',
  });
  return execution;
}

const settledDispatch = (answer: string) => async () => ({
  result: answer,
  servedModel: 'served-model',
  usage: { inputTokens: 10, outputTokens: 5, thinkingTokens: 0 },
});

// ============================================================================
// createExecution — identity
// ============================================================================

describe('createExecution', () => {
  it('creates one execution and reuses it for the same key and payload hash', async () => {
    const fake = createFakeClient();

    const first = await createExecution(fake.client, {
      subjectId: SUBJECT,
      conversationId: CONVERSATION,
      clientRequestKey: 'req-1',
      payloadHash: 'hash-1',
    });
    const second = await createExecution(fake.client, {
      subjectId: SUBJECT,
      conversationId: CONVERSATION,
      clientRequestKey: 'req-1',
      payloadHash: 'hash-1',
    });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.execution.id).toBe(first.execution.id);
    expect(fake.executions).toHaveLength(1);
  });

  it('throws RequestKeyConflictError and records zero dispatches when the key is reused with a different payload', async () => {
    const fake = createFakeClient();
    await createExecution(fake.client, {
      subjectId: SUBJECT,
      conversationId: CONVERSATION,
      clientRequestKey: 'req-1',
      payloadHash: 'hash-1',
    });

    await expect(
      createExecution(fake.client, {
        subjectId: SUBJECT,
        conversationId: CONVERSATION,
        clientRequestKey: 'req-1',
        payloadHash: 'hash-CHANGED',
      }),
    ).rejects.toBeInstanceOf(RequestKeyConflictError);

    // No provider call and no model_calls row exists for the rejected request.
    expect(fake.modelCalls).toHaveLength(0);
    expect(fake.executions).toHaveLength(1);
  });

  it('scopes the same client request key per subject (no cross-tenant reuse)', async () => {
    const fake = createFakeClient();
    const a = await createExecution(fake.client, {
      subjectId: SUBJECT,
      conversationId: CONVERSATION,
      clientRequestKey: 'shared-key',
      payloadHash: 'hash-a',
    });
    const b = await createExecution(fake.client, {
      subjectId: '99999999-9999-4999-8999-999999999999',
      conversationId: CONVERSATION,
      clientRequestKey: 'shared-key',
      payloadHash: 'hash-b',
    });

    expect(b.reused).toBe(false);
    expect(b.execution.id).not.toBe(a.execution.id);
    expect(fake.executions).toHaveLength(2);
  });
});

// ============================================================================
// recordModelCall — distinct provider calls are distinct rows
// ============================================================================

describe('recordModelCall', () => {
  it('creates a distinct row per distinct provider call even with identical usage', async () => {
    const fake = createFakeClient();
    const execution = await seedExecution(fake);

    await recordModelCall(fake.client, {
      execution_id: execution.id,
      stage: 'debate-challenger',
      participant: 'worker-skeptic',
      attempt_number: 1,
      input_tokens: 10,
      output_tokens: 5,
      cost_status: 'settled',
    });
    await recordModelCall(fake.client, {
      execution_id: execution.id,
      stage: 'debate-challenger',
      participant: 'worker-critic',
      attempt_number: 1,
      input_tokens: 10,
      output_tokens: 5,
      cost_status: 'settled',
    });

    expect(fake.modelCalls).toHaveLength(2);
    expect(new Set(fake.modelCalls.map((c) => c.id)).size).toBe(2);
  });

  it('dedupes a retry of the same accounting event to one row', async () => {
    const fake = createFakeClient();
    const execution = await seedExecution(fake);

    const record = {
      execution_id: execution.id,
      stage: 'baseline',
      participant: 'openai',
      attempt_number: 1,
      input_tokens: 10,
      output_tokens: 5,
      cost_status: 'settled' as const,
    };
    await recordModelCall(fake.client, record);
    await recordModelCall(fake.client, record);

    expect(fake.modelCalls).toHaveLength(1);
  });
});

// ============================================================================
// runMeteredCall — the metered boundary
// ============================================================================

describe('runMeteredCall', () => {
  it('records two rows for two separate identical-usage calls', async () => {
    const fake = createFakeClient();
    const execution = await seedExecution(fake);

    const first = await runMeteredCall(
      {
        store: fake.client,
        execution,
        stage: 'baseline',
        participant: 'openai',
        attemptNumber: 1,
        requestedModel: 'gpt-5.6-sol',
        priceSnapshot: PRICE,
      },
      settledDispatch('one'),
    );
    const second = await runMeteredCall(
      {
        store: fake.client,
        execution,
        stage: 'baseline',
        participant: 'anthropic',
        attemptNumber: 1,
        requestedModel: 'claude-5-opus',
        priceSnapshot: PRICE,
      },
      settledDispatch('two'),
    );

    expect(first).toBe('one');
    expect(second).toBe('two');
    expect(fake.modelCalls).toHaveLength(2);
    expect(fake.modelCalls.every((c) => c.cost_status === 'settled')).toBe(true);
    expect(fake.modelCalls[0]!.input_tokens).toBe(10);
    expect(fake.modelCalls[0]!.output_tokens).toBe(5);
    expect(fake.modelCalls[0]!.total_cost).toBeGreaterThan(0);
  });

  it('settles a retry of the same accounting event to one row', async () => {
    const fake = createFakeClient();
    const execution = await seedExecution(fake);
    const call = {
      store: fake.client,
      execution,
      stage: 'baseline',
      participant: 'openai',
      attemptNumber: 1,
      requestedModel: 'gpt-5.6-sol',
      priceSnapshot: PRICE,
    };

    await runMeteredCall(call, settledDispatch('one'));
    await runMeteredCall(call, settledDispatch('two'));

    expect(fake.modelCalls).toHaveLength(1);
    expect(fake.modelCalls[0]!.cost_status).toBe('settled');
  });

  it('records missing usage as pending and enqueues a reconciliation job (never $0, never settled)', async () => {
    const fake = createFakeClient();
    const execution = await seedExecution(fake);

    const answer = await runMeteredCall(
      {
        store: fake.client,
        execution,
        stage: 'baseline',
        participant: 'openai',
        attemptNumber: 1,
        requestedModel: 'gpt-5.6-sol',
        priceSnapshot: PRICE,
      },
      async () => ({ result: 'answer-without-usage' }),
    );

    expect(answer).toBe('answer-without-usage');
    expect(fake.modelCalls).toHaveLength(1);
    expect(fake.modelCalls[0]!.cost_status).toBe('pending');
    expect(fake.modelCalls[0]!.total_cost).toBe(0);
    expect(fake.jobs).toHaveLength(1);
    expect(fake.jobs[0]!.kind).toBe('model_call_unsettled');
    expect(fake.jobs[0]!.execution_id).toBe(execution.id);
  });

  it('does not produce a settled receipt when the settlement write fails', async () => {
    // The pre-dispatch insert succeeds; the post-dispatch settle is the 2nd
    // record call and is injected to fail.
    const fake = createFakeClient({ failRpc: 'px03_record_model_call', failAtCall: 2 });
    const execution = await seedExecution(fake);

    const answer = await runMeteredCall(
      {
        store: fake.client,
        execution,
        stage: 'baseline',
        participant: 'openai',
        attemptNumber: 1,
        requestedModel: 'gpt-5.6-sol',
        priceSnapshot: PRICE,
      },
      settledDispatch('answer-still-streams'),
    );

    // The answer is not blocked by the accounting failure...
    expect(answer).toBe('answer-still-streams');
    // ...but no settled receipt exists.
    expect(fake.modelCalls).toHaveLength(1);
    expect(fake.modelCalls[0]!.cost_status).toBe('pending');
    // The failure is durable, not a console dead-letter.
    expect(fake.jobs).toHaveLength(1);
    expect(fake.jobs[0]!.kind).toBe('model_call_settlement_failed');
  });
});

// ============================================================================
// finalizeExecution — single terminal outcome
// ============================================================================

describe('finalizeExecution', () => {
  it('sets the terminal outcome exactly once', async () => {
    const fake = createFakeClient();
    const execution = await seedExecution(fake);

    const first = await finalizeExecution(fake.client, execution.id, {
      status: 'completed',
      terminalOutcome: 'ok',
      servedModel: 'served-model',
    });
    const second = await finalizeExecution(fake.client, execution.id, {
      status: 'failed',
      terminalOutcome: 'late-outcome',
    });

    expect(first?.status).toBe('completed');
    expect(second).not.toBeNull();
    expect(fake.executions[0]!.status).toBe('completed');
    expect(fake.executions[0]!.terminal_outcome).toBe('ok');
    expect(fake.executions[0]!.served_model).toBe('served-model');
  });
});

// ============================================================================
// computePayloadHash — stable normalized request hash
// ============================================================================

describe('computePayloadHash', () => {
  it('is stable for identical payloads regardless of key order', async () => {
    const a = await computePayloadHash({ query: 'hello', mode: 'chat', n: 1 });
    const b = await computePayloadHash({ n: 1, mode: 'chat', query: 'hello' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the payload content changes', async () => {
    const a = await computePayloadHash({ query: 'hello' });
    const b = await computePayloadHash({ query: 'goodbye' });
    expect(a).not.toBe(b);
  });
});
