#!/usr/bin/env node
// Account-isolation qualification against the REAL local stack.
//
// Creates a conversation owned by user A (with a metered turn), then attempts
// every cross-account read/write with user B, anonymous access, and a
// controlled service-role control read. A failure here is a release blocker.
//
// No live provider: the router is backed by the deterministic stub.

import { randomUUID } from 'node:crypto';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error('isolation: SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const USER_A = { email: 'qual-a@example.test', password: 'qual-pass-a-1234' };
const USER_B = { email: 'qual-b@example.test', password: 'qual-pass-b-1234' };

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
}

async function signIn({ email, password }) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`sign-in failed for ${email}: ${response.status}`);
  return { token: body.access_token, userId: body.user.id };
}

function authHeaders(token) {
  return { apikey: ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function api(token, path, init = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(token), ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function createConversation(token, userId) {
  const id = randomUUID();
  const response = await api(token, '/rest/v1/conversations', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ id, user_id: userId }),
  });
  if (response.status !== 201) throw new Error(`A could not create a conversation: ${response.status}`);
  return id;
}

async function sendTurn(token, conversationId, query) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/router`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'x-client-request-id': randomUUID() },
    body: JSON.stringify({ conversationId, query, platform: 'web', history: [] }),
  });
  const body = await response.text();
  return { status: response.status, body };
}

async function main() {
  const a = await signIn(USER_A);
  const b = await signIn(USER_B);

  const conversationId = await createConversation(a.token, a.userId);
  const turn = await sendTurn(a.token, conversationId, 'Ownership isolation probe.');
  record('user A can complete a metered turn', turn.status === 200 && turn.body.includes('[DONE]'), `status=${turn.status}`);

  // --- User B: reads ---
  const bConversation = await api(b.token, `/rest/v1/conversations?id=eq.${conversationId}&select=*`);
  record(
    'B cannot read A conversation',
    bConversation.status === 200 && Array.isArray(bConversation.body) && bConversation.body.length === 0,
    `status=${bConversation.status} rows=${Array.isArray(bConversation.body) ? bConversation.body.length : 'n/a'}`,
  );

  const bMessages = await api(b.token, `/rest/v1/messages?conversation_id=eq.${conversationId}&select=*`);
  record(
    'B cannot read A messages',
    bMessages.status === 200 && Array.isArray(bMessages.body) && bMessages.body.length === 0,
    `status=${bMessages.status} rows=${Array.isArray(bMessages.body) ? bMessages.body.length : 'n/a'}`,
  );

  const bCosts = await api(b.token, `/rest/v1/cost_logs?conversation_id=eq.${conversationId}&select=*`);
  record(
    'B cannot read A cost logs',
    bCosts.status === 200 && Array.isArray(bCosts.body) && bCosts.body.length === 0,
    `status=${bCosts.status} rows=${Array.isArray(bCosts.body) ? bCosts.body.length : 'n/a'}`,
  );

  // --- User B: writes ---
  const bInsertMessage = await api(b.token, '/rest/v1/messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId, role: 'user', content: 'injected' }),
  });
  record(
    'B cannot insert into A conversation',
    bInsertMessage.status === 403 || bInsertMessage.status === 401,
    `status=${bInsertMessage.status}`,
  );

  const bUpdate = await api(b.token, `/rest/v1/conversations?id=eq.${conversationId}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ total_tokens: 0 }),
  });
  record(
    'B cannot update A conversation',
    Array.isArray(bUpdate.body) && bUpdate.body.length === 0,
    `status=${bUpdate.status} rows=${Array.isArray(bUpdate.body) ? bUpdate.body.length : 'n/a'}`,
  );

  const bDelete = await api(b.token, `/rest/v1/conversations?id=eq.${conversationId}`, {
    method: 'DELETE',
    headers: { prefer: 'return=representation' },
  });
  record(
    'B cannot delete A conversation',
    Array.isArray(bDelete.body) && bDelete.body.length === 0,
    `status=${bDelete.status} rows=${Array.isArray(bDelete.body) ? bDelete.body.length : 'n/a'}`,
  );

  // --- User B: router cannot be pointed at A's conversation ---
  const bTurn = await sendTurn(b.token, conversationId, 'Cross-account router probe.');
  let bTurnCode = null;
  try {
    bTurnCode = JSON.parse(bTurn.body)?.code ?? null;
  } catch {
    bTurnCode = null;
  }
  record(
    'B cannot route into A conversation',
    bTurn.status === 403 || bTurn.status === 404,
    `status=${bTurn.status} code=${bTurnCode}`,
  );

  // --- User B: privileged RPCs must not be executable ---
  const bKeyMaterial = await api(b.token, '/rest/v1/rpc/get_user_provider_key_material', {
    method: 'POST',
    body: JSON.stringify({ p_subject_id: a.userId, p_provider: 'openrouter' }),
  });
  record(
    'B cannot read A provider key material via RPC',
    bKeyMaterial.status === 401 || bKeyMaterial.status === 403 || bKeyMaterial.status === 404,
    `status=${bKeyMaterial.status}`,
  );

  const bGrant = await api(b.token, '/rest/v1/rpc/get_access_grant', {
    method: 'POST',
    body: JSON.stringify({ p_subject_id: a.userId }),
  });
  record(
    'B cannot read A access grant via RPC',
    bGrant.status === 401 || bGrant.status === 403 || bGrant.status === 404,
    `status=${bGrant.status}`,
  );

  const bSpendRpc = await api(b.token, '/rest/v1/rpc/get_spend_stats', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: a.userId }),
  });
  record(
    'B cannot invoke spend stats for A via RPC',
    bSpendRpc.status === 401 || bSpendRpc.status === 403 || bSpendRpc.status === 404,
    `status=${bSpendRpc.status}`,
  );

  // --- Anonymous access ---
  const anon = await fetch(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${conversationId}&select=*`, {
    headers: { apikey: ANON_KEY },
  });
  const anonBody = await anon.text();
  record(
    'anonymous cannot read A conversation',
    anon.status === 401 || anonBody === '[]',
    `status=${anon.status} body=${anonBody.slice(0, 40)}`,
  );

  // --- Service role control read (proves the row exists) ---
  const service = await fetch(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${conversationId}&select=id,user_id`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const serviceBody = await service.json();
  record(
    'service role control read sees exactly the owner row',
    service.status === 200 && Array.isArray(serviceBody) && serviceBody.length === 1 && serviceBody[0].user_id === a.userId,
    `status=${service.status} rows=${Array.isArray(serviceBody) ? serviceBody.length : 'n/a'}`,
  );

  // --- B's own data is unaffected ---
  const bOwn = await api(b.token, '/rest/v1/conversations?select=*');
  record(
    'B still sees only its own conversations',
    bOwn.status === 200 && Array.isArray(bOwn.body) && bOwn.body.every((row) => row.user_id === b.userId),
    `rows=${Array.isArray(bOwn.body) ? bOwn.body.length : 'n/a'}`,
  );

  const failed = results.filter((item) => !item.pass);
  console.log(JSON.stringify({ conversationId, userA: a.userId, userB: b.userId, results, failed: failed.length }, null, 2));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`isolation: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
