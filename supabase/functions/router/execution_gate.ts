// execution_gate.ts - PX03 execution-establishment gate.
//
// Encapsulates the identity decision the router makes BEFORE any provider
// dispatch:
//   * a genuinely new execution proceeds,
//   * a reused execution (same subject + client_request_key + payload_hash) is a
//     duplicate attempt and MUST NOT be replayed,
//   * a reused key with a different payload_hash is a hard conflict,
//   * an execution store that is unavailable fails CLOSED: a durable
//     reconciliation job is enqueued and the request is refused with 503 rather
//     than proceeding into an unmetered provider call.
//
// The gate returns the HTTP decision (status/code) alongside the outcome so the
// "reused => 409, unavailable => 503, zero provider calls" invariants are
// testable without importing the Deno entrypoint. Callers must dispatch
// providers ONLY when `kind === 'proceed'`.

import {
  createExecution,
  enqueueReconciliation,
  RequestKeyConflictError,
  type CreateExecutionInput,
  type ExecutionRecord,
  type ExecutionStoreClient,
} from './execution_store.ts';

export type ExecutionRejectionCode = 'duplicate_request' | 'request_key_conflict';

export type ExecutionOpenResult =
  | { kind: 'proceed'; execution: ExecutionRecord }
  | {
      kind: 'rejected';
      status: 409;
      error: ExecutionRejectionCode;
      code: ExecutionRejectionCode;
      executionId?: string;
    }
  | {
      kind: 'unavailable';
      status: 503;
      error: 'accounting_unavailable';
      code: 'accounting_unavailable';
    };

async function enqueueCreateFailure(
  client: ExecutionStoreClient,
  input: CreateExecutionInput,
  error: string,
): Promise<void> {
  try {
    await enqueueReconciliation(client, {
      executionId: null,
      kind: 'execution_create_failed',
      payload: {
        subjectId: input.subjectId,
        conversationId: input.conversationId ?? null,
        clientRequestKey: input.clientRequestKey,
        error,
      },
    });
  } catch (enqueueError) {
    // Never swallow silently: an unpersisted reconciliation job is itself an
    // accounting defect that must be visible.
    console.error('[PX03] execution_create_failed reconciliation enqueue failed:', {
      error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
    });
  }
}

/**
 * Opens (or idempotently resolves) the execution for a client request.
 *
 * - `proceed` → a new execution was created.
 * - `rejected` (409) → duplicate (`duplicate_request`, carries the execution id)
 *   or key/payload conflict (`request_key_conflict`). Dispatch nothing.
 * - `unavailable` (503) → the ledger could not be written; a durable
 *   reconciliation job was enqueued first. Dispatch nothing (fail closed).
 */
export async function openExecutionForRequest(
  client: ExecutionStoreClient,
  input: CreateExecutionInput,
): Promise<ExecutionOpenResult> {
  try {
    const created = await createExecution(client, input);
    if (created.reused) {
      return {
        kind: 'rejected',
        status: 409,
        error: 'duplicate_request',
        code: 'duplicate_request',
        executionId: created.execution.id,
      };
    }
    return { kind: 'proceed', execution: created.execution };
  } catch (error) {
    if (error instanceof RequestKeyConflictError) {
      return {
        kind: 'rejected',
        status: 409,
        error: 'request_key_conflict',
        code: 'request_key_conflict',
      };
    }
    // FAIL CLOSED: enqueue the durable job first, then refuse the request. We
    // must never dispatch a provider call that has no execution id.
    const message = error instanceof Error ? error.message : String(error);
    await enqueueCreateFailure(client, input, message);
    return {
      kind: 'unavailable',
      status: 503,
      error: 'accounting_unavailable',
      code: 'accounting_unavailable',
    };
  }
}
