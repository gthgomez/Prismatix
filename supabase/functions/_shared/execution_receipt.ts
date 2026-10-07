// PX06 terminal execution receipt.
//
// A `TerminalReceipt` is a read-only projection over the PX03 execution ledger
// (`prismatix_internal.executions`, `model_calls`) and the PX05 reservation. It
// is NOT a table: it is derived on demand from the same authority rows the
// router writes, so it can never drift from the ledger.
//
// Deno-free and dependency-free (importable by vitest, Vite and the router).

export type ExecutionReceiptStatus =
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'indeterminate'
  | 'started';

export type ReceiptCostStatus = 'settled' | 'pending' | 'estimated_legacy';

export type SettlementState = 'settled' | 'pending' | 'released';

export interface ReceiptCall {
  stage: string | null;
  participant: string | null;
  attemptNumber: number;
  servedModel: string | null;
  costStatus: ReceiptCostStatus;
  totalCost: number;
}

export interface ReceiptSettlement {
  state: SettlementState;
  committedUsd: number;
  pendingCalls: number;
}

export interface TerminalReceipt {
  executionId: string;
  status: ExecutionReceiptStatus;
  terminalOutcome: string | null;
  requestedModel: string | null;
  resolvedModel: string | null;
  servedModel: string | null;
  createdAt: string;
  finalizedAt: string | null;
  settlement: ReceiptSettlement;
  calls: ReceiptCall[];
}

// Mirrors prismatix_internal.executions (snake_case: to_jsonb(row) preserves
// the column names).
export interface RawReceiptExecution {
  id: string;
  status: ExecutionReceiptStatus;
  terminal_outcome: string | null;
  requested_model: string | null;
  resolved_model: string | null;
  served_model: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors prismatix_internal.model_calls (subset used by the receipt).
export interface RawReceiptCall {
  stage: string | null;
  participant: string | null;
  attempt_number: number;
  served_model: string | null;
  cost_status: ReceiptCostStatus;
  total_cost: number | string;
}

// Mirrors prismatix_internal.budget_reservations (subset). `null` when no
// reservation row exists for the execution.
export interface RawReceiptReservation {
  state: 'held' | 'committed' | 'released' | 'pending_reconcile';
  committed_usd: number | string;
}

export interface RawReceiptPayload {
  execution: RawReceiptExecution;
  calls?: RawReceiptCall[] | null;
  reservation?: RawReceiptReservation | null;
}

export const TERMINAL_EXECUTION_STATUSES: ReadonlySet<ExecutionReceiptStatus> = new Set([
  'completed',
  'cancelled',
  'failed',
  'indeterminate',
]);

/** numeric(12,6) may arrive as a string from PostgREST. Never invent a value. */
function toUsd(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

/**
 * Pure projection of the ledger payload into a `TerminalReceipt`.
 *
 * Settlement rules (money safety):
 *   * zero calls with a `released` reservation → `released`;
 *   * zero calls with an absent or non-`released` reservation → `pending`
 *     (a hold that was never released must never be reported as settled $0);
 *   * any call that is not `settled` → `pending` (unknown/unsettled cost is
 *     never reported as success or as $0-settled);
 *   * otherwise → `settled`.
 * `committedUsd` prefers the reservation's committed amount and falls back to
 * the sum of settled call costs (e.g. for legacy rows with no reservation).
 */
export function projectReceipt(payload: RawReceiptPayload): TerminalReceipt {
  const execution = payload.execution;
  const calls = payload.calls ?? [];
  const reservation = payload.reservation ?? null;

  const settledSum = calls
    .filter((call) => call.cost_status === 'settled')
    .reduce((sum, call) => sum + toUsd(call.total_cost), 0);
  const pendingCalls = calls.filter((call) => call.cost_status !== 'settled').length;

  let state: SettlementState;
  if (calls.length === 0) {
    state = reservation?.state === 'released' ? 'released' : 'pending';
  } else if (pendingCalls > 0) {
    state = 'pending';
  } else {
    state = 'settled';
  }

  const committedUsd = roundUsd(
    reservation !== null ? toUsd(reservation.committed_usd) : settledSum,
  );

  const finalizedAt = TERMINAL_EXECUTION_STATUSES.has(execution.status)
    ? execution.updated_at
    : null;

  return {
    executionId: execution.id,
    status: execution.status,
    terminalOutcome: execution.terminal_outcome,
    requestedModel: execution.requested_model,
    resolvedModel: execution.resolved_model,
    servedModel: execution.served_model,
    createdAt: execution.created_at,
    finalizedAt,
    settlement: { state, committedUsd, pendingCalls },
    calls: calls.map((call) => ({
      stage: call.stage,
      participant: call.participant,
      attemptNumber: call.attempt_number,
      servedModel: call.served_model,
      costStatus: call.cost_status,
      totalCost: roundUsd(toUsd(call.total_cost)),
    })),
  };
}
