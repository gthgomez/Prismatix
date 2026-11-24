// Shared qualification target contract.
//
// Every qualification script that can read or write user data must resolve its
// target through this module. The contract is identity-based, not opt-in:
//
//   * loopback targets are always allowed;
//   * a hosted target is allowed only when its hostname is a project-ref
//     subdomain listed in QUALIFICATION_ALLOWED_PROJECT_REFS AND
//     QUALIFICATION_ENVIRONMENT names an explicit nonproduction environment;
//   * the known production project is denied unconditionally, even if it
//     appears in the allowlist;
//   * a boolean like ALLOW_NONLOCAL_QUALIFICATION is never sufficient.
//
// The goal is to fail before any state-changing request or provider dispatch.

export const PRODUCTION_PROJECT_REF = 'sqjfbqjogylkfwzsyprd';
export const PRODUCTION_HOST = `${PRODUCTION_PROJECT_REF}.supabase.co`;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const NON_PRODUCTION_ENVIRONMENTS = new Set(['staging', 'preview', 'local']);

function fail(message) {
  throw new Error(`qualification-environment: ${message}`);
}

function parseHttpUrl(raw, label) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`${label} is not a valid URL: ${JSON.stringify(raw)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail(`${label} must be http(s), got ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    fail(`${label} must not embed credentials`);
  }
  return parsed;
}

export function isProductionHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === PRODUCTION_HOST || host.endsWith(`.${PRODUCTION_HOST}`);
}

function isLoopback(hostname) {
  return LOOPBACK_HOSTS.has(String(hostname || '').toLowerCase());
}

function projectRefFromHostname(hostname) {
  const match = /^([a-z0-9]{20})\.supabase\.co$/i.exec(String(hostname || ''));
  return match ? match[1].toLowerCase() : null;
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolve and authorize the qualification targets.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {{ requireAnonKey?: boolean }} [options]
 */
export function resolveQualificationEnvironment(env = process.env, options = {}) {
  const requireAnonKey = options.requireAnonKey !== false;
  const rawSupabaseUrl = String(env.SUPABASE_URL || 'http://127.0.0.1:54321').trim().replace(/\/$/, '');
  const supabase = parseHttpUrl(rawSupabaseUrl, 'SUPABASE_URL');
  const hostname = supabase.hostname.toLowerCase();

  if (isProductionHostname(hostname)) {
    fail(`refusing the production project (${PRODUCTION_HOST}) for qualification`);
  }

  const environment = String(env.QUALIFICATION_ENVIRONMENT || '').trim().toLowerCase();
  if (environment && !NON_PRODUCTION_ENVIRONMENTS.has(environment)) {
    fail(`QUALIFICATION_ENVIRONMENT must be staging|preview|local, got ${JSON.stringify(environment)}`);
  }

  let kind = 'local';
  if (!isLoopback(hostname)) {
    kind = 'hosted';
    const projectRef = projectRefFromHostname(hostname);
    if (!projectRef) {
      fail(
        `hosted target ${hostname} is not a recognized <project-ref>.supabase.co identity; ` +
          `add an explicit identity check before using it`,
      );
    }
    const allowed = parseCsv(env.QUALIFICATION_ALLOWED_PROJECT_REFS);
    if (!allowed.includes(projectRef)) {
      fail(
        `hosted target ${projectRef} is not in QUALIFICATION_ALLOWED_PROJECT_REFS ` +
          `(configure the authorized nonproduction project explicitly)`,
      );
    }
    if (projectRef === PRODUCTION_PROJECT_REF) {
      fail('refusing production even though it appears in the allowlist');
    }
    if (!NON_PRODUCTION_ENVIRONMENTS.has(environment) || environment === 'local') {
      fail(
        `hosted target ${projectRef} requires QUALIFICATION_ENVIRONMENT=staging|preview ` +
          `(got ${JSON.stringify(environment || '')})`,
      );
    }
    if (supabase.protocol !== 'https:') {
      fail('hosted qualification targets must use https');
    }
  }

  const anonKey = String(env.SUPABASE_ANON_KEY || '').trim();
  if (requireAnonKey && !anonKey) {
    fail('SUPABASE_ANON_KEY is required');
  }

  const stubUrl = String(env.STUB_URL || 'http://127.0.0.1:8899').trim().replace(/\/$/, '');
  const stub = parseHttpUrl(stubUrl, 'STUB_URL');
  if (!isLoopback(stub.hostname)) {
    const allowedStubHosts = parseCsv(env.QUALIFICATION_ALLOWED_STUB_HOSTS);
    if (!allowedStubHosts.includes(stub.hostname.toLowerCase())) {
      fail(
        `STUB_URL host ${stub.hostname} is not loopback and not in ` +
          `QUALIFICATION_ALLOWED_STUB_HOSTS; routine qualification must use a local substitute`,
      );
    }
  }

  const routerUrlRaw = String(env.SUPABASE_ROUTER_URL || env.VITE_ROUTER_ENDPOINT || '').trim();
  if (routerUrlRaw) {
    const router = parseHttpUrl(routerUrlRaw, 'SUPABASE_ROUTER_URL');
    if (router.hostname.toLowerCase() !== hostname) {
      fail(
        `router host ${router.hostname} does not match the Supabase host ${hostname}; ` +
          `the qualification would exercise a different project than it seeded`,
      );
    }
  }

  return {
    kind,
    environment: environment || (kind === 'local' ? 'local' : ''),
    supabaseUrl: rawSupabaseUrl,
    supabaseHostname: hostname,
    projectRef: projectRefFromHostname(hostname),
    anonKey,
    stubUrl,
    routerUrl: routerUrlRaw || `${rawSupabaseUrl}/functions/v1/router`,
    isLoopback: kind === 'local',
  };
}

/** Redact anything that looks like a credential before logging. */
export function redactSecrets(value) {
  return String(value)
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '<redacted-jwt>')
    .replace(/(apikey|authorization|service_role|anon_key)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1$2<redacted>');
}
