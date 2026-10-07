// PX06 terminal receipt projection + authenticated lookup tests.
//
// `projectReceipt` is a pure projection over the PX03 execution ledger
// (`executions`, `model_calls`) and the PX05 reservation. `loadExecutionReceipt`
// talks to the service-role-only `px03_get_execution_receipt` RPC.
import { describe, expect, it } from 'vitest';
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

  it('falls back to the settled call sum when there is no reservation', () => {
    const receipt = projectReceipt({
      execution: execution(),
      calls: [call({ total_cost: 0.1 }), call({ participant: 'openai', total_cost: 0.2 })],
      reservation: null,
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
