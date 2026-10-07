// execution_store.ts - Durable execution / model-call ledger (PX03).
//
// Identity model (replaces the old content-hashed cost_logs idempotency key):
//   * An execution is the unit of a client request, keyed by
//     (subject_id, client_request_key) and pinned to a payload_hash. Reusing a
//     key with a different payload is a hard conflict and must dispatch nothing.
//   * A model call is the unit of a provider dispatch, keyed by
//     (execution_id, stage, participant, attempt_number). Distinct dispatches
//     always produce distinct rows even when token counts are identical; a
//     retry of the same accounting event dedupes to one row.
//
// Transport: the authority tables live in `prismatix_internal`, which PX01
// deliberately keeps OUT of PostgREST ([api].schemas = public, graphql_public)
// and cross-schema access goes through service_role-only `security definer`
// RPCs in the exposed `public` schema (same posture as
// public.get_access_grant). This module therefore talks to the injected
// service-role client through `rpc(...)`, never `.from('prismatix_internal...')`.
//
// Dependency-injected and free of Deno APIs / `npm:` specifiers so it can be
// imported by both Supabase Edge Functions and vitest.

// ============================================================================
// TYPES
// ============================================================================

export type ExecutionStatus =
  | 'started'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'indeterminate';

export type CostStatus = 'settled' | 'pending' | 'estimated_legacy';

// Mirrors prismatix_internal.executions (snake_case: PostgREST serializes
// to_jsonb(row) column names verbatim).
export interface ExecutionRecord {
  id: string;
  subject_id: string;
  conversation_id: string | null;
  client_request_key: string;
  payload_hash: string;
  status: ExecutionStatus;
  requested_mode: string | null;
  requested_model: string | null;
  resolved_model: string | null;
  served_model: string | null;
  route_version: string | null;
  pricing_version: string | null;
  catalog_version: string | null;
  terminal_outcome: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors prismatix_internal.model_calls.
export interface ModelCallRecord {
  id: string;
  execution_id: string;
  stage: string | null;
  participant: string | null;
  attempt_number: number;
  requested_model: string | null;
  resolved_model: string | null;
  served_model: string | null;
  upstream_request_id: string | null;
  status: string | null;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  input_cost: number;
  output_cost: number;
  thinking_cost: number;
  total_cost: number;
  price_snapshot: unknown;
  cost_status: CostStatus;
  created_at: string;
}

export interface ExecutionStoreRpcResponse {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

// Minimal structural interface for the injected supabase-js client. Keeping it
// structural avoids importing supabase-js (or any `npm:`/Deno specifier) here.
export interface ExecutionStoreClient {
  rpc(
    functionName: string,
    params?: Record<string, unknown>,
  ): PromiseLike<ExecutionStoreRpcResponse>;
}

export interface CreateExecutionInput {
  subjectId: string;
  conversationId?: string | null;
  clientRequestKey: string;
  payloadHash: string;
  requestedMode?: string | null;
  requestedModel?: string | null;
  routeVersion?: string | null;
  pricingVersion?: string | null;
  catalogVersion?: string | null;
}

export interface CreateExecutionResult {
  execution: ExecutionRecord;
  reused: boolean;
}

export interface RecordModelCallInput {
  execution_id: string;
  stage?: string | null;
  participant?: string | null;
  attempt_number?: number;
  requested_model?: string | null;
  resolved_model?: string | null;
  served_model?: string | null;
  upstream_request_id?: string | null;
  status?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  input_cost?: number;
  output_cost?: number;
  thinking_cost?: number;
  total_cost?: number;
  price_snapshot?: unknown;
  cost_status?: CostStatus;
}

export interface FinalizeExecutionInput {
  status: ExecutionStatus;
  terminalOutcome?: string | null;
  servedModel?: string | null;
}

export interface EnqueueReconciliationInput {
  executionId: string | null;
  kind: string;
  payload?: Record<string, unknown>;
}

// ============================================================================
// ERRORS
// ============================================================================

// Raised when a client request key is reused with a different payload hash.
// Callers MUST treat this as a hard failure and dispatch nothing.
export class RequestKeyConflictError extends Error {
  readonly subjectId: string;
  readonly clientRequestKey: string;

  constructor(subjectId: string, clientRequestKey: string) {
    super(
      `client_request_key reused with a different payload: subject=${subjectId} key=${clientRequestKey}`,
    );
    this.name = 'RequestKeyConflictError';
    this.subjectId = subjectId;
    this.clientRequestKey = clientRequestKey;
  }
}

export class ExecutionStoreError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? `execution_store_error: ${code}`);
    this.name = 'ExecutionStoreError';
    this.code = code;
  }
}

// The SQLSTATE used by public.px03_create_execution for key/payload conflicts.
const CONFLICT_SQLSTATE = 'PT409';
const CONFLICT_MESSAGE = 'request_key_conflict';

function isRequestKeyConflict(error: { code?: string; message?: string }): boolean {
  return error.code === CONFLICT_SQLSTATE || (error.message ?? '').includes(CONFLICT_MESSAGE);
}

// ============================================================================
// PAYLOAD HASH
// ============================================================================

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

