#!/usr/bin/env node
// Seeds a local (or explicitly isolated) Supabase stack for real-backend
// qualification:
//   * two confirmed Auth identities with synthetic passwords;
//   * one enabled OpenRouter BYOK row per identity (non-secret fixture key);
//   * verification that the signup trigger created an access grant.
//
// Safety: the shared qualification contract authorizes loopback automatically
// and a hosted target only when its project ref is explicitly allowlisted as a
// nonproduction staging identity. A boolean override is not sufficient.
import { resolveQualificationEnvironment } from './env-contract.mjs';

let target;
try {
  target = resolveQualificationEnvironment(process.env, { requireAnonKey: false });
} catch (error) {
  console.error(`seed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const SUPABASE_URL = target.supabaseUrl;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = target.anonKey;

// Non-secret fixtures that encrypt only a fake provider credential.
const BYOK_ENCRYPTION_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const FAKE_CIPHERTEXT =
  'BwcHBwcHBwcHBwcH0uOcYiLwPUwm4V3k2QUnCdr7wF6z6dQVvnbDMeeBV2H6hw4RWXE=';

const USERS = [
  { email: 'qual-a@example.test', password: 'qual-pass-a-1234' },
  { email: 'qual-b@example.test', password: 'qual-pass-b-1234' },
];

if (!SERVICE_ROLE_KEY) {
  console.error('seed: SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}

const adminHeaders = {
  apikey: SERVICE_ROLE_KEY,
  authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'content-type': 'application/json',
};

async function api(path, init = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { ...adminHeaders, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null
      ? (body.msg ?? body.message ?? JSON.stringify(body))
      : String(body);
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${message}`);
  }
  return body;
}

async function listUsers() {
  const body = await api('/auth/v1/admin/users?per_page=200');
  return Array.isArray(body?.users) ? body.users : [];
}

async function ensureUser({ email, password }, existing) {
  const found = existing.find((user) => user.email === email);
  if (found) {
    return { id: found.id, email, password, created: false };
  }
  const created = await api('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  return { id: created.id, email, password, created: true };
}

async function seedProviderKey(subjectId) {
  await api('/rest/v1/rpc/set_user_provider_key', {
    method: 'POST',
    body: JSON.stringify({
      p_subject_id: subjectId,
      p_provider: 'openrouter',
      p_ciphertext: FAKE_CIPHERTEXT,
      p_last4: 'key1',
      p_fingerprint: 'qualification-fixture-fingerprint',
      p_enabled: true,
    }),
  });
  await api('/rest/v1/rpc/set_user_default_provider', {
    method: 'POST',
    body: JSON.stringify({ p_subject_id: subjectId, p_provider: 'openrouter' }),
  });
}

async function readGrant(subjectId) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_access_grant`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ p_subject_id: subjectId }),
  });
  if (!response.ok) {
    return { error: await response.text() };
  }
  return { grant: await response.json() };
}

async function readProviderConfig(subjectId) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_user_provider_config`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ p_subject_id: subjectId }),
  });
  if (!response.ok) {
    return { error: await response.text() };
  }
  return { config: await response.json() };
}

async function main() {
  const existing = await listUsers();
  const seeded = [];
  for (const candidate of USERS) {
    const user = await ensureUser(candidate, existing);
    await seedProviderKey(user.id);
    const grant = await readGrant(user.id);
    const config = await readProviderConfig(user.id);
    seeded.push({
      id: user.id,
      email: user.email,
      password: user.password,
      created: user.created,
      grant: grant.grant ?? null,
      grantError: grant.error ?? null,
      providerConfig: config.config ?? null,
      providerConfigError: config.error ?? null,
    });
  }

  console.log(JSON.stringify({
    supabaseUrl: SUPABASE_URL,
    anonKeyPresent: ANON_KEY !== '',
    byokEncryptionKey: BYOK_ENCRYPTION_KEY,
    users: seeded,
  }, null, 2));
}

main().catch((error) => {
  console.error(`seed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
