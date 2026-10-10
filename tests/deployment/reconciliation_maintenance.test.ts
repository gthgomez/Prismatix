// tests/deployment/reconciliation_maintenance.test.ts
// Unit tests for durable reconciliation job processing and cleanup utility.

import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error - reconcile-jobs.mjs is an ES module without a generated d.ts
import { processReconciliationBatch } from '../../scripts/reconcile-jobs.mjs';

function makeMockSupabase(overrides: {
  pendingJobs?: any[];
  executions?: Record<string, any>;
  purgedCount?: number;
} = {}) {
  const updates: any[] = [];
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
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const client = {
    schema: vi.fn().mockReturnValue(mockSchema),
  };

  return { client, updates, deletes };
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

  it('marks settled execution receipt jobs as done', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [
        { id: 'job-1', kind: 'receipt_projection_failed', execution_id: 'exec-1', attempts: 0 },
      ],
      executions: {
        'exec-1': { id: 'exec-1', status: 'settled', settled_cost_usd: 0.001 },
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

  it('increments attempts on unsettled execution and marks failed when max attempts reached', async () => {
    const mock = makeMockSupabase({
      pendingJobs: [
        { id: 'job-unsettled', kind: 'receipt_projection_failed', execution_id: 'exec-open', attempts: 2 },
      ],
      executions: {
        'exec-open': { id: 'exec-open', status: 'running' },
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
