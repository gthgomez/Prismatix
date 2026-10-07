// admission.ts - PX05 atomic budget / rate / concurrency admission (DB authority).
//
// The Postgres database is the SINGLE authority for spend and concurrency. This
// module is the thin, dependency-injected boundary the edge functions use to
// talk to the transactional `px05_*` RPCs (defined in
// supabase/migrations/20261006020000_px05_budgets_leases.sql). It is free of
// Deno APIs and `npm:` specifiers so it can be imported by both Supabase Edge
// Functions and vitest.
//
// FAIL-CLOSED POSTURE:
//   * numeric admission configuration is validated once at startup; any
//     malformed/negative/nonfinite value throws AdmissionConfigError so the
//     function refuses to boot rather than run with a permissive default;
//   * if the admission RPC errors, rejects, or returns a malformed payload, the
//     request is DENIED with reason `admission_unavailable` — never admitted;
//   * commit/release never report success unless the database confirmed it, and
//     unknown/ambiguous usage is passed through as `null` so the database keeps
//     the hold (`pending_reconcile`) instead of fabricating $0.00.
//
// In-memory Maps elsewhere in the router may remain only as a non-authoritative
// fast pre-check; they are not the authority and must never be the sole gate.

// ============================================================================
// TYPES
// ============================================================================

export interface AdmissionClient {
  rpc(
    functionName: string,
    params?: Record<string, unknown>,
  ): PromiseLike<{ data?: unknown; error?: { code?: string; message?: string } | null }>;
}

export interface AdmissionConfig {
  /** Execution starts allowed per subject per minute. */
  requestLimitPerMinute: number;
  /** Concurrent active executions allowed per subject. */
  activeLimit: number;
  /** Per-subject daily spend ceiling in USD. */
  userDailyUsd: number;
  /** Shared project-wide daily spend ceiling in USD. */
  projectDailyUsd: number;
  /** Per-execution billable ceiling in USD (the amount reserved). */
  maxPerExecutionUsd: number;
  /** Lease duration in seconds. */
  leaseSeconds: number;
}

// Default policy (owner-configurable): approved users only; 10 starts/min/user;
// one active execution/user; $2/day/user; $0.50/execution; $5/day project.
// Bigger changes require server-admin authority (a tighter grant may only
// tighten these, never loosen them — see resolveEffectiveLimits).
export const DEFAULT_ADMISSION_CONFIG: AdmissionConfig = {
  requestLimitPerMinute: 10,
  activeLimit: 1,
  userDailyUsd: 2,
  projectDailyUsd: 5,
  maxPerExecutionUsd: 0.5,
  leaseSeconds: 900,
};

export const ADMISSION_ENV_KEYS = {
  requestLimitPerMinute: 'PX05_REQUEST_LIMIT_PER_MINUTE',
  activeLimit: 'PX05_ACTIVE_EXECUTION_LIMIT',
  userDailyUsd: 'PX05_USER_DAILY_USD',
  projectDailyUsd: 'PX05_PROJECT_DAILY_USD',
  maxPerExecutionUsd: 'PX05_MAX_PER_EXECUTION_USD',
  leaseSeconds: 'PX05_LEASE_SECONDS',
} as const;

export type AdmissionEnvReader = (key: string) => string | undefined;

// Raised at startup when a numeric admission setting is malformed. Failing
// closed here is deliberate: a bad limit must never silently become "unlimited".
export class AdmissionConfigError extends Error {
  readonly field: string;

  constructor(field: string, message?: string) {
    super(message ?? `invalid admission config: ${field}`);
    this.name = 'AdmissionConfigError';
    this.field = field;
  }
}

export interface AdmissionLimitGrant {
  max_daily_usd?: string | number | null;
  max_per_execution_usd?: string | number | null;
}

export interface EffectiveAdmissionLimits {
  maxPerExecutionUsd: number;
  userDailyUsd: number;
}

export interface AdmitExecutionParams {
  subjectId: string;
  executionId: string;
  /** Expected billable cost (informational; the reservation is the max). */
  estimateUsd: number;
  /** Maximum billable cost for this execution; this is reserved up front. */
  maxUsd: number;
  leaseSeconds: number;
  requestLimit: number;
  userDailyUsd: number;
  projectDailyUsd: number;
  activeLimit: number;
}

export type AdmissionDenyReason =
  | 'rate_limited'
  | 'active_limit'
  | 'budget_exhausted'
  | 'admission_unavailable'
  | 'already_settled';

