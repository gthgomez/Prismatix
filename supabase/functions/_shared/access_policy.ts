// access_policy.ts - Server-managed approved-user entitlements (PX01).
//
// SECURITY: fail closed. A missing grant, a disabled grant, or a grant that
// does not list the requested feature denies access; any lookup failure throws
// EntitlementError('entitlement_unavailable') so callers deny rather than
// allow.
//
// This module is dependency-injected and intentionally free of Deno APIs and
// `npm:` specifiers so it can be imported by both Supabase Edge Functions
// (Deno) and the Node/vitest security tests. Grants live in
// prismatix_internal.access_grants (service_role-writable only) and are read
// through the service_role-only RPC public.get_access_grant; see migration
// 20261006000000_px01_storage_entitlements.sql.

export type AccessFeature = 'chat' | 'review' | 'video' | 'memory' | 'smd';

export type AccessRole = 'user' | 'admin';

export type EntitlementErrorCode = 'not_entitled' | 'entitlement_unavailable';

const ACCESS_FEATURES: readonly string[] = ['chat', 'review', 'video', 'memory', 'smd'];

// Mirrors prismatix_internal.access_grants. numeric columns arrive as strings
// from PostgREST.
export interface AccessGrant {
  subject_id: string;
  role: AccessRole;
  enabled: boolean;
  allowed_features: AccessFeature[];
  max_daily_usd: string | number | null;
  max_per_execution_usd: string | number | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export class EntitlementError extends Error {
  readonly code: EntitlementErrorCode;

  constructor(code: EntitlementErrorCode, message?: string) {
    super(message ?? `entitlement_error: ${code}`);
    this.name = 'EntitlementError';
    this.code = code;
  }
}

// Minimal structural interface for the injected supabase-js client. Keeping it
// structural avoids importing supabase-js (or any `npm:`/Deno specifier) here.
export interface AccessPolicyClient {
  rpc(
    functionName: string,
    params?: Record<string, unknown>,
  ): PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
}

export function isGrantActive(grant: AccessGrant): boolean {
  return grant.enabled === true;
}

// False for a null grant, a disabled grant, or a feature that is not listed in
// allowed_features.
export function isEntitled(grant: AccessGrant | null, feature: AccessFeature): boolean {
  if (!grant || !isGrantActive(grant)) {
    return false;
  }
  return Array.isArray(grant.allowed_features) && grant.allowed_features.includes(feature);
}

export function assertEntitled(grant: AccessGrant | null, feature: AccessFeature): void {
  if (!isEntitled(grant, feature)) {
    throw new EntitlementError('not_entitled', `No active entitlement for feature: ${feature}`);
  }
}

// Loads the grant for a subject through the service_role-only RPC. Returns
// null when the subject has no grant row (callers must deny). Any query error,
// rejection, or malformed payload throws EntitlementError('entitlement_unavailable').
export async function loadAccessGrant(
  client: AccessPolicyClient,
  subjectId: string,
): Promise<AccessGrant | null> {
  let response: { data?: unknown; error?: { message?: string } | null } | undefined;
  try {
    response = await client.rpc('get_access_grant', { p_subject_id: subjectId });
  } catch {
    throw new EntitlementError('entitlement_unavailable', 'Access grant lookup failed');
  }

  if (response?.error) {
    throw new EntitlementError(
      'entitlement_unavailable',
      `Access grant lookup failed: ${response.error.message ?? 'unknown error'}`,
    );
  }

  const data = response?.data;
  if (data === null || data === undefined) {
    return null;
  }

  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new EntitlementError(
      'entitlement_unavailable',
      'Access grant lookup returned an unexpected payload shape',
    );
  }

  const candidate = data as Partial<AccessGrant> & { allowed_features?: unknown };
  if (candidate.subject_id !== subjectId) {
    throw new EntitlementError(
      'entitlement_unavailable',
      'Access grant lookup returned a mismatched subject',
    );
  }

  const rawFeatures = Array.isArray(candidate.allowed_features) ? candidate.allowed_features : [];
  const allowedFeatures = rawFeatures.filter(
    (feature): feature is AccessFeature =>
      typeof feature === 'string' && ACCESS_FEATURES.includes(feature),
  );

  return {
    subject_id: String(candidate.subject_id),
    role: candidate.role === 'admin' ? 'admin' : 'user',
    enabled: candidate.enabled === true,
    allowed_features: allowedFeatures,
    max_daily_usd: candidate.max_daily_usd ?? null,
    max_per_execution_usd: candidate.max_per_execution_usd ?? null,
    created_at: String(candidate.created_at ?? ''),
    updated_at: String(candidate.updated_at ?? ''),
    updated_by: candidate.updated_by ?? null,
  };
}
