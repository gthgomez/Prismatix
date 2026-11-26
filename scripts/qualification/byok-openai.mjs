#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createByokFixtureAccount } from './byok-fixture-account.mjs';

const { settings, turn, providerCalls, stubScenario, noDispatch } = await createByokFixtureAccount('byok', 'Write a short greeting.');
const fixtureKey = 'fixture-openai-provider-key';
const routeId = 'openai:gpt-6.2-sol';

const freshResponse = await settings();
const fresh = await freshResponse.json();
assert.equal(freshResponse.status, 200, `read provider settings (${String(fresh.error ?? fresh.message ?? 'unknown')})`);
assert.equal(fresh.defaultProvider, null);
assert.deepEqual(fresh.routes, []);
assert.ok(fresh.providers.every((provider) => !provider.enabled && !provider.hasKey));
await noDispatch({}, 400, 'provider_key_required');
console.log('PASS fresh account: no key, no preferred provider, no route, no inference');

const connect = await settings({ action: 'set_key', provider: 'openai', apiKey: fixtureKey });
assert.equal(connect.status, 200, 'save and discover OpenAI fixture');
const connected = await connect.json();
assert.ok(!JSON.stringify(connected).includes(fixtureKey));
assert.equal(connected.defaultProvider, null);
assert.deepEqual(connected.routes.map((route) => route.id), [routeId]);
const saved = connected.providers.find((provider) => provider.id === 'openai');
assert.ok(saved?.enabled && saved.hasKey && saved.lastSuccessfulRefresh);
console.log('PASS connected OpenAI: one qualified Responses route; unpriced inventory item excluded');

const money = [];
for (const overrides of [{ modelOverride: routeId }, { routingProfile: 'economy' }, { routingProfile: 'balanced' }, { routingProfile: 'capability' }]) {
  const before = (await providerCalls()).length;
  const response = await turn(overrides);
  assert.equal(response.status, 200, `turn ${JSON.stringify(overrides)}`);
  assert.equal(response.headers.get('x-provider'), 'openai');
  assert.equal(response.headers.get('x-router-model-id'), 'gpt-6.2-sol');
  const body = await response.text();
  assert.match(body, /content_block_delta/);
  assert.match(body, /\[DONE\]/);
  const event = body.split('\n').find((line) => line.startsWith('data: {"type":"receipt"'));
  assert.ok(event, 'terminal settlement event');
  const receipt = JSON.parse(event.slice(6));
  assert.equal(receipt.settlement.state, 'settled');
  assert.equal(receipt.settlement.committedUsd, 0.0002, 'fixture: 40 input at $2/M and 12 output at $10/M');
  assert.equal(receipt.calls.length, 1);
  assert.deepEqual(receipt.calls[0].usage, { promptTokens: 40, completionTokens: 8, reasoningTokens: 4 });
  assert.deepEqual(receipt.calls[0].costs, { inputUsd: 0.00008, outputUsd: 0.00008, thinkingUsd: 0.00004 });
  assert.equal(receipt.calls[0].tariff?.routeId, routeId);
  assert.equal(receipt.calls[0].tariff?.basis, 'tariff_estimate');
  const calls = (await providerCalls()).slice(before);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/openai/v1/responses');
  assert.equal(calls[0].model, 'gpt-6.2-sol');
  assert.equal(calls[0].authMatched, true);
  money.push(receipt.settlement.committedUsd);
}
console.log(`PASS exact manual and three Auto modes: four OpenAI Responses dispatches, settled fixture estimates ${money.join(', ')} USD`);

await noDispatch({ modelOverride: 'google:gemini-3.8-flash' }, 409, 'route_unavailable');
await noDispatch({ spendCapUsd: 0.000001 }, 402, 'request_cost_limit_exceeded');
console.log('PASS unavailable manual provider and exhausted request cap: zero dispatch');

try {
  await stubScenario('restricted');
  const before = (await providerCalls()).length;
  const restricted = await turn({ modelOverride: routeId });
  assert.equal(restricted.status, 409);
  assert.equal((await restricted.json()).code, 'provider_access_restricted');
  assert.equal((await providerCalls()).length, before + 1);
  await noDispatch({}, 400, 'provider_key_required');
  assert.deepEqual((await (await settings()).json()).routes, []);
  console.log('PASS upstream restriction invalidates exact route; the next request makes zero provider calls');
} finally {
  await stubScenario('default');
}

const removed = await settings({ action: 'delete_key', provider: 'openai' });
assert.equal(removed.status, 200);
assert.deepEqual((await removed.json()).routes, []);
await noDispatch({}, 400, 'provider_key_required');
console.log('PASS disconnect removes the route before any subsequent request');