export interface AdmissionResult {
  admitted: boolean;
  reason: string;
  reservationId: string | null;
  leaseId: string | null;
  retryAfterSeconds: number;
  remainingUsd: number;
}

export interface ReservationMutationResult {
  ok: boolean;
  state: string;
  updated: boolean;
  committedUsd?: number;
  error?: string;
}

// ============================================================================
// CONFIG
// ============================================================================

function parsePositiveNumber(
  field: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw === null || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new AdmissionConfigError(
      field,
      `admission config ${field} must be a finite number > 0 (got ${JSON.stringify(raw)})`,
    );
  }
  return value;
}

/**
 * Loads and validates every numeric admission setting from the injected env
 * reader. Unset/empty values fall back to the owner-configurable default
 * policy; malformed/negative/nonfinite values throw AdmissionConfigError so the
 * caller fails closed at startup.
 */
export function loadAdmissionConfig(getEnv: AdmissionEnvReader): AdmissionConfig {
  return {
    requestLimitPerMinute: parsePositiveNumber(
      ADMISSION_ENV_KEYS.requestLimitPerMinute,
      getEnv(ADMISSION_ENV_KEYS.requestLimitPerMinute),
      DEFAULT_ADMISSION_CONFIG.requestLimitPerMinute,
    ),
    activeLimit: parsePositiveNumber(
      ADMISSION_ENV_KEYS.activeLimit,
      getEnv(ADMISSION_ENV_KEYS.activeLimit),
      DEFAULT_ADMISSION_CONFIG.activeLimit,
    ),
    userDailyUsd: parsePositiveNumber(
      ADMISSION_ENV_KEYS.userDailyUsd,
      getEnv(ADMISSION_ENV_KEYS.userDailyUsd),
      DEFAULT_ADMISSION_CONFIG.userDailyUsd,
    ),
    projectDailyUsd: parsePositiveNumber(
      ADMISSION_ENV_KEYS.projectDailyUsd,
      getEnv(ADMISSION_ENV_KEYS.projectDailyUsd),
      DEFAULT_ADMISSION_CONFIG.projectDailyUsd,
    ),
    maxPerExecutionUsd: parsePositiveNumber(
      ADMISSION_ENV_KEYS.maxPerExecutionUsd,
      getEnv(ADMISSION_ENV_KEYS.maxPerExecutionUsd),
      DEFAULT_ADMISSION_CONFIG.maxPerExecutionUsd,
    ),
    leaseSeconds: parsePositiveNumber(
      ADMISSION_ENV_KEYS.leaseSeconds,
      getEnv(ADMISSION_ENV_KEYS.leaseSeconds),
      DEFAULT_ADMISSION_CONFIG.leaseSeconds,
    ),
  };
}

// An explicit 0 is a REAL ceiling (deny), not "unset": only null/undefined or a
// malformed value falls back to the configured policy. A $0 grant must clamp to
// $0 rather than silently loosening to the full configured budget.
function nonNegativeOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

/**
 * Combines the configured policy with an optional access grant. A server-admin
 * grant may TIGHTEN a ceiling but can never loosen it above the configured
 * policy; malformed grant values are ignored (configured policy applies).
 */
export function resolveEffectiveLimits(
  config: AdmissionConfig,
  grant?: AdmissionLimitGrant | null,
): EffectiveAdmissionLimits {
  const grantDaily = nonNegativeOrNull(grant?.max_daily_usd);
  const grantPerExecution = nonNegativeOrNull(grant?.max_per_execution_usd);
  return {
    maxPerExecutionUsd: grantPerExecution === null
      ? config.maxPerExecutionUsd
      : Math.min(config.maxPerExecutionUsd, grantPerExecution),
    userDailyUsd: grantDaily === null
      ? config.userDailyUsd
      : Math.min(config.userDailyUsd, grantDaily),
  };
}

// False when either ceiling is 0: an explicit $0 grant means no paid execution.
export function isAdmissionAllowed(limits: EffectiveAdmissionLimits): boolean {
  return limits.maxPerExecutionUsd > 0 && limits.userDailyUsd > 0;
}

// ============================================================================
// ADMISSION
// ============================================================================

