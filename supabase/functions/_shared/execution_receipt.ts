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

export interface ReceiptCallUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
}

export interface ReceiptCallCosts {
  inputUsd: number;
  outputUsd: number;
  thinkingUsd: number;
}

export interface ReceiptCall {
  stage: string | null;
  participant: string | null;
  attemptNumber: number;
  servedModel: string | null;
  costStatus: ReceiptCostStatus;
  totalCost: number;
  /**
   * Provider-reported usage for this call, present only when the ledger row
   * carries a complete, valid set. Callers must treat an absent value as
   * "unknown", never as zero.
   */
  usage?: ReceiptCallUsage;
  /** Ledger-projected component costs for this call, when complete and valid. */
  costs?: ReceiptCallCosts;
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
  /**
   * PX07: whether the assistant transcript was durably persisted. Optional and
   * omitted when unknown; a post-inference persistence failure reports
   * `{ saved: false }` (never a false durable claim).
   */
  transcript?: { saved: boolean };
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
  total_cost?: number | string | null;
  input_tokens?: number | string | null;
  output_tokens?: number | string | null;
  thinking_tokens?: number | string | null;
  input_cost?: number | string | null;
  output_cost?: number | string | null;
  thinking_cost?: number | string | null;
}

// Mirrors prismatix_internal.budget_reservations (subset). `null` when no
// reservation row exists for the execution.
export interface RawReceiptReservation {
  state: 'held' | 'committed' | 'released' | 'pending_reconcile';
  committed_usd?: number | string | null;
}

export interface RawReceiptPayload {
  execution: RawReceiptExecution;
  calls?: RawReceiptCall[] | null;
  reservation?: RawReceiptReservation | null;
  /**
   * PX07: optional transcript durability marker supplied by the caller (the
   * ledger does not persist it). Passed through unchanged when present.
   */
  transcript?: { saved: boolean } | null;
}

export const TERMINAL_EXECUTION_STATUSES: ReadonlySet<ExecutionReceiptStatus> = new Set([
  'completed',
  'cancelled',
  'failed',
  'indeterminate',
]);

/** numeric(12,6) may arrive as a string from PostgREST. Reject invalid money. */
function parseUsd(value: number | string | null | undefined): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === 'string') {
    if (value.trim() === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
}

/** Token counts must be non-negative integers; anything else is unknown. */
function parseTokenCount(value: number | string | null | undefined): number | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === 'string') {
    if (value.trim() === '') return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
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
 *   * settled calls with a present reservation are settled only when that
 *     reservation is `committed`; unresolved or released reservations remain
 *     `pending`;
 *   * settled calls with no reservation retain the legacy settled-call sum.
 * `committedUsd` prefers a valid reservation amount. The settled call sum is
 * used only for legacy rows with no reservation; a present malformed amount
 * keeps the receipt pending rather than fabricating a settled zero.
 */
export function projectReceipt(payload: RawReceiptPayload): TerminalReceipt {
  const execution = payload.execution;
  const calls = payload.calls ?? [];
  const reservation = payload.reservation ?? null;

  const projectedCalls = calls.map((call) => {
    const totalCost = parseUsd(call.total_cost);
    return {
      call,
      totalCost: totalCost ?? 0,
      costStatus: call.cost_status === 'settled' && totalCost === undefined
        ? 'pending' as const
        : call.cost_status,
    };
  });
  const settledSum = projectedCalls
    .filter((item) => item.costStatus === 'settled')
    .reduce((sum, item) => sum + item.totalCost, 0);
  const pendingCalls = projectedCalls.filter((item) => item.costStatus !== 'settled').length;
  const reservationAmount = reservation ? parseUsd(reservation.committed_usd) : undefined;
  const reservationAmountInvalid = reservation !== null && reservationAmount === undefined;

  let state: SettlementState;
  if (reservationAmountInvalid) {
    state = 'pending';
  } else if (calls.length === 0) {
    state = reservation?.state === 'released' ? 'released' : 'pending';
  } else if (pendingCalls > 0) {
    state = 'pending';
  } else if (reservation && reservation.state !== 'committed') {
    state = 'pending';
  } else {
    state = 'settled';
  }

  const committedUsd = roundUsd(reservation ? reservationAmount ?? 0 : settledSum);

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
    calls: projectedCalls.map(({ call, costStatus, totalCost }) => {
      const promptTokens = parseTokenCount(call.input_tokens);
      const completionTokens = parseTokenCount(call.output_tokens);
      const reasoningTokens = parseTokenCount(call.thinking_tokens);
      const inputUsd = parseUsd(call.input_cost);
      const outputUsd = parseUsd(call.output_cost);
      const thinkingUsd = parseUsd(call.thinking_cost);
      const usage = promptTokens !== undefined && completionTokens !== undefined && reasoningTokens !== undefined
        ? { promptTokens, completionTokens, reasoningTokens }
        : undefined;
      const costs = inputUsd !== undefined && outputUsd !== undefined && thinkingUsd !== undefined
        ? { inputUsd, outputUsd, thinkingUsd }
        : undefined;
      return {
        stage: call.stage,
        participant: call.participant,
        attemptNumber: call.attempt_number,
        servedModel: call.served_model,
        costStatus,
        totalCost: roundUsd(totalCost),
        ...(usage ? { usage } : {}),
        ...(costs ? { costs } : {}),
      };
    }),
    ...(payload.transcript ? { transcript: payload.transcript } : {}),
  };
}

/**
 * Authoritative per-execution usage/cost breakdown for a SETTLED receipt.
 *
 * The cost log must never present a component breakdown that disagrees with
 * its own settled total (or with provider-reported usage). This sums the
 * ledger's per-call rows — the same authority the reservation was committed
 * from — and returns `null` unless every settled call reports complete usage
 * and component costs AND the components reconcile with the settled amount.
 * Callers must treat `null` as "breakdown unavailable", never as zero.
 */
export interface SettledBreakdown {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  reasoningCostUsd: number;
  totalUsd: number;
}

export function deriveSettledBreakdown(receipt: TerminalReceipt): SettledBreakdown | null {
  if (receipt.settlement.state !== 'settled' || receipt.calls.length === 0) {
    return null;
  }
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;
  let inputCostUsd = 0;
  let outputCostUsd = 0;
  let reasoningCostUsd = 0;
  for (const call of receipt.calls) {
    if (call.costStatus !== 'settled' || !call.usage || !call.costs) {
      return null;
    }
    promptTokens += call.usage.promptTokens;
    completionTokens += call.usage.completionTokens;
    reasoningTokens += call.usage.reasoningTokens;
    inputCostUsd += call.costs.inputUsd;
    outputCostUsd += call.costs.outputUsd;
    reasoningCostUsd += call.costs.thinkingUsd;
  }
  const totalUsd = receipt.settlement.committedUsd;
  const componentSum = inputCostUsd + outputCostUsd + reasoningCostUsd;
  // Each stored component is numeric(12,6); summing N rows can drift by at
  // most N*0.5e-6 from the settled amount. Anything larger is a real
  // disagreement, not rounding, and must not be presented as a breakdown.
  const tolerance = 1e-6 * (receipt.calls.length + 1);
  if (Math.abs(componentSum - totalUsd) > tolerance) {
    return null;
  }
  return {
    promptTokens,
    completionTokens,
    reasoningTokens,
    inputCostUsd: roundUsd(inputCostUsd),
    outputCostUsd: roundUsd(outputCostUsd),
    reasoningCostUsd: roundUsd(reasoningCostUsd),
    totalUsd: roundUsd(totalUsd),
  };
}
