#!/usr/bin/env node
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { createByokFixtureAccount } from './byok-fixture-account.mjs';

const { settings, turn, receipt, stubScenario, providerCalls, noDispatch } =
  await createByokFixtureAccount('catalog', 'Write a short greeting.');
const provider = 'openrouter';
const routeId = 'openrouter:fixtures/new-compatible-chat';
const fixtureKey = process.env.STUB_EXPECTED_KEY ?? 'fake-byok-provider-key';

async function refresh() {
  const action = { action: 'refresh_inventory', provider };
  let response = await settings(action);
  if (response.status === 429) {
    const { retryAfterSeconds } = await response.json();
    assert.ok(retryAfterSeconds > 0 && retryAfterSeconds <= 30, 'bounded catalog cooldown');
    await setTimeout(retryAfterSeconds * 1000 + 200);
    response = await settings(action);
  }
  assert.equal(response.status, 200);
  return await response.json();
}

async function execute(expected) {
  const before = (await providerCalls()).length;
  const response = await turn({ modelOverride: routeId });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-router-model-id'), 'fixtures/new-compatible-chat');
  const stream = await response.text();
  const event = stream.split('\n').find((line) => line.startsWith('data: {"type":"receipt"'));
  assert.ok(event);
  const result = JSON.parse(event.slice(6));
  assert.equal(result.settlement.state, 'settled');
  assert.equal(result.settlement.committedUsd, expected);
  assert.equal(result.calls[0].tariff?.routeId, routeId);
  const calls = (await providerCalls()).slice(before);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'fixtures/new-compatible-chat');
  assert.equal(calls[0].authMatched, true);
  return result;
}

try {
  await stubScenario('new-catalog');
  const connected = await settings({ action: 'set_key', provider, apiKey: fixtureKey });
  assert.equal(connected.status, 200);
  assert.ok((await connected.json()).routes.some((route) => route.id === routeId));
  const before = await execute(0.000065);
  console.log('PASS new upstream model is discoverable and executable by its exact ID without a source catalog entry');

  await stubScenario('revised-catalog');
  await refresh();
  const after = await execute(0.000105);
  assert.notEqual(after.calls[0].tariff.version, before.calls[0].tariff.version);
  const old = await receipt(before.executionId);
  assert.equal(old.status, 200);
  const restored = await old.json();
  const historical = restored.receipt ?? restored;
  assert.equal(historical.settlement.committedUsd, 0.000065);
  assert.equal(historical.calls[0].tariff.version, before.calls[0].tariff.version);
  console.log('PASS changed tariff is used for new execution; persisted original receipt and tariff are unchanged');

  await stubScenario('retired');
  const beforeRetirement = (await providerCalls()).length;
  const retired = await turn({ modelOverride: routeId });
  assert.equal(retired.status, 409);
  assert.equal((await providerCalls()).length, beforeRetirement + 1);
  await noDispatch({ modelOverride: routeId }, 409, 'route_unavailable');
  assert.equal((await receipt(before.executionId)).status, 200);
  console.log('PASS upstream retirement removes the route with zero subsequent inference and retains history');

  await stubScenario('malformed-inventory');
  const out = await refresh();
  const connection = out.providers.find((item) => item.id === provider);
  assert.equal(connection.inventoryStatus, 'unavailable');
  assert.ok(connection.lastSuccessfulRefresh && connection.availableModelCount > 0);
  assert.equal(connection.userEnabled, true);
  assert.deepEqual(out.routes, []);
  await noDispatch({}, 400, 'provider_key_required');
  const disabled = await settings({ action: 'set_enabled', provider, enabled: false });
  assert.equal(disabled.status, 200);
  assert.equal((await disabled.json()).providers.find((item) => item.id === provider).userEnabled, false);
  console.log('PASS malformed inventory retains last successful provenance, fails closed and still allows disabling the connection');
} finally {
  await stubScenario('default');
}