function unavailable(): AdmissionResult {
  return {
    admitted: false,
    reason: 'admission_unavailable',
    reservationId: null,
    leaseId: null,
    retryAfterSeconds: 0,
    remainingUsd: 0,
  };
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNonNegativeNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Reserves the configured maximum billable work for an execution and acquires
 * a lease atomically in the database.
 *
 * FAIL CLOSED: any RPC error, rejection, or malformed payload yields a denied
 * result with reason `admission_unavailable`. This function NEVER admits on
 * uncertainty.
 */
export async function admitExecution(
  client: AdmissionClient,
  params: AdmitExecutionParams,
): Promise<AdmissionResult> {
  let response: { data?: unknown; error?: { code?: string; message?: string } | null } | undefined;
  try {
    response = await client.rpc('px05_admit_execution', {
      p_subject_id: params.subjectId,
      p_execution_id: params.executionId,
      p_estimate_usd: params.estimateUsd,
      p_max_usd: params.maxUsd,
      p_lease_seconds: params.leaseSeconds,
      p_request_limit: params.requestLimit,
      p_user_daily_usd: params.userDailyUsd,
      p_project_daily_usd: params.projectDailyUsd,
      p_active_limit: params.activeLimit,
    });
  } catch {
    return unavailable();
  }

  if (response?.error) {
    return unavailable();
  }

  const data = response?.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return unavailable();
  }

  const record = data as Record<string, unknown>;
  if (typeof record.admitted !== 'boolean') {
    return unavailable();
  }

  return {
    admitted: record.admitted,
    reason: typeof record.reason === 'string' ? record.reason : (record.admitted ? 'admitted' : 'denied'),
    reservationId: asStringOrNull(record.reservation_id),
    leaseId: asStringOrNull(record.lease_id),
    retryAfterSeconds: Math.max(0, Math.floor(asNonNegativeNumber(record.retry_after_seconds))),
    remainingUsd: asNonNegativeNumber(record.remaining_usd),
  };
}

/**
 * Stable HTTP status for an admission denial. Budget exhaustion is 402; rate
 * and active-run limits are 429; an already-settled execution is 409; an
 * unavailable authority fails closed with 503.
 */
export function admissionDenialStatus(reason: string): number {
  switch (reason) {
    case 'budget_exhausted':
      return 402;
    case 'rate_limited':
    case 'active_limit':
      return 429;
    case 'already_settled':
      return 409;
    default:
      return 503;
  }
}

// ============================================================================
// COMMIT / RELEASE
// ============================================================================

function mutationFailure(error: unknown): ReservationMutationResult {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'reservation mutation failed';
  return { ok: false, state: 'unknown', updated: false, error: message };
}

async function mutateReservation(
  client: AdmissionClient,
  functionName: string,
  params: Record<string, unknown>,
): Promise<ReservationMutationResult> {
  let response: { data?: unknown; error?: { message?: string } | null } | undefined;
  try {
    response = await client.rpc(functionName, params);
  } catch (error) {
    return mutationFailure(error);
  }

  if (response?.error) {
    return mutationFailure(response.error.message ?? 'reservation mutation failed');
  }

  const data = response?.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return mutationFailure('malformed reservation mutation response');
  }

  const record = data as Record<string, unknown>;
  const committedUsd = record.committed_usd === undefined || record.committed_usd === null
    ? undefined
    : asNonNegativeNumber(record.committed_usd);
  return {
    ok: true,
    state: typeof record.state === 'string' ? record.state : 'unknown',
    updated: record.updated === true,
    ...(committedUsd === undefined ? {} : { committedUsd }),
  };
}

/**
 * Commits a reservation with the actual cost. Pass `null` for unknown or
 * ambiguous usage: the database keeps the hold and marks the reservation
 * `pending_reconcile` (never silently released, never fabricated $0.00).
 */
export function commitReservation(
  client: AdmissionClient,
  executionId: string,
  actualUsd: number | null,
): Promise<ReservationMutationResult> {
  return mutateReservation(client, 'px05_commit_reservation', {
    p_execution_id: executionId,
    p_actual_usd: actualUsd === null || !Number.isFinite(actualUsd) ? null : actualUsd,
  });
}

/**
 * Releases a reservation for CONFIRMED-ZERO work only (no provider call was
 * made). Never call this for uncertain paid work; use commitReservation(null)
 * so the hold survives as `pending_reconcile`.
 */
export function releaseReservation(
  client: AdmissionClient,
  executionId: string,
  reason: string,
): Promise<ReservationMutationResult> {
  return mutateReservation(client, 'px05_release_reservation', {
    p_execution_id: executionId,
    p_reason: reason,
  });
}

