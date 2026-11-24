#!/usr/bin/env node
// Production-equivalent per-user admission rate-limit probe.
//
// The router's default window is 20 admitted executions per user per minute.
// Qualification must not raise that limit: a passing suite with a 500-request
// override would not prove the control users actually get.
//
// This probe uses a dedicated disposable identity and the deterministic
// zero-cost provider scenario, so 20 admitted turns do not spend money. It
// asserts:
//   * the first `limit` requests are admitted;
//   * the next request is rejected with 429 and a Retry-After in the window;
//   * rejection dispatches no provider call and creates no assistant message;
//   * after the window rolls, a new request is admitted again.
import { randomUUID } from 'node:crypto';
import { resolveQualificationEnvironment } from './env-contract.mjs';

const LIMIT = 20;

let target;
try {
  target = resolveQualificationEnvironment(process.env);
} catch (error) {
  console.error(`rate-limit: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const SUPABASE_URL = target.supabaseUrl;
const ANON_KEY = target.anonKey;
const STUB_URL = target.stubUrl;
const EMAIL = process.env.QUAL_RATE_EMAIL ?? 'qual-f@example.test';
const PASSWORD = process.env.QUAL_RATE_PASSWORD ?? 'qual-pass-f-1234';
const QUERY = 'Rate-limit qualification turn.';

async function json(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function signIn() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await json(response);
  if (!response.ok) throw new Error(`sign-in failed: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function createConversation(token, userId) {
  const id = randomUUID();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/conversations`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify({ id, user_id: userId }),
  });
  const body = await json(response);
  if (!response.ok) throw new Error(`conversation insert failed: ${response.status} ${JSON.stringify(body)}`);
  return id;
}

async function stubControl(scenario) {
  const response = await fetch(`${STUB_URL}/__control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario }),
  });
  if (!response.ok) throw new Error(`stub control failed: ${response.status}`);
  return json(response);
}

async function stubRequestCount() {
  const body = await json(await fetch(`${STUB_URL}/__requests`));
  return Array.isArray(body?.requests) ? body.requests.length : 0;
}

async function runTurn(token, conversationId) {
  const started = Date.now();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/router`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-client-request-id': randomUUID(),
    },
    // Mobile bypasses the separately admitted memory-extraction execution, so
    // one HTTP turn consumes exactly one admission slot. That makes the probe
    // measure the per-minute limit rather than background auxiliary work.
    body: JSON.stringify({ conversationId, query: QUERY, platform: 'mobile', history: [] }),
  });
  const body = await json(response);
  return {
    status: response.status,
    retryAfter: response.headers.get('retry-after'),
    code: body?.code ?? body?.error ?? null,
    elapsedMs: Date.now() - started,
  };
}

async function countMessages(token, conversationId) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/messages?conversation_id=eq.${conversationId}&select=id,role`,
    { headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` } },
  );
  const body = await json(response);
  return Array.isArray(body) ? body : [];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const session = await signIn();
  const token = session.access_token;
  const userId = session.user.id;

  await stubControl('zero');
  const conversationId = await createConversation(token, userId);

  const admitted = [];
  for (let i = 1; i <= LIMIT; i += 1) {
    const result = await runTurn(token, conversationId);
    if (result.status !== 200) {
      throw new Error(`request ${i}/${LIMIT} was not admitted: HTTP ${result.status} ${JSON.stringify(result)}`);
    }
    admitted.push(result);
  }

  const messagesBefore = await countMessages(token, conversationId);
  const providerCallsBefore = await stubRequestCount();
  const rejected = await runTurn(token, conversationId);
  const providerCallsAfter = await stubRequestCount();
  const messagesAfter = await countMessages(token, conversationId);

  const failures = [];
  const check = (condition, label, detail) => {
    if (!condition) failures.push({ label, detail });
  };

  check(rejected.status === 429, 'the request after the limit is HTTP 429', rejected);
  check(rejected.code === 'rate_limited', 'the rejection is the rate limiter, not budget', rejected.code);
  const retryAfter = Number(rejected.retryAfter);
  check(
    Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 60,
    'Retry-After is a positive number of seconds inside the window',
    rejected.retryAfter,
  );
  check(providerCallsAfter === providerCallsBefore, 'a rejected request dispatches no provider call', {
    before: providerCallsBefore,
    after: providerCallsAfter,
  });
  check(
    messagesAfter.length === messagesBefore.length,
    'a rejected request creates no assistant message',
    { before: messagesBefore.length, after: messagesAfter.length },
  );

  if (failures.length > 0) {
    console.error('\nrate-limit: FAILED');
    for (const failure of failures) {
      console.error(`  ? ${failure.label}`);
      console.error(`    ${JSON.stringify(failure.detail)}`);
    }
    process.exit(1);
  }

  // Recovery: wait out the published window, then prove admission resumes.
  const waitMs = (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60) + 2;
  console.log(`rate-limit: 20/20 admitted, 21st rejected with Retry-After=${retryAfter}s; waiting ${waitMs}s for window recovery`);
  await sleep(waitMs * 1000);
  const recovered = await runTurn(token, conversationId);
  if (recovered.status !== 200) {
    throw new Error(`request after the rate-limit window was not admitted: HTTP ${recovered.status} ${JSON.stringify(recovered)}`);
  }

  await stubControl('default');
  console.log('rate-limit: PASS (limit admission, 429 + Retry-After, no dispatch, window recovery)');
}

main().catch(async (error) => {
  await stubControl('default').catch(() => {});
  console.error(`rate-limit: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
