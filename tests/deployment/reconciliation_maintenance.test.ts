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
} = {}) {
  const updates: any[] = [];
  const costLogUpdates: any[] = [];
  const costLogInserts: any[] = [];

  const costLogsStore: Record<string, any> = { ...(overrides.costLogs ?? {}) };

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
        'exec-missing-proj': { committed_usd: 0.045 },
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
});