/**
 * Settles the reservation from the AUTHORITATIVE ledger: the database sums the
 * execution's `model_calls.total_cost` and commits that amount. If ANY call is
 * still unsettled (pending/estimated), the reservation is kept as
 * `pending_reconcile` instead of committing a partial/understated amount. With
 * no metered calls at all the work is confirmed-zero and is released.
 */
export function commitFromLedger(
  client: AdmissionClient,
  executionId: string,
): Promise<ReservationMutationResult> {
  return mutateReservation(client, 'px05_commit_from_ledger', {
    p_execution_id: executionId,
  });
}

/**
 * Commits a conservative, reservation-capped ESTIMATE for priced work whose
 * provider reported no usage, so `committed_usd` advances and the hold does not
 * persist. The database accepts the estimate only when there are no settled
 * calls, at least one pending PRICED call, and the estimate is positive; a
 * pending call with unknown price stays `pending_reconcile` (never $0.00). The
 * estimate is recorded with an explicit provenance marker (not `settled`).
 */
export function commitEstimated(
  client: AdmissionClient,
  executionId: string,
  estimatedUsd: number,
): Promise<ReservationMutationResult> {
  return mutateReservation(client, 'px05_commit_estimated', {
    p_execution_id: executionId,
    p_estimated_usd: Number.isFinite(estimatedUsd) && estimatedUsd > 0 ? estimatedUsd : 0,
  });
}

/**
 * Explicit reconciliation for work whose cost is not metered by the ledger
 * (e.g. video processing). A positive actual commits; 0 releases (recorded with
 * the reason); null/negative keeps the hold as `pending_reconcile`. Unlike
 * releaseReservation, this IS allowed to resolve a `pending_reconcile`
 * reservation because it carries an explicit, caller-attested outcome.
 */
export function reconcileReservation(
  client: AdmissionClient,
  executionId: string,
  actualUsd: number | null,
  reason: string,
): Promise<ReservationMutationResult> {
  return mutateReservation(client, 'px05_reconcile_reservation', {
    p_execution_id: executionId,
    p_actual_usd: actualUsd === null || !Number.isFinite(actualUsd) ? null : actualUsd,
    p_reason: reason,
  });
}

// ============================================================================
// OUTPUT CAP SIZING
// ============================================================================

const TOKENS_PER_MILLION = 1_000_000;

/**
 * Sizes a model output-token cap from the admitted budget so a single
 * execution cannot emit more than it reserved. Returns the model's hard cap
 * when the budget affords it (or the output rate is unknown), and 0 when there
 * is no affordable budget at all.
 */
export function deriveOutputTokenCap(
  admittedBudgetUsd: number,
  outputRatePer1M: number,
  hardCap: number,
): number {
  if (!Number.isFinite(admittedBudgetUsd) || admittedBudgetUsd <= 0) {
    return 0;
  }
  if (!Number.isFinite(outputRatePer1M) || outputRatePer1M <= 0) {
    return Math.max(0, hardCap);
  }
  const affordable = Math.floor((admittedBudgetUsd / outputRatePer1M) * TOKENS_PER_MILLION);
  return Math.max(0, Math.min(hardCap, affordable));
}

/**
 * A per-execution, stage-shared output budget. Every provider dispatch clamps
 * its output-token cap through this object and the granted maximum output cost
 * is charged against the admitted per-execution ceiling, so the SUM of all
 * stage output maxima over one execution cannot exceed the reservation. This is
 * what makes the single up-front reservation actually bound multi-stage
 * (debate/SMD) cost instead of only the primary stage.
 */
export interface ExecutionOutputBudget {
  remainingUsd(): number;
  clampTokenCap(requestedTokens: number, outputRatePer1M: number): number;
}

export function createExecutionOutputBudget(admittedBudgetUsd: number): ExecutionOutputBudget {
  let remaining = Number.isFinite(admittedBudgetUsd) && admittedBudgetUsd > 0
    ? admittedBudgetUsd
    : 0;
  return {
    remainingUsd(): number {
      return remaining;
    },
    clampTokenCap(requestedTokens: number, outputRatePer1M: number): number {
      if (!Number.isFinite(requestedTokens) || requestedTokens <= 0) return requestedTokens;
      if (!Number.isFinite(outputRatePer1M) || outputRatePer1M <= 0) return requestedTokens;
      const granted = Math.max(0, Math.min(requestedTokens, deriveOutputTokenCap(remaining, outputRatePer1M, requestedTokens)));
      remaining = Math.max(0, remaining - (granted / TOKENS_PER_MILLION) * outputRatePer1M);
      return granted;
    },
  };
}
