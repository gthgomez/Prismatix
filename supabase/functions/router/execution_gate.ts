// execution_gate.ts - PX03 execution-establishment gate.
//
// Encapsulates the identity decision the router makes BEFORE any provider
// dispatch:
//   * a genuinely new execution proceeds,
//   * a reused execution (same subject + client_request_key + payload_hash) is a
//     duplicate attempt and MUST NOT be replayed,
//   * a reused key with a different payload_hash is a hard conflict.
//
// The gate returns the HTTP decision (status/code) alongside the outcome so the
// "reused => 409, zero provider calls" invariant is testable without importing
// the Deno entrypoint. Callers must dispatch providers ONLY when
// `kind === 'proceed'`.

import {
  createExecution,
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
    };

/**
 * Opens (or idempotently resolves) the execution for a client request.
 *
 * A `duplicate_request` rejection carries the existing `executionId`; a
 * `request_key_conflict` rejection does not (the payload did not match). A
 * non-conflict store failure is rethrown so the caller can decide how to handle
 * a ledger outage.
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
    throw error;
  }
}
