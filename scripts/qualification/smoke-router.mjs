#!/usr/bin/env node
// Direct, non-browser qualification of the REAL router Edge function against
// the local Supabase stack + deterministic stub provider.
//
// Proves: Auth -> PostgREST/RLS -> router -> provider stub -> ledger/receipt.
// No live provider call, no mocked network.

import { randomUUID } from 'node:crypto';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const STUB_URL = (process.env.STUB_URL ?? 'http://127.0.0.1:8899').replace(/\/$/, '');
const EMAIL = process.env.QUAL_EMAIL ?? 'qual-a@example.test';
const PASSWORD = process.env.QUAL_PASSWORD ?? 'qual-pass-a-1234';

if (!ANON_KEY) {
  console.error('smoke: SUPABASE_ANON_KEY is required');
  process.exit(1);
}

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

async function stub(scenario) {
  const response = await fetch(`${STUB_URL}/__control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario }),
  });
  return json(response);
}

async function stubRequests() {
  return json(await fetch(`${STUB_URL}/__requests`));
}

async function runTurn(token, conversationId, query) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/router`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-client-request-id': randomUUID(),
    },
    body: JSON.stringify({ conversationId, query, platform: 'web', history: [] }),
  });

  const headers = Object.fromEntries(response.headers.entries());
  const text = await response.text();
  const events = text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => block.slice(6))
    .filter((payload) => payload !== '[DONE]')
    .map((payload) => {
      try {
        return JSON.parse(payload);
      } catch {
        return { unparsed: payload.slice(0, 120) };
      }
    });

  return { status: response.status, headers, events, rawLength: text.length };
}

async function fetchReceipt(token, executionId) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/router`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action: 'execution_receipt', executionId }),
  });
  return { status: response.status, body: await json(response) };
}

async function readCostLogs(token, conversationId) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/cost_logs?conversation_id=eq.${conversationId}&select=*`,
    { headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` } },
  );
  return { status: response.status, body: await json(response) };
}

async function readMessages(token, conversationId) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/messages?conversation_id=eq.${conversationId}&select=id,role,content,model_used&order=created_at.asc`,
    { headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` } },
  );
  return { status: response.status, body: await json(response) };
}

async function main() {
  const session = await signIn();
  const token = session.access_token;
  const userId = session.user.id;
  console.log(JSON.stringify({ step: 'sign-in', userId, expiresIn: session.expires_in }, null, 2));

  await stub('default');
  const conversationId = await createConversation(token, userId);
  console.log(JSON.stringify({ step: 'conversation', conversationId }, null, 2));

  const turn = await runTurn(token, conversationId, 'Qualification smoke prompt.');
  console.log(JSON.stringify({
    step: 'router-turn',
    status: turn.status,
    executionId: turn.headers['x-prismatix-execution-id'] ?? null,
    model: turn.headers['x-router-model-id'] ?? null,
    provider: turn.headers['x-provider'] ?? null,
    estimate: turn.headers['x-cost-estimate-usd'] ?? null,
    eventTypes: turn.events.map((event) => event.type ?? Object.keys(event)[0]),
    receipt: turn.events.find((event) => event.type === 'receipt') ?? null,
    content: turn.events
      .filter((event) => event.type === 'content_block_delta')
      .map((event) => event.delta?.text ?? '')
      .join(''),
  }, null, 2));

  const executionId = turn.headers['x-prismatix-execution-id'];
  if (executionId) {
    console.log(JSON.stringify({ step: 'receipt', ...(await fetchReceipt(token, executionId)) }, null, 2));
  }

  console.log(JSON.stringify({ step: 'cost-logs', ...(await readCostLogs(token, conversationId)) }, null, 2));
  console.log(JSON.stringify({ step: 'messages', ...(await readMessages(token, conversationId)) }, null, 2));
  console.log(JSON.stringify({ step: 'stub-requests', ...(await stubRequests()) }, null, 2));
}

main().catch((error) => {
  console.error(`smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