/**
 * Stable SHA-256 hash of a normalized request payload. Object key order does
 * not matter; any content change produces a different hash. Used to bind a
 * client_request_key to the exact request it was created for.
 */
export async function computePayloadHash(value: unknown): Promise<string> {
  const canonical = stableStringify(value);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// EXECUTION LIFECYCLE
// ============================================================================

/**
 * Creates (or idempotently reuses) the execution for a client request.
 *
 * - Same (subjectId, clientRequestKey) + same payloadHash → the existing row,
 *   `reused: true`.
 * - Same key + different payloadHash → throws RequestKeyConflictError. The
 *   caller must dispatch nothing.
 */
export async function createExecution(
  client: ExecutionStoreClient,
  input: CreateExecutionInput,
): Promise<CreateExecutionResult> {
  const response = await client.rpc('px03_create_execution', {
    p_subject_id: input.subjectId,
    p_conversation_id: input.conversationId ?? null,
    p_client_request_key: input.clientRequestKey,
    p_payload_hash: input.payloadHash,
    p_requested_mode: input.requestedMode ?? null,
    p_requested_model: input.requestedModel ?? null,
    p_route_version: input.routeVersion ?? null,
    p_pricing_version: input.pricingVersion ?? null,
    p_catalog_version: input.catalogVersion ?? null,
  });

  if (response.error) {
    if (isRequestKeyConflict(response.error)) {
      throw new RequestKeyConflictError(input.subjectId, input.clientRequestKey);
    }
    throw new ExecutionStoreError(
      'create_execution_failed',
      response.error.message ?? 'create_execution_failed',
    );
  }

  const payload = response.data as
    | { execution?: ExecutionRecord; reused?: boolean }
    | null
    | undefined;
  if (!payload || !payload.execution) {
    throw new ExecutionStoreError('create_execution_failed', 'empty response from ledger');
  }

  return { execution: payload.execution, reused: payload.reused === true };
}

/**
 * Inserts a distinct model_calls row for a provider dispatch. Retrying the same
 * accounting event (same execution/stage/participant/attempt) upserts/dedupes
 * to one row; a distinct provider call always yields a distinct row.
 */
export async function recordModelCall(
  client: ExecutionStoreClient,
  record: RecordModelCallInput,
): Promise<ModelCallRecord> {
  const response = await client.rpc('px03_record_model_call', {
    p_execution_id: record.execution_id,
    p_stage: record.stage ?? null,
    p_participant: record.participant ?? null,
    p_attempt_number: record.attempt_number ?? 1,
    p_requested_model: record.requested_model ?? null,
    p_resolved_model: record.resolved_model ?? null,
    p_served_model: record.served_model ?? null,
    p_upstream_request_id: record.upstream_request_id ?? null,
    p_status: record.status ?? null,
    p_input_tokens: record.input_tokens ?? 0,
    p_output_tokens: record.output_tokens ?? 0,
    p_thinking_tokens: record.thinking_tokens ?? 0,
    p_input_cost: record.input_cost ?? 0,
    p_output_cost: record.output_cost ?? 0,
    p_thinking_cost: record.thinking_cost ?? 0,
    p_total_cost: record.total_cost ?? 0,
    p_price_snapshot: record.price_snapshot ?? null,
    p_cost_status: record.cost_status ?? 'pending',
  });

  if (response.error) {
    throw new ExecutionStoreError(
      'record_model_call_failed',
      response.error.message ?? 'record_model_call_failed',
    );
  }

  const row = response.data as ModelCallRecord | null | undefined;
  if (!row) {
    throw new ExecutionStoreError('record_model_call_failed', 'empty response from ledger');
  }
  return row;
}

/**
 * Sets the single terminal outcome exactly once. A later call is a no-op that
 * returns the already-finalized execution.
 */
export async function finalizeExecution(
  client: ExecutionStoreClient,
  executionId: string,
  terminal: FinalizeExecutionInput,
): Promise<ExecutionRecord | null> {
  const response = await client.rpc('px03_finalize_execution', {
    p_execution_id: executionId,
    p_status: terminal.status,
    p_terminal_outcome: terminal.terminalOutcome ?? null,
    p_served_model: terminal.servedModel ?? null,
  });

  if (response.error) {
    throw new ExecutionStoreError(
      'finalize_execution_failed',
      response.error.message ?? 'finalize_execution_failed',
    );
  }

  const payload = response.data as { execution?: ExecutionRecord } | null | undefined;
  return payload?.execution ?? null;
}

/**
 * Durably records a deferred accounting task. Replaces the fire-and-forget
 * console dead-letter for the accounting path.
 */
export async function enqueueReconciliation(
  client: ExecutionStoreClient,
  input: EnqueueReconciliationInput,
): Promise<Record<string, unknown>> {
  const response = await client.rpc('px03_enqueue_reconciliation', {
    p_execution_id: input.executionId,
    p_kind: input.kind,
    p_payload: input.payload ?? {},
  });

  if (response.error) {
    throw new ExecutionStoreError(
      'enqueue_reconciliation_failed',
      response.error.message ?? 'enqueue_reconciliation_failed',
    );
  }

  return (response.data as Record<string, unknown> | null) ?? {};
}
