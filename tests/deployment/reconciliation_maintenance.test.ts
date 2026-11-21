// tests/deployment/reconciliation_maintenance.test.ts
// Unit tests for durable reconciliation job processing and cleanup utility.
// Tests the authorized service-role RPC database access method.

import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error - reconcile-jobs.mjs is an ES module without a generated d.ts
import { processReconciliationBatch } from '../../scripts/reconcile-jobs.mjs';

function makeMockSupabase(overrides: {
  pendingJobs?: any[];
  executions?: Record<string, any>;
  reservations?: Record<string, any>;
  targets?: Record<string, any>;
  costLogs?: Record<string, any>;
  rpcHandler?: (name: string, params: any) => Promise<any>;
  purgedCount?: number;
  assistantMessages?: Record<string, any>;
} = {}) {
  const updates: any[] = [];
  const costLogUpdates: any[] = [];
  const costLogInserts: any[] = [];

  const costLogsStore: Record<string, any> = { ...(overrides.costLogs ?? {}) };
  const assistantMessages = { ...(overrides.assistantMessages ?? {}) };

  const rpc = vi.fn().mockImplementation(async (name: string, params: any) => {
    if (overrides.rpcHandler) {
      const custom = await overrides.rpcHandler(name, params);
      if (custom !== undefined) return custom;
    }

    if (name === 'px03_get_pending_reconciliation_jobs') {
      return { data: overrides.pendingJobs ?? [], error: null };
    }

    if (name === 'px03_update_reconciliation_job') {
      updates.push({ id: params.p_job_id, payload: { status: params.p_status, attempts: params.p_attempts, last_error: params.p_error } });
      return { data: { id: params.p_job_id, status: params.p_status }, error: null };
    }

    if (name === 'px03_inspect_reconciliation_target') {
      const execId = params.p_execution_id;
      if (overrides.targets?.[execId]) {
        return { data: overrides.targets[execId], error: null };
      }
      const exec = overrides.executions?.[execId] ?? { id: execId, status: 'completed', subject_id: 'user-1', conversation_id: 'conv-1' };
      const res = overrides.reservations?.[execId] ?? { id: 'res-1', state: 'committed', committed_usd: 0.05 };
      return {
        data: {
          execution: exec,
          reservation: res,
          total_calls: 1,
          pending_calls: 0,
          settled_calls: 1,
          settled_cost: res.committed_usd ?? 0.05,
        },
        error: null,
      };
    }

    if (name === 'px05_commit_from_ledger') {
      return {
        data: {
          state: 'committed',
          committed_usd: 0.05,
          updated: true,
        },
        error: null,
      };
    }

    if (name === 'px03_purge_reconciliation_jobs') {
      return { data: overrides.purgedCount ?? 0, error: null };
    }

    throw new Error(`Unexpected RPC call: ${name}`);
  });

  const client = {
    from: (table: string) => {
      if (table === 'cost_logs') {
        return {
          select: () => ({
            eq: (_field: string, key: string) => ({
              maybeSingle: () => Promise.resolve({
                data: costLogsStore[key] ? { id: 'cl-1', ...costLogsStore[key] } : null,
                error: null,
              }),
            }),
          }),
          update: (payload: any) => ({
            eq: (_field: string, key: string) => {
              costLogUpdates.push({ key, payload });
              costLogsStore[key] = { ...(costLogsStore[key] ?? {}), ...payload };
              return Promise.resolve({ error: null });
            },
          }),
          insert: (payload: any) => {
            costLogInserts.push(payload);
            costLogsStore[payload.idempotency_key] = payload;
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'messages') {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            const query = {
              eq: (field: string, value: unknown) => {
                filters[field] = value;
                return query;
              },
              maybeSingle: () => {
                const row = assistantMessages[String(filters.execution_id)];
                const matches = row && Object.entries(filters).every(([key, value]) => row[key] === value);
                return Promise.resolve({ data: matches ? row : null, error: null });
              },
            };
            return query;
          },
        };
      }
      throw new Error(`Unexpected public table: ${table}`);
    },
    rpc,
  };

  return { client, updates, costLogUpdates, costLogInserts };
}

