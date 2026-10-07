// metered_call.ts - The metered provider-dispatch boundary (PX03).
//
// Every provider invocation that should be counted goes through runMeteredCall.
// It durably records a model_calls row BEFORE the dispatch, invokes the
// dispatch function, then updates that SAME row with the served model and the
// normalized usage/cost. Identity comes from
// (execution_id, stage, participant, attempt_number), so two distinct provider
// calls always produce two rows even when their token counts are identical,
// while a retry of the same accounting event dedupes to one row.
//
// FAIL-CLOSED ACCOUNTING: a missing or unknown usage/price never produces a
// `settled` receipt and never fabricates `$0`. It stays `pending` and enqueues
// a durable reconciliation job. A ledger write failure must not block the
// answer stream, but it also must never look like a successful settlement.

import {
  enqueueReconciliation,
  recordModelCall,
  type CostStatus,
  type ExecutionRecord,
  type ExecutionStoreClient,
  type ModelCallRecord,
  type RecordModelCallInput,
} from './execution_store.ts';

const TOKENS_PER_MILLION = 1_000_000;

// ============================================================================
// TYPES
// ============================================================================

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

// Server-supplied authoritative price snapshot. Callers cannot choose their own
// prices: this object is produced by the router's pricing registry, never by a
// client request.
export interface PriceSnapshot {
  pricingVersion?: string;
  inputRatePer1M?: number;
  outputRatePer1M?: number;
  thinkingRatePer1M?: number;
}

export interface MeteredDispatchResult<T> {
  result: T;
  servedModel?: string | null;
  upstreamRequestId?: string | null;
  usage?: NormalizedUsage | null;
  status?: string | null;
}

export interface RunMeteredCallInput {
  store: ExecutionStoreClient;
  execution: ExecutionRecord;
  stage: string;
  participant: string;
  attemptNumber?: number;
  requestedModel?: string | null;
  resolvedModel?: string | null;
  priceSnapshot?: PriceSnapshot | null;
}

// Per-dispatch metering context threaded from a request handler into every
// provider invocation. `attemptNumber` is allocated per (stage, participant) by
// a factory so each actual dispatch gets a distinct ledger identity.
export interface MeteredCallContext {
  store: ExecutionStoreClient;
  execution: ExecutionRecord;
  stage: string;
  participant: string;
  attemptNumber: number;
  requestedModel: string;
  priceSnapshot: PriceSnapshot | null;
}

export type MeteredCallFactory = (
  stage: string,
  participant: string,
  requestedModel: string,
  priceSnapshot?: PriceSnapshot | null,
) => MeteredCallContext | null;

interface ComputedCosts {
  inputCost: number;
  outputCost: number;
  thinkingCost: number;
  totalCost: number;
}

// ============================================================================
// NORMALIZATION
// ============================================================================

