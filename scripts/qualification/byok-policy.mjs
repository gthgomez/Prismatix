import assert from 'node:assert/strict';
import { createByokFixtureAccount } from './byok-fixture-account.mjs';

const { settings, turn, providerCalls, noDispatch } = await createByokFixtureAccount('policy', 'Write a short greeting.');
for (const [provider, apiKey] of [
  ['openai', 'fixture-openai-provider-key'],
  ['openrouter', process.env.STUB_EXPECTED_KEY ?? 'fake-byok-provider-key'],
]) {
  const result = await settings({ action: 'set_key', provider, apiKey });
  assert.equal(result.status, 200);
  assert.ok((await result.json()).routes.some((route) => route.provider === provider));
}

const requested = async (overrides, provider, dollars) => {
  const before = (await providerCalls()).length;
  const response = await turn(overrides);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-provider'), provider);
  const raw = (await response.text()).split('\n').find((line) => line.startsWith('data: {"type":"receipt"'));
  assert.ok(raw);
  const receipt = JSON.parse(raw.slice(6));
  assert.equal(receipt.settlement.committedUsd, dollars);
  const calls = (await providerCalls()).slice(before);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].authMatched);
  console.log(JSON.stringify({ policy: overrides.routingProfile ?? 'manual baseline', provider, fixtureSettledUsd: dollars, calls: calls.length }));
};

await requested({ modelOverride: 'openai:gpt-6.2-sol' }, 'openai', 0.0002);
await requested({ routingProfile: 'economy' }, 'openrouter', 0.000075);
const disabled = await settings({ action: 'set_enabled', provider: 'openrouter', enabled: false });
assert.equal(disabled.status, 200);
await noDispatch({ modelOverride: 'openrouter:google/gemini-3.8-flash' }, 409, 'route_unavailable');
await requested({ routingProfile: 'economy' }, 'openai', 0.0002);

const allDisabled = await settings({ action: 'set_enabled', provider: 'openai', enabled: false });
assert.equal(allDisabled.status, 200);
assert.deepEqual((await allDisabled.json()).routes, []);
await noDispatch({}, 400, 'provider_key_required');
console.log('PASS a manually selected disabled provider never dispatches, Auto uses the remaining provider, and disabling both makes zero inference calls');
