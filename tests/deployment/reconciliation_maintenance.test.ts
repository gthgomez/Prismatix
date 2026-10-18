// tests/deployment/reconciliation_maintenance.test.ts
// Unit tests for durable reconciliation job processing and cleanup utility.

import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error - reconcile-jobs.mjs is an ES module without a generated d.ts
import { processReconciliationBatch } from '../../scripts/reconcile-jobs.mjs';

function makeMockSupabase(overrides: {
  pendingJobs?: any[];
  executions?: Record<string, any>;
  reservations?: Record<string, any>;
  costLogs?: Record<string, any>;
  rpcHandler?: (name: string, params: any) => Promise<any>;
  purgedCount?: number;
} = {}) {
  const updates: any[] = [];
  const costLogUpdates: any[] = [];
  const deletes: any[] = [];

  const mockSchema = {
    from: (table: string) => {
      if (table === 'reconciliation_jobs') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: overrides.pendingJobs ?? [], error: null }),
              }),
            }),
          }),
          update: (payload: any) => ({
            eq: (_field: string, id: string) => {
              updates.push({ id, payload });
              return Promise.resolve({ error: null });
            },
          }),
          delete: () => ({
            in: () => ({
              lt: () => ({
                select: () => Promise.resolve({
                  data: Array.from({ length: overrides.purgedCount ?? 0 }, (_, i) => ({ id: `p-${i}` })),
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'executions') {
        return {
          select: () => ({
            eq: (_field: string, id: string) => ({
              maybeSingle: () => Promise.resolve({
                data: overrides.executions?.[id] ?? null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'budget_reservations') {
        return {
          select: () => ({
            eq: (_field: string, id: string) => ({
              maybeSingle: () => Promise.resolve({
                data: overrides.reservations?.[id] ?? null,
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected schema table: ${table}`);
    },
  };

  const client = {
    schema: vi.fn().mockReturnValue(mockSchema),
    from: (table: string) => {
      if (table === 'cost_logs') {
        return {
          update: (payload: any) => ({
            eq: (_field: string, key: string) => {
              costLogUpdates.push({ key, payload });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      throw new Error(`Unexpected public table: ${table}`);
    },
    rpc: overrides.rpcHandler ? vi.fn().mockImplementation(overrides.rpcHandler) : undefined,
  };

  return { client, updates, costLogUpdates, deletes };
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
        return { data: null, error: null };
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
        return { data: null, error: null };
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

  it('reconciles cost_projection_failed by updating cost_logs from reservation', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [
        {
          id: 'job-cost-fail',
          kind: 'cost_projection_failed',
          execution_id: 'exec-proj',
          attempts: 0,
          payload: { total_cost: 0.045 },
        },
      ],
      reservations: {
        'exec-proj': { committed_usd: 0.045 },
      },
    });

    const summary = await processReconciliationBatch(mock.client, {
      dryRun: false,
      logger: { log: () => {}, error: () => {} },
    });

    expect(summary.processed).toBe(1);
    expect(mock.updates[0].payload.status).toBe('done');
    expect(mock.costLogUpdates).toHaveLength(1);
    expect(mock.costLogUpdates[0].payload.total_cost).toBe(0.045);
    expect(mock.costLogUpdates[0].payload.cost_status).toBe('settled');
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

  it('purges aged terminal jobs', async () => {
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
