#!/usr/bin/env node
// Acceptance gate for the REAL router Edge function against the local Supabase
// stack + deterministic stub provider.
//
// Unlike a diagnostic smoke run, this script FAILS (exit 1) when a business
// invariant is wrong: a wrong total, missing message, wrong token counts,
// duplicate execution, unexpected provider call, or a malformed receipt.
// Expected money is derived from the reviewed provider tariff below and the
// stub fixture's usage — never from the implementation under test.

import { randomUUID } from 'node:crypto';
import { resolveQualificationEnvironment } from './env-contract.mjs';

let target;
try {
  target = resolveQualificationEnvironment(process.env);
} catch (error) {
  console.error(`smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const SUPABASE_URL = target.supabaseUrl;
const ANON_KEY = target.anonKey;
const SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const STUB_URL = target.stubUrl;
const EMAIL = process.env.QUAL_EMAIL ?? 'qual-e@example.test';
const PASSWORD = process.env.QUAL_PASSWORD ?? 'qual-pass-e-1234';
const QUERY = 'Qualification acceptance prompt.';

// Stub fixture (scripts/qualification/stub-provider.mjs, `default` scenario).
const FIXTURE = {
  content: process.env.STUB_TEXT ?? 'Prismatix deterministic stub response.',
  promptTokens: 40,
  completionTokens: 12,
  provider: 'openrouter',
  model: /gemini-3\.8-flash/i,
};

// Reviewed Gemini 3.8 Flash tariff, USD per 1M tokens (2026-11-24). Kept
// independent of src/pricingRegistry.ts / model_tariff.ts so a regression in
// the tariff cannot silently redefine the expected result.
const TARIFF = { inputPerM: 0.75, outputPerM: 3.75 };
const EXPECTED = {
  inputCostUsd: (FIXTURE.promptTokens * TARIFF.inputPerM) / 1_000_000,
  outputCostUsd: (FIXTURE.completionTokens * TARIFF.outputPerM) / 1_000_000,
};
EXPECTED.totalCostUsd = Math.round((EXPECTED.inputCostUsd + EXPECTED.outputCostUsd) * 1_000_000) / 1_000_000;

const MICRO = 1_000_000;
function micros(value) {
  return Math.round(Number(value) * MICRO);
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

async function stubControl(path, scenario) {
  const response = await fetch(`${STUB_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(path === '/__control' ? { body: JSON.stringify({ scenario }) } : {}),
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
  const events = [];
  for (const block of text.split('\n\n')) {
    const line = block.trim();
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6);
    if (payload === '[DONE]') continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      events.push({ malformed: payload.slice(0, 120) });
    }
  }

  return {
    status: response.status,
    contentType: headers['content-type'] ?? '',
    executionId: headers['x-prismatix-execution-id'] ?? null,
    model: headers['x-router-model-id'] ?? null,
    provider: headers['x-provider'] ?? null,
    events,
    content: events
      .filter((event) => event.type === 'content_block_delta')
      .map((event) => event.delta?.text ?? '')
      .join(''),
    rawLength: text.length,
  };
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

async function serviceRpc(name, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await json(response);
  if (!response.ok) {
    throw new Error(`${name} failed: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function readMessages(token, conversationId) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/messages?conversation_id=eq.${conversationId}&select=id,role,content,model_used&order=created_at.asc`,
    { headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` } },
  );
  return { status: response.status, body: await json(response) };
}

/** Bounded readiness polling instead of a fixed sleep. */
async function waitFor(read, predicate, { label, timeoutMs = 15000, intervalMs = 150 }) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(last)?.slice(0, 400)}`);
}

class AcceptanceError extends Error {
  constructor(failures) {
    super(`${failures.length} acceptance failure(s): ${failures.map((f) => f.label).join('; ')}`);
    this.failures = failures;
  }
}

/**
 * Pure invariant check. Exported for negative controls: mutating the evidence
 * must make this throw.
 */
export function validateTurnEvidence(evidence) {
  const failures = [];
  const check = (condition, label, detail) => {
    if (!condition) failures.push({ label, detail });
  };
  const { turn, receipt, costLogs, messages, providerCalls, userId, conversationId } = evidence;
  const receiptBody = receipt?.body?.receipt;

  check(turn.status === 200, 'router HTTP status is 200', turn.status);
  check(/text\/event-stream/i.test(turn.contentType), 'router returns an SSE stream', turn.contentType);
  check(Boolean(turn.executionId), 'router reports an execution id', turn.executionId);
  check(
    !turn.events.some((event) => event.malformed !== undefined),
    'every SSE data frame is valid JSON',
    turn.events.filter((event) => event.malformed !== undefined),
  );
  check(turn.content === FIXTURE.content, 'assistant content matches the fixture', turn.content);
  check(FIXTURE.provider === turn.provider, 'router reports the expected provider', turn.provider);
  check(FIXTURE.model.test(String(turn.model ?? '')), 'router reports the expected model', turn.model);

  check(receipt?.status === 200, 'receipt action returns 200', receipt?.status);
  check(Boolean(receiptBody), 'receipt body carries a receipt', receipt?.body);
  check(receiptBody?.executionId === turn.executionId, 'receipt belongs to this execution', receiptBody?.executionId);
  check(receiptBody?.status === 'completed', 'receipt status is completed', receiptBody?.status);
  check(receiptBody?.settlement?.state === 'settled', 'receipt settlement is settled', receiptBody?.settlement);
  check(
    receiptBody?.settlement?.committedUsd !== undefined
      && micros(receiptBody.settlement.committedUsd) === micros(EXPECTED.totalCostUsd),
    'settled amount equals the independently computed total',
    { actual: receiptBody?.settlement?.committedUsd, expected: EXPECTED.totalCostUsd },
  );
  check(
    Array.isArray(receiptBody?.calls)
      && receiptBody.calls.length > 0
      && receiptBody.calls.every((call) => call.costStatus === 'settled'),
    'every ledger call is settled',
    receiptBody?.calls,
  );

  check(costLogs?.status === 200, 'cost-log read returns 200', costLogs?.status);
  const rows = Array.isArray(costLogs?.body) ? costLogs.body : [];
  check(rows.length === 1, 'exactly one cost-log row for the turn', rows.length);
  const row = rows[0] ?? {};
  check(row.user_id === userId, 'cost log belongs to the signed-in account', row.user_id);
  check(row.conversation_id === conversationId, 'cost log belongs to the conversation', row.conversation_id);
  check(row.idempotency_key === turn.executionId, 'cost log idempotency key is the execution id', row.idempotency_key);
  check(row.cost_status === 'settled', 'cost-log status is settled', row.cost_status);
  check(row.breakdown_source === 'confirmed', 'cost-log breakdown is confirmed', row.breakdown_source);
  check(Number(row.input_tokens) === FIXTURE.promptTokens, 'input token count matches provider usage', row.input_tokens);
  check(Number(row.output_tokens) === FIXTURE.completionTokens, 'output token count matches provider usage', row.output_tokens);
  check(micros(row.input_cost) === micros(EXPECTED.inputCostUsd), 'input cost matches the tariff', row.input_cost);
  check(micros(row.output_cost) === micros(EXPECTED.outputCostUsd), 'output cost matches the tariff', row.output_cost);
  check(micros(row.total_cost) === micros(EXPECTED.totalCostUsd), 'total cost matches the tariff', row.total_cost);
  check(
    micros(row.input_cost) + micros(row.output_cost) + micros(row.thinking_cost) === micros(row.total_cost),
    'cost-log components reconcile with the total',
    { input: row.input_cost, output: row.output_cost, thinking: row.thinking_cost, total: row.total_cost },
  );

  const messageRows = Array.isArray(messages?.body) ? messages.body : [];
  check(messages?.status === 200, 'message read returns 200', messages?.status);
  check(messageRows.length === 2, 'exactly one user and one assistant message', messageRows.length);
  check(messageRows[0]?.role === 'user' && messageRows[0]?.content === QUERY, 'user message persisted verbatim', messageRows[0]);
  check(messageRows[1]?.role === 'assistant' && messageRows[1]?.content === FIXTURE.content, 'assistant message persisted', messageRows[1]);
  check(messageRows.filter((m) => m.role === 'assistant').length === 1, 'assistant message is not duplicated', messageRows);

  check(providerCalls.length >= 1, 'the turn dispatched a provider call', providerCalls);
  // Memory extraction is a separately admitted, metered execution that asks
  // for usage frames. Only `include_usage: false` calls are the chat turn.
  const chatCalls = providerCalls.filter((call) => call.hasUsageOption === false);
  check(chatCalls.length === 1, 'exactly one chat provider call', chatCalls);
  check(chatCalls.every((call) => call.authMatched === true), 'the chat call carries the decrypted BYOK key', chatCalls);
  check(
    providerCalls.filter((call) => call.hasUsageOption === true).length <= 1,
    'at most one background extraction call (independently metered)',
    providerCalls.filter((call) => call.hasUsageOption === true),
  );

  if (failures.length > 0) throw new AcceptanceError(failures);
}

function negativeControls(evidence) {
  const mutations = [
    ['wrong settled total', (copy) => { copy.receipt.body.receipt.settlement.committedUsd = 0.000076; }],
    ['wrong input tokens', (copy) => { copy.costLogs.body[0].input_tokens = 127; }],
    ['wrong total cost', (copy) => { copy.costLogs.body[0].total_cost = 0.000074; }],
    ['unconfirmed breakdown labelled settled', (copy) => { copy.costLogs.body[0].breakdown_source = 'estimated'; }],
    ['missing assistant message', (copy) => { copy.messages.body = [copy.messages.body[0]]; }],
    ['duplicate assistant message', (copy) => { copy.messages.body.push({ ...copy.messages.body[1], id: 'duplicate' }); }],
    ['extra chat provider call', (copy) => { copy.providerCalls.push({ ...copy.providerCalls[0] }); }],
    ['malformed receipt state', (copy) => { copy.receipt.body.receipt.settlement.state = 'pending'; }],
    ['wrong assistant content', (copy) => { copy.turn.content = 'different text'; }],
    ['duplicate cost log', (copy) => { copy.costLogs.body.push({ ...copy.costLogs.body[0] }); }],
  ];

  const results = [];
  for (const [label, mutate] of mutations) {
    const copy = structuredClone(evidence);
    mutate(copy);
    let rejected = false;
    try {
      validateTurnEvidence(copy);
    } catch (error) {
      rejected = error instanceof AcceptanceError;
    }
    results.push({ label, rejected });
  }
  const missed = results.filter((item) => !item.rejected);
  if (missed.length > 0) {
    throw new Error(`negative controls were NOT rejected: ${missed.map((item) => item.label).join(', ')}`);
  }
  return results;
}

/**
 * R1 real-backend probes for the non-happy breakdown states.
 *
 * no-usage: the provider reports no usage, so the execution stays PENDING and
 *           the cost log must say `estimated` (total and components both
 *           estimates that reconcile with each other — never "confirmed").
 * zero:     a settled zero-cost turn must be `confirmed` with zero components,
 *           which is different from an unavailable breakdown.
 */
async function runBreakdownProbes(token, userId) {
  const failures = [];
  const check = (condition, label, detail) => {
    if (!condition) failures.push({ label, detail });
  };

  for (const [scenario, query] of [
    ['no-usage', 'No-usage breakdown probe.'],
    ['zero', 'Zero-cost breakdown probe.'],
  ]) {
    await stubControl('/__control', scenario);
    const conversationId = await createConversation(token, userId);
    const before = await stubRequests();
    const turn = await runTurn(token, conversationId, query);
    const receiptResponse = turn.executionId
      ? await waitFor(
        () => fetchReceipt(token, turn.executionId),
        (value) => value.status === 200 && Boolean(value.body?.receipt ?? value.body?.executionId),
        { label: `${scenario} receipt` },
      )
      : { status: 0, body: null };
    const receipt = receiptResponse.body?.receipt ?? receiptResponse.body;
    const costLogs = await waitFor(
      () => readCostLogs(token, conversationId),
      (value) => value.status === 200 && Array.isArray(value.body) && value.body.length > 0,
      { label: `${scenario} cost log` },
    );
    const messages = await waitFor(
      () => readMessages(token, conversationId),
      (value) => value.status === 200 && Array.isArray(value.body) && value.body.length >= 2,
      { label: `${scenario} messages` },
    );
    const after = await stubRequests();
    const chatCalls = (after.requests ?? [])
      .slice(before.requests?.length ?? 0)
      .filter((call) => call.path === '/v1/chat/completions' && call.hasUsageOption === false);

    const row = (costLogs.body ?? [])[0] ?? {};
    const totalMicros = micros(row.total_cost);
    const componentMicros = micros(row.input_cost) + micros(row.output_cost) + micros(row.thinking_cost);

    check(turn.status === 200 && turn.content === FIXTURE.content, `${scenario}: turn completes`, turn.status);
    check((costLogs.body ?? []).length === 1, `${scenario}: exactly one cost-log row`, (costLogs.body ?? []).length);
    check((messages.body ?? []).length === 2, `${scenario}: both messages persist`, messages.body);
    check(chatCalls.length === 1, `${scenario}: exactly one chat call`, chatCalls);
    check(chatCalls.every((call) => call.authMatched === true), `${scenario}: BYOK key used`, chatCalls);

    if (scenario === 'no-usage') {
      check(receipt?.settlement?.state === 'pending', 'no-usage: settlement stays pending', receipt?.settlement);
      check(row.cost_status === 'pending', 'no-usage: cost log stays pending', row.cost_status);
      check(row.breakdown_source === 'estimated', 'no-usage: breakdown is estimated', row.breakdown_source);
      check(totalMicros > 0, 'no-usage: estimate is positive', row.total_cost);
      check(componentMicros === totalMicros, 'no-usage: estimated components reconcile with the estimate', row);
    } else {
      check(receipt?.settlement?.state === 'settled', 'zero: settlement is settled', receipt?.settlement);
      check(micros(receipt?.settlement?.committedUsd) === 0, 'zero: settled total is zero', receipt?.settlement?.committedUsd);
      check(row.cost_status === 'settled', 'zero: cost log is settled', row.cost_status);
      check(row.breakdown_source === 'confirmed', 'zero: zero breakdown is confirmed, not unavailable', row.breakdown_source);
      check(totalMicros === 0 && componentMicros === 0, 'zero: no invented cost', row);
      check(Number(row.input_tokens) === 0 && Number(row.output_tokens) === 0, 'zero: no invented tokens', row);
    }
  }

  await stubControl('/__control', 'default');

  if (failures.length > 0) {
    console.error('\nsmoke: BREAKDOWN-PROVENANCE CHECK FAILED');
    for (const failure of failures) {
      console.error(`  ✗ ${failure.label}`);
      console.error(`    ${JSON.stringify(failure.detail)}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('smoke: breakdown provenance ACCEPTED (pending/estimated and settled/confirmed zero both honest)');
}

/**
 * R1 settled/unavailable probe.
 *
 * The previous gate covered confirmed, pending/estimated and confirmed-zero.
 * The missing state is a genuinely SETTLED execution whose per-call component
 * columns do not reconcile with the settled total. This is the historical
 * corruption shape: a consumer that trusts the components (or treats zero
 * placeholders as real) would report $0.0000 input/output for a $0.000075
 * charge. The ledger/receipt contract must keep the total and expose enough
 * evidence for the client to classify the breakdown as unavailable.
 *
 * Uses service-role RPCs only to create the corrupted fixture; the receipt is
 * then read through the same authenticated user-facing action as production.
 */
async function runSettledUnavailableProbe(token, userId) {
  if (!SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for the settled/unavailable probe');
  }
  const conversationId = await createConversation(token, userId);
  const created = await serviceRpc('px03_create_execution', {
    p_subject_id: userId,
    p_conversation_id: conversationId,
    p_client_request_key: `qual-unavailable-${randomUUID()}`,
    p_payload_hash: 'qual-unavailable-components',
  });
  const executionId = created?.execution?.id;
  if (!executionId) throw new Error(`probe execution was not created: ${JSON.stringify(created)}`);

  const admission = await serviceRpc('px05_admit_execution', {
    p_subject_id: userId,
    p_execution_id: executionId,
    p_estimate_usd: 0.1,
    p_max_usd: 0.1,
    p_lease_seconds: 60,
    p_request_limit: 5000,
    p_user_daily_usd: 5,
    p_project_daily_usd: 5,
    p_active_limit: 10,
  });
  if (admission?.admitted !== true) {
    throw new Error(`probe admission failed: ${JSON.stringify(admission)}`);
  }

  await serviceRpc('px03_record_model_call', {
    p_execution_id: executionId,
    p_stage: 'primary',
    p_participant: 'fixture',
    p_attempt_number: 1,
    p_input_tokens: 40,
    p_output_tokens: 12,
    p_thinking_tokens: 0,
    // The settled total is real; the component columns are the corrupt part.
    p_input_cost: 0,
    p_output_cost: 0,
    p_thinking_cost: 0,
    p_total_cost: 0.000075,
    p_cost_status: 'settled',
  });
  const commit = await serviceRpc('px05_commit_from_ledger', { p_execution_id: executionId });
  if (commit?.state !== 'committed' || micros(commit?.committed_usd) !== 75) {
    throw new Error(`probe settlement did not commit 75 micros: ${JSON.stringify(commit)}`);
  }
  await serviceRpc('px03_finalize_execution', {
    p_execution_id: executionId,
    p_status: 'completed',
    p_terminal_outcome: 'ok',
    p_served_model: 'gemini-3.8-flash',
  });

  const receiptResponse = await fetchReceipt(token, executionId);
  const receipt = receiptResponse.body?.receipt ?? receiptResponse.body;
  const call = receipt?.calls?.[0];
  const componentMicros = call?.costs
    ? micros(call.costs.inputUsd) + micros(call.costs.outputUsd) + micros(call.costs.thinkingUsd)
    : null;

  const failures = [];
  const check = (condition, label, detail) => {
    if (!condition) failures.push({ label, detail });
  };
  check(receiptResponse.status === 200, 'settled/unavailable: receipt action returns 200', receiptResponse.status);
  check(receipt?.settlement?.state === 'settled', 'settled/unavailable: settlement is settled', receipt?.settlement);
  check(micros(receipt?.settlement?.committedUsd) === 75, 'settled/unavailable: settled total is 75 micros', receipt?.settlement);
  check(call?.costStatus === 'settled', 'settled/unavailable: call is settled', call);
  check(micros(call?.totalCost) === 75, 'settled/unavailable: call total is 75 micros', call);
  check(componentMicros !== null, 'settled/unavailable: component columns are present', call?.costs);
  check(
    componentMicros !== 75,
    'settled/unavailable: zero placeholders do NOT reconcile with the settled total',
    { componentMicros, totalMicros: micros(call?.totalCost) },
  );
  if (failures.length > 0) {
    console.error('\nsmoke: SETTLED/UNAVAILABLE CHECK FAILED');
    for (const failure of failures) {
      console.error(`  ? ${failure.label}`);
      console.error(`    ${JSON.stringify(failure.detail)}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('smoke: settled/unavailable ACCEPTED (total preserved, zero component placeholders cannot be confirmed)');
  return { executionId, conversationId };
}

async function main() {
  const session = await signIn();
  const token = session.access_token;
  const userId = session.user.id;

  await stubControl('/__reset');
  const conversationId = await createConversation(token, userId);
  const baselineRequests = await stubRequests();

  const turn = await runTurn(token, conversationId, QUERY);
  const receiptResponse = turn.executionId
    ? await waitFor(
      () => fetchReceipt(token, turn.executionId),
      (value) => value.status === 200 && Boolean(value.body?.receipt ?? value.body?.executionId),
      { label: 'execution receipt' },
    )
    : { status: 0, body: null };
  // The action has been observed both wrapped ({ receipt }) and flat.
  const receipt = {
    status: receiptResponse.status,
    body: { receipt: receiptResponse.body?.receipt ?? receiptResponse.body },
  };

  const costLogs = await waitFor(
    () => readCostLogs(token, conversationId),
    (value) => value.status === 200 && Array.isArray(value.body) && value.body.length > 0,
    { label: 'cost log' },
  );
  const messages = await waitFor(
    () => readMessages(token, conversationId),
    (value) => value.status === 200 && Array.isArray(value.body) && value.body.length >= 2,
    { label: 'persisted messages' },
  );
  const after = await stubRequests();
  const providerCalls = (after.requests ?? [])
    .slice(baselineRequests.requests?.length ?? 0)
    .filter((request) => request.path === '/v1/chat/completions');

  const evidence = { turn, receipt, costLogs, messages, providerCalls, userId, conversationId };

  console.log(JSON.stringify({
    step: 'evidence',
    userId,
    conversationId,
    executionId: turn.executionId,
    status: turn.status,
    contentLength: turn.content.length,
    events: turn.events.map((event) => event.type ?? Object.keys(event)[0]),
    receiptState: receipt.body?.receipt?.settlement?.state ?? null,
    committedUsd: receipt.body?.receipt?.settlement?.committedUsd ?? null,
    costLog: costLogs.body?.[0]
      ? {
        total: costLogs.body[0].total_cost,
        status: costLogs.body[0].cost_status,
        breakdown: costLogs.body[0].breakdown_source,
        tokens: [costLogs.body[0].input_tokens, costLogs.body[0].output_tokens],
      }
      : null,
    messages: (messages.body ?? []).map((message) => message.role),
    chatProviderCalls: providerCalls.filter((call) => call.hasUsageOption === false).length,
    backgroundProviderCalls: providerCalls.filter((call) => call.hasUsageOption === true).length,
    expected: EXPECTED,
  }, null, 2));

  try {
    validateTurnEvidence(evidence);
  } catch (error) {
    if (error instanceof AcceptanceError) {
      console.error('\nsmoke: ACCEPTANCE FAILED');
      for (const failure of error.failures) {
        console.error(`  ✗ ${failure.label}`);
        console.error(`    ${JSON.stringify(failure.detail)}`);
      }
      process.exit(1);
    }
    throw error;
  }

  const controls = negativeControls(evidence);
  console.log(`\nsmoke: ${controls.length}/${controls.length} negative controls rejected`);
  console.log('smoke: ACCEPTED — fixture content, usage, tariff, settlement, persistence and call count all reconcile');

  await runBreakdownProbes(token, userId);
  await runSettledUnavailableProbe(token, userId);
}

main().catch((error) => {
  console.error(`smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