function normalizeToken(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function normalizeUsage(usage: NormalizedUsage | null | undefined): NormalizedUsage | null {
  if (!usage) return null;
  const inputTokens = normalizeToken(usage.inputTokens);
  const outputTokens = normalizeToken(usage.outputTokens);
  const thinkingTokens = normalizeToken(usage.thinkingTokens);
  if (inputTokens === null || outputTokens === null || thinkingTokens === null) return null;
  return { inputTokens, outputTokens, thinkingTokens };
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function finiteRate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Computes costs only from a server-supplied price snapshot. Returns null when
 * the price is unknown, which forces the call to stay `pending` rather than
 * settling at a fabricated $0.
 */
function computeCosts(
  snapshot: PriceSnapshot | null | undefined,
  usage: NormalizedUsage,
): ComputedCosts | null {
  if (!snapshot) return null;
  const inputRate = finiteRate(snapshot.inputRatePer1M);
  const outputRate = finiteRate(snapshot.outputRatePer1M);
  const thinkingRate = snapshot.thinkingRatePer1M === undefined
    ? outputRate
    : finiteRate(snapshot.thinkingRatePer1M);
  if (inputRate === null || outputRate === null || thinkingRate === null) return null;

  const inputCost = round6((usage.inputTokens / TOKENS_PER_MILLION) * inputRate);
  const outputCost = round6((usage.outputTokens / TOKENS_PER_MILLION) * outputRate);
  const thinkingCost = round6((usage.thinkingTokens / TOKENS_PER_MILLION) * thinkingRate);
  return {
    inputCost,
    outputCost,
    thinkingCost,
    totalCost: round6(inputCost + outputCost + thinkingCost),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function safeEnqueue(
  store: ExecutionStoreClient,
  executionId: string | null,
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await enqueueReconciliation(store, { executionId, kind, payload });
  } catch {
    // Best-effort: a reconciliation-enqueue failure must not block the answer.
  }
}

async function safeRecord(
  store: ExecutionStoreClient,
  record: RecordModelCallInput,
): Promise<void> {
  try {
    await recordModelCall(store, record);
  } catch {
    // Best-effort: the pre-dispatch row (if any) remains pending.
  }
}

// ============================================================================
// METERED CALL
// ============================================================================

/**
 * Records a model call before dispatch, invokes `dispatch`, then updates that
 * same row with served model / normalized usage / cost_status.
 *
 * Returns the dispatch's result so the caller's answer stream is never blocked
 * by accounting. Accounting failures are surfaced as durable reconciliation
 * jobs and a `pending` row, never a `settled` receipt.
 */
export async function runMeteredCall<T>(
  input: RunMeteredCallInput,
  dispatch: () => Promise<MeteredDispatchResult<T>>,
): Promise<T> {
  const attemptNumber = input.attemptNumber ?? 1;
  const base: RecordModelCallInput = {
    execution_id: input.execution.id,
    stage: input.stage,
    participant: input.participant,
    attempt_number: attemptNumber,
    requested_model: input.requestedModel ?? null,
    resolved_model: input.resolvedModel ?? null,
    status: 'dispatched',
    cost_status: 'pending',
    price_snapshot: input.priceSnapshot ?? null,
  };

  // 1) Durable pre-dispatch row. If this write fails, accounting fails closed
  //    (no settled receipt) but the answer stream is NOT blocked.
  let row: ModelCallRecord | null = null;
  try {
    row = await recordModelCall(input.store, base);
  } catch (error) {
    await safeEnqueue(input.store, input.execution.id, 'model_call_pre_dispatch_failed', {
      stage: input.stage,
      participant: input.participant,
      attemptNumber,
      error: errorMessage(error),
    });
  }

  // 2) Dispatch. A provider failure rethrows (the caller maps it to a 502) and
  //    leaves the row pending, never settled.
  let outcome: MeteredDispatchResult<T>;
  try {
    outcome = await dispatch();
  } catch (error) {
    if (row) {
      await safeRecord(input.store, { ...base, status: 'failed' });
    }
    throw error;
  }

  if (!row) {
    // No ledger row exists; dispatch already happened. Nothing to settle.
    return outcome.result;
  }

  // 3) Normalize usage and settle only when both usage and a server price are
  //    known. Anything else stays pending with a durable reconciliation job.
  const usage = normalizeUsage(outcome.usage);
  const costs = usage ? computeCosts(input.priceSnapshot, usage) : null;

  if (usage && costs) {
    try {
      await recordModelCall(input.store, {
        ...base,
        served_model: outcome.servedModel ?? null,
        upstream_request_id: outcome.upstreamRequestId ?? null,
        status: outcome.status ?? 'completed',
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        thinking_tokens: usage.thinkingTokens,
        input_cost: costs.inputCost,
        output_cost: costs.outputCost,
        thinking_cost: costs.thinkingCost,
        total_cost: costs.totalCost,
        cost_status: 'settled' satisfies CostStatus,
      });
    } catch (error) {
      // The row remains pending: a failed settlement is never a settled receipt.
      await safeEnqueue(input.store, input.execution.id, 'model_call_settlement_failed', {
        stage: input.stage,
        participant: input.participant,
        attemptNumber,
        error: errorMessage(error),
      });
    }
  } else {
    await safeRecord(input.store, {
      ...base,
      served_model: outcome.servedModel ?? null,
      upstream_request_id: outcome.upstreamRequestId ?? null,
      status: outcome.status ?? 'completed',
      cost_status: 'pending',
    });
    await safeEnqueue(input.store, input.execution.id, 'model_call_unsettled', {
      stage: input.stage,
      participant: input.participant,
      attemptNumber,
      usageProvided: usage !== null,
      priceProvided: Boolean(input.priceSnapshot),
    });
  }

  return outcome.result;
}
