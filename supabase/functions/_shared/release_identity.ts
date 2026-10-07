// release_identity.ts - Release/protocol/schema/catalog/tariff identity (PX02).
//
// Stamps every router response with the identity of the deployed revision and
// backs the authenticated capabilities contract, so a client (or an operator
// with curl) can mechanically answer: "which protocol, schema, model catalog,
// tariff, and code revision am I actually talking to?"
//
// This module is dependency-injected (env reader is a parameter) and
// intentionally free of Deno APIs and `npm:` specifiers so it can be imported
// by both Supabase Edge Functions (Deno) and the Node/vitest contract tests —
// the same posture as _shared/access_policy.ts.
//
// RULE: never invent identity. Every field falls back to a labelled default
// when its env var is unset/blank, and releaseSha defaults to the literal
// 'unknown'. Tooling and dashboards must treat 'unknown' as "unverified
// deployment" — never guess or reconstruct a SHA.

export type ReleaseIdentity = {
  protocolVersion: string;
  schemaVersion: string;
  catalogVersion: string;
  tariffVersion: string;
  releaseSha: string;
};

// Wire protocol version implemented by this code. '1' is the first versioned
// protocol: the PX02 capabilities contract plus the X-Prismatix-* response
// headers. Bump when the contract changes in a way clients must detect.
export const PROTOCOL_VERSION = '1';

// Labelled default for identity fields whose env override is unset. It makes
// drift visible ('unspecified' in a live header) instead of hiding it behind a
// stale hardcoded value.
export const UNSPECIFIED_VERSION = 'unspecified';

// The only allowed default for releaseSha — never invent a SHA.
export const UNKNOWN_RELEASE_SHA = 'unknown';

// Header names emitted by releaseHeaders(); exported so tests and docs cannot
// drift from the implementation.
export const RELEASE_HEADER_NAMES = [
  'X-Prismatix-Protocol',
  'X-Prismatix-Schema',
  'X-Prismatix-Catalog',
  'X-Prismatix-Tariff',
  'X-Prismatix-Release',
] as const;

// Header safety: identity values end up in HTTP response headers. Strip
// control and non-ASCII characters so a misconfigured secret can never
// smuggle header content, and treat blank results as unset.
function headerSafe(value: string): string {
  // deno-lint-ignore no-control-regex
  return value.replace(/[^\x20-\x7e]/g, '').trim();
}

function readIdentityField(
  getEnv: (k: string) => string | undefined,
  envKey: string,
  fallback: string,
): string {
  let raw: string | undefined;
  try {
    raw = getEnv(envKey);
  } catch {
    return fallback;
  }
  if (typeof raw !== 'string') return fallback;
  const cleaned = headerSafe(raw);
  return cleaned === '' ? fallback : cleaned;
}

// Resolves the deployed release identity from the environment. Reads:
//   PRISMATIX_PROTOCOL_VERSION, PRISMATIX_SCHEMA_VERSION,
//   PRISMATIX_CATALOG_VERSION, PRISMATIX_TARIFF_VERSION, RELEASE_SHA.
// Every field falls back to a labelled default; releaseSha defaults to the
// literal 'unknown' (never invent a SHA).
export function resolveReleaseIdentity(
  getEnv: (k: string) => string | undefined,
): ReleaseIdentity {
  return {
    protocolVersion: readIdentityField(getEnv, 'PRISMATIX_PROTOCOL_VERSION', PROTOCOL_VERSION),
    schemaVersion: readIdentityField(getEnv, 'PRISMATIX_SCHEMA_VERSION', UNSPECIFIED_VERSION),
    catalogVersion: readIdentityField(getEnv, 'PRISMATIX_CATALOG_VERSION', UNSPECIFIED_VERSION),
    tariffVersion: readIdentityField(getEnv, 'PRISMATIX_TARIFF_VERSION', UNSPECIFIED_VERSION),
    releaseSha: readIdentityField(getEnv, 'RELEASE_SHA', UNKNOWN_RELEASE_SHA),
  };
}

// Maps the identity onto the five X-Prismatix-* response headers. Routers must
// also list these names in Access-Control-Expose-Headers so a cross-origin
// browser client can read them.
export function releaseHeaders(identity: ReleaseIdentity): Record<string, string> {
  return {
    'X-Prismatix-Protocol': identity.protocolVersion,
    'X-Prismatix-Schema': identity.schemaVersion,
    'X-Prismatix-Catalog': identity.catalogVersion,
    'X-Prismatix-Tariff': identity.tariffVersion,
    'X-Prismatix-Release': identity.releaseSha,
  };
}