describe('processReconciliationBatch', () => {
  it('processes dry-run without writing mutations', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [
        { id: 'job-1', kind: 'receipt_projection_failed', execution_id: 'exec-1', attempts: 0 },
      ],
    });

    const summary = await processReconciliationBatch(mock.client, {
      dryRun: true,
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.scanned).toBe(1);
    expect(summary.processed).toBe(1);
    expect(mock.updates).toHaveLength(0);
  });

  it('marks completed execution receipt jobs as done (terminal execution status)', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [
        { id: 'job-1', kind: 'receipt_projection_failed', execution_id: 'exec-1', attempts: 0 },
      ],
      executions: {
        'exec-1': { id: 'exec-1', status: 'completed' },
      },
    });

    const summary = await processReconciliationBatch(mock.client, {
      dryRun: false,
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(1);
    expect(mock.updates).toHaveLength(1);
    expect(mock.updates[0].id).toBe('job-1');
    expect(mock.updates[0].payload.status).toBe('done');
    expect(mock.updates[0].payload.attempts).toBe(1);
  });

  it('keeps budget_estimated pending when calls are still pending (unsettled)', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [
        {
          id: 'job-est-pending',
          kind: 'budget_estimated',
          execution_id: 'exec-pending-calls',
          attempts: 0,
          payload: { estimated_usd: 0.05 },
        },
      ],
      targets: {
        'exec-pending-calls': {
          execution: { id: 'exec-pending-calls', status: 'started' },
          reservation: { id: 'res-1', state: 'held', amount_usd: 0.05 },
          total_calls: 2,
          pending_calls: 1, // 1 call still unresolved
          settled_calls: 1,
          settled_cost: 0.02,
        },
      },
    });

    const summary = await processReconciliationBatch(mock.client, {
      dryRun: false,
      maxAttempts: 3,
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(0);
    expect(mock.updates).toHaveLength(1);
    expect(mock.updates[0].payload.status).toBe('pending');
    expect(mock.updates[0].payload.last_error).toBe('calls_still_pending');
  });

  it('reconciles budget_estimated with downward true-up updating cost_logs', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [
        {
          id: 'job-est-1',
          kind: 'budget_estimated',
          execution_id: 'exec-downward',
          attempts: 0,
          payload: { estimated_usd: 0.05 },
        },
      ],
      costLogs: {
        'exec-downward': { total_cost: 0.05, cost_status: 'pending' },
      },
      rpcHandler: async (fn, _params) => {
        if (fn === 'px05_commit_from_ledger') {
          return {
            data: {
              state: 'committed',
              committed_usd: 0.035,
              updated: true,
            },
            error: null,
          };
        }
        return undefined;
      },
    });

    const summary = await processReconciliationBatch(mock.client, {
      dryRun: false,
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(1);
    expect(mock.updates).toHaveLength(1);
    expect(mock.updates[0].id).toBe('job-est-1');
    expect(mock.updates[0].payload.status).toBe('done');
    expect(mock.costLogUpdates).toHaveLength(1);
    expect(mock.costLogUpdates[0].key).toBe('exec-downward');
    expect(mock.costLogUpdates[0].payload.total_cost).toBe(0.035);
    expect(mock.costLogUpdates[0].payload.cost_status).toBe('settled');
  });

  it('reconciles budget_estimated with upward true-up updating cost_logs', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [
        {
          id: 'job-est-2',
          kind: 'budget_estimated',
          execution_id: 'exec-upward',
          attempts: 0,
          payload: { estimated_usd: 0.03 },
        },
      ],
      costLogs: {
        'exec-upward': { total_cost: 0.03, cost_status: 'pending' },
      },
      rpcHandler: async (fn, _params) => {
        if (fn === 'px05_commit_from_ledger') {
          return {
            data: {
              state: 'committed',
              committed_usd: 0.07,
              updated: true,
            },
            error: null,
          };
        }
        return undefined;
      },
    });

    const summary = await processReconciliationBatch(mock.client, {
      dryRun: false,
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(1);
    expect(mock.costLogUpdates).toHaveLength(1);
    expect(mock.costLogUpdates[0].key).toBe('exec-upward');
    expect(mock.costLogUpdates[0].payload.total_cost).toBe(0.07);
    expect(mock.costLogUpdates[0].payload.cost_status).toBe('settled');
  });

  it('reconciles cost_projection_failed by recreating missing cost_logs row', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [
        {
          id: 'job-cost-fail',
          kind: 'cost_projection_failed',
          execution_id: 'exec-missing-proj',
          attempts: 0,
          payload: { total_cost: 0.045 },
        },
      ],
      costLogs: {}, // missing cost_logs row!
      reservations: {
        'exec-missing-proj': { state: 'committed', committed_usd: 0.045 },
      },
    });

    const summary = await processReconciliationBatch(mock.client, {
      dryRun: false,
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(1);
    expect(mock.updates[0].payload.status).toBe('done');
    expect(mock.costLogInserts).toHaveLength(1);
    expect(mock.costLogInserts[0].idempotency_key).toBe('exec-missing-proj');
    expect(mock.costLogInserts[0].total_cost).toBe(0.045);
    expect(mock.costLogInserts[0].cost_status).toBe('settled');
  });

  it.each([
    ['held reservation with a pending call', {
      reservation: { state: 'held', committed_usd: 0 },
      total_calls: 1, pending_calls: 1, settled_calls: 0, settled_cost: 0,
    }],
    ['missing reservation and no calls', {
      reservation: null,
      total_calls: 0, pending_calls: 0, settled_calls: 0, settled_cost: 0,
    }],
    ['released reservation despite call rows', {
      reservation: { state: 'released', committed_usd: 0 },
      total_calls: 1, pending_calls: 0, settled_calls: 1, settled_cost: 0.045,
    }],
    ['committed reservation with invalid amount', {
      reservation: { state: 'committed', committed_usd: null },
      total_calls: 1, pending_calls: 0, settled_calls: 1, settled_cost: null,
    }],
    ['missing call counts', {
      reservation: { state: 'committed', committed_usd: 0.045 },
      total_calls: 1, settled_calls: 1, settled_cost: 0.045,
    }],
    ['negative settled-call sum for a legacy execution', {
      reservation: null,
      total_calls: 1, pending_calls: 0, settled_calls: 1, settled_cost: -0.045,
    }],
  ])('keeps cost_projection_failed unresolved for %s', async (_description, target) => {
    const mock = makeMockSupabase({
      pendingJobs: [{ id: 'job-cost-unsettled', kind: 'cost_projection_failed', execution_id: 'exec-unsettled', attempts: 0 }],
      targets: {
        'exec-unsettled': {
          execution: { id: 'exec-unsettled', status: 'completed', subject_id: 'user-1', conversation_id: 'conv-1' },
          ...target,
        },
      },
    });

    const summary = await processReconciliationBatch(mock.client, {
      dryRun: false,
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(0);
    expect(mock.updates[0].payload.status).toBe('pending');
    expect(mock.costLogInserts).toHaveLength(0);
    expect(mock.costLogUpdates).toHaveLength(0);
  });

  it('projects a valid committed zero cost as settled', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [{ id: 'job-zero', kind: 'cost_projection_failed', execution_id: 'exec-zero', attempts: 0 }],
      targets: {
        'exec-zero': {
          execution: { id: 'exec-zero', status: 'completed', subject_id: 'user-1', conversation_id: 'conv-1' },
          reservation: { state: 'committed', committed_usd: 0 },
          total_calls: 1, pending_calls: 0, settled_calls: 1, settled_cost: 0,
        },
      },
    });

    const summary = await processReconciliationBatch(mock.client, {
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(1);
    expect(mock.costLogInserts[0].total_cost).toBe(0);
    expect(mock.costLogInserts[0].cost_status).toBe('settled');
    expect(mock.updates[0].payload.status).toBe('done');
  });

  it('does not project a committed reservation with zero calls as settled', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [{ id: 'job-committed-no-calls', kind: 'cost_projection_failed', execution_id: 'exec-committed-no-calls', attempts: 0 }],
      targets: {
        'exec-committed-no-calls': {
          execution: { id: 'exec-committed-no-calls', status: 'completed', subject_id: 'user-1', conversation_id: 'conv-1' },
          reservation: { state: 'committed', committed_usd: 0 },
          total_calls: 0, pending_calls: 0, settled_calls: 0, settled_cost: 0,
        },
      },
    });

    const summary = await processReconciliationBatch(mock.client, {
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(0);
    expect(mock.updates[0].payload.status).toBe('pending');
    expect(mock.costLogInserts).toHaveLength(0);
  });

  it('uses the settled call sum for a legacy execution without a reservation', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [{ id: 'job-legacy', kind: 'cost_projection_failed', execution_id: 'exec-legacy', attempts: 0 }],
      targets: {
        'exec-legacy': {
          execution: { id: 'exec-legacy', status: 'completed', subject_id: 'user-1', conversation_id: 'conv-1' },
          reservation: null,
          total_calls: 2, pending_calls: 0, settled_calls: 2, settled_cost: '0.025',
        },
      },
    });

    const summary = await processReconciliationBatch(mock.client, {
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(1);
    expect(mock.costLogInserts[0].total_cost).toBe(0.025);
    expect(mock.costLogInserts[0].cost_status).toBe('settled');
  });

  it('projects a released no-call reservation as an authoritative zero', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [{ id: 'job-released-zero', kind: 'cost_projection_failed', execution_id: 'exec-released-zero', attempts: 0 }],
      targets: {
        'exec-released-zero': {
          execution: { id: 'exec-released-zero', status: 'completed', subject_id: 'user-1', conversation_id: 'conv-1' },
          reservation: { state: 'released', committed_usd: 0 },
          total_calls: 0, pending_calls: 0, settled_calls: 0, settled_cost: 0,
        },
      },
    });

    const summary = await processReconciliationBatch(mock.client, {
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(1);
    expect(mock.costLogInserts[0].total_cost).toBe(0);
    expect(mock.costLogInserts[0].cost_status).toBe('settled');
  });

  it('does not fabricate zero for a budget_estimated result without a committed amount', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [{ id: 'job-est-missing-cost', kind: 'budget_estimated', execution_id: 'exec-est-missing-cost', attempts: 0 }],
      targets: {
        'exec-est-missing-cost': {
          execution: { id: 'exec-est-missing-cost', status: 'completed' },
          reservation: { id: 'res-1', state: 'pending_reconcile', committed_usd: null },
          total_calls: 1, pending_calls: 0, settled_calls: 1, settled_cost: 0.05,
        },
      },
      rpcHandler: async (fn) => fn === 'px05_commit_from_ledger'
        ? { data: { state: 'committed' }, error: null }
        : undefined,
    });

    const summary = await processReconciliationBatch(mock.client, {
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(0);
    expect(mock.updates[0].payload.status).toBe('pending');
    expect(mock.costLogUpdates).toHaveLength(0);
    expect(mock.costLogInserts).toHaveLength(0);
  });

  it('does not fabricate zero for a released budget_estimated result without an amount', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [{ id: 'job-est-released-missing', kind: 'budget_estimated', execution_id: 'exec-est-released-missing', attempts: 0 }],
      targets: {
        'exec-est-released-missing': {
          execution: { id: 'exec-est-released-missing', status: 'completed' },
          reservation: { id: 'res-1', state: 'released', committed_usd: 0 },
          total_calls: 0, pending_calls: 0, settled_calls: 0, settled_cost: 0,
        },
      },
      rpcHandler: async (fn) => fn === 'px05_commit_from_ledger'
        ? { data: { state: 'released' }, error: null }
        : undefined,
    });

    const summary = await processReconciliationBatch(mock.client, {
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(0);
    expect(mock.updates[0].payload.status).toBe('pending');
    expect(mock.costLogUpdates).toHaveLength(0);
    expect(mock.costLogInserts).toHaveLength(0);
  });

  it.each([
    ['missing call counts', { total_calls: 1, settled_calls: 1 }],
    ['negative pending-call count', { total_calls: 1, pending_calls: -1, settled_calls: 1 }],
  ])('keeps budget_estimated unresolved for %s', async (_description, counts) => {
    let commitCalled = false;
    const mock = makeMockSupabase({
      pendingJobs: [{ id: 'job-est-bad-counts', kind: 'budget_estimated', execution_id: 'exec-est-bad-counts', attempts: 0 }],
      targets: {
        'exec-est-bad-counts': {
          execution: { id: 'exec-est-bad-counts', status: 'completed' },
          reservation: { id: 'res-1', state: 'pending_reconcile', committed_usd: null },
          ...counts,
        },
      },
      rpcHandler: async (fn) => {
        if (fn === 'px05_commit_from_ledger') commitCalled = true;
        return undefined;
      },
    });

    const summary = await processReconciliationBatch(mock.client, {
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(0);
    expect(mock.updates[0].payload.status).toBe('pending');
    expect(commitCalled).toBe(false);
  });

  it('does not use a negative committed amount from budget_estimated settlement', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [{ id: 'job-est-negative', kind: 'budget_estimated', execution_id: 'exec-est-negative', attempts: 0 }],
      targets: {
        'exec-est-negative': {
          execution: { id: 'exec-est-negative', status: 'completed' },
          reservation: { id: 'res-1', state: 'pending_reconcile', committed_usd: null },
          total_calls: 1, pending_calls: 0, settled_calls: 1, settled_cost: 0.05,
        },
      },
      rpcHandler: async (fn) => fn === 'px05_commit_from_ledger'
        ? { data: { state: 'committed', committed_usd: -0.01 }, error: null }
        : undefined,
    });

    const summary = await processReconciliationBatch(mock.client, {
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(0);
    expect(mock.updates[0].payload.status).toBe('pending');
    expect(mock.costLogUpdates).toHaveLength(0);
    expect(mock.costLogInserts).toHaveLength(0);
  });

  it('does not settle budget_estimated while execution finalization is pending', async () => {
    let commitCalled = false;
    const mock = makeMockSupabase({
      pendingJobs: [{ id: 'job-est-open', kind: 'budget_estimated', execution_id: 'exec-est-open', attempts: 0 }],
      targets: {
        'exec-est-open': {
          execution: { id: 'exec-est-open', status: 'started' },
          reservation: { id: 'res-1', state: 'committed', committed_usd: 0.05 },
          total_calls: 1, pending_calls: 0, settled_calls: 1, settled_cost: 0.05,
        },
      },
      rpcHandler: async (fn) => {
        if (fn === 'px05_commit_from_ledger') commitCalled = true;
        return undefined;
      },
    });

    const summary = await processReconciliationBatch(mock.client, {
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(0);
    expect(mock.updates[0].payload.status).toBe('pending');
    expect(commitCalled).toBe(false);
    expect(mock.costLogUpdates).toHaveLength(0);
  });

  it('does not accept a committed budget_estimated result when the ledger has zero calls', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [{ id: 'job-est-no-calls', kind: 'budget_estimated', execution_id: 'exec-est-no-calls', attempts: 0 }],
      targets: {
        'exec-est-no-calls': {
          execution: { id: 'exec-est-no-calls', status: 'completed' },
          reservation: { id: 'res-1', state: 'committed', committed_usd: 0 },
          total_calls: 0, pending_calls: 0, settled_calls: 0, settled_cost: 0,
        },
      },
      rpcHandler: async (fn) => fn === 'px05_commit_from_ledger'
        ? { data: { state: 'committed', committed_usd: 0 }, error: null }
        : undefined,
    });

    const summary = await processReconciliationBatch(mock.client, {
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(0);
    expect(mock.updates[0].payload.status).toBe('pending');
    expect(mock.costLogUpdates).toHaveLength(0);
  });

  it('increments attempts on unsettled execution and marks failed when max attempts reached', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [
        { id: 'job-unsettled', kind: 'receipt_projection_failed', execution_id: 'exec-open', attempts: 2 },
      ],
      executions: {
        'exec-open': { id: 'exec-open', status: 'started' },
      },
    });

    const summary = await processReconciliationBatch(mock.client, {
      dryRun: false,
      maxAttempts: 3,
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.failed).toBe(1);
    expect(mock.updates).toHaveLength(1);
    expect(mock.updates[0].payload.status).toBe('failed');
    expect(mock.updates[0].payload.attempts).toBe(3);
    expect(mock.updates[0].payload.last_error).toBe('execution_unsettled');
  });

  it('marks refund_lease jobs as done', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [
        { id: 'job-refund', kind: 'refund_lease', execution_id: 'exec-2', attempts: 0 },
      ],
    });

    const summary = await processReconciliationBatch(mock.client, {
      dryRun: false,
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(1);
    expect(mock.updates[0].payload.status).toBe('done');
  });

  it('purges aged terminal jobs via RPC', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [],
      purgedCount: 5,
    });

    const summary = await processReconciliationBatch(mock.client, {
      dryRun: false,
      purgeDays: 14,
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.purged).toBe(5);
  });

  it('marks missing assistant transcript as unresolved manual recovery, without fabricating a repair', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [{ id: 'job-transcript', kind: 'assistant_transcript_failed', execution_id: 'exec-1', attempts: 0,
        payload: { userId: 'user-1', conversationId: 'conv-1' } }],
    });

    const summary = await processReconciliationBatch(mock.client, { dryRun: false, purgeDays: 0, logger: { log: () => {}, error: () => {} } });

    expect(summary.failed).toBe(1);
    expect(mock.updates[0].payload).toMatchObject({ status: 'failed', last_error: 'assistant_transcript_missing_manual_recovery_required' });
  });

  it('only resolves assistant transcript failure when the owner-scoped durable row exists', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [{ id: 'job-transcript', kind: 'assistant_transcript_failed', execution_id: 'exec-1', attempts: 0,
        payload: { userId: 'user-1', conversationId: 'conv-1' } }],
      assistantMessages: { 'exec-1': { id: 'message-1', execution_id: 'exec-1', user_id: 'user-1', conversation_id: 'conv-1', role: 'assistant' } },
    });

    const summary = await processReconciliationBatch(mock.client, { dryRun: false, purgeDays: 0, logger: { log: () => {}, error: () => {} } });

    expect(summary.processed).toBe(1);
    expect(mock.updates[0].payload).toMatchObject({ status: 'done', last_error: 'assistant_transcript_exists_verified' });
  });

  it('does not inspect or resolve a transcript job whose account/conversation scope differs from the execution', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [{ id: 'job-transcript-owner', kind: 'assistant_transcript_failed', execution_id: 'exec-1', attempts: 0,
        payload: { userId: 'another-user', conversationId: 'conv-1' } }],
    });

    const summary = await processReconciliationBatch(mock.client, { dryRun: false, purgeDays: 0, logger: { log: () => {}, error: () => {} } });

    expect(summary.failed).toBe(1);
    expect(mock.updates[0].payload).toMatchObject({ status: 'failed', last_error: 'assistant_transcript_owner_mismatch_manual_review' });
  });
});
