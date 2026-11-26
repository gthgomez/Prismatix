#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createByokFixtureAccount } from './byok-fixture-account.mjs';

for (const [provider, apiKey, billing] of [
  ['opencode', 'fixture-opencode-console-key', 'prepaid_credits'],
  ['opencode_go', 'fixture-opencode-go-key', 'subscription_allowance'],
]) {
  const { settings, turn, providerCalls, stubScenario, noDispatch } = await createByokFixtureAccount(provider, 'Write a JavaScript function and explain the implementation.');
  const response = await settings({ action: 'set_key', provider, apiKey });
  assert.equal(response.status, 200);
  const { routes } = await response.json();
  const routeId = `${provider}:fixture-code-model`;
  assert.deepEqual(routes.map((route) => route.id), [routeId]);
  assert.equal(routes[0].tariff.billing, billing);

  const before = (await providerCalls()).length;
  const routed = await turn({ modelOverride: routeId });
  assert.equal(routed.status, 200);
  assert.equal(routed.headers.get('x-provider'), provider);
  const body = await routed.text();
  const event = body.split('\n').find((line) => line.startsWith('data: {"type":"receipt"'));
  assert.ok(event);
  const receipt = JSON.parse(event.slice(6));
  assert.equal(receipt.calls[0].tariff.billingArrangement, billing);
  assert.equal(receipt.settlement.committedUsd, 0.000064);
  const calls = (await providerCalls()).slice(before);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/${provider}/v1/chat/completions`);
  assert.equal(calls[0].authMatched, true);
  assert.equal(calls[0].stableSessionPresent, true);
  console.log(`PASS ${provider} inventory and exact inference: ${billing}, settled USD 0.000064 fixture estimate`);

  if (provider === 'opencode_go') {
    await noDispatch({ query: 'Write a short greeting.' }, 409, 'route_incompatible');
    try {
      await stubScenario('quota-exhausted');
      await noDispatch({ modelOverride: routeId }, 402, 'provider_quota_exhausted');
      console.log('PASS Go coding-scope and post-discovery allowance controls: zero inference calls');
    } finally {
      await stubScenario('default');
    }
  }
}
