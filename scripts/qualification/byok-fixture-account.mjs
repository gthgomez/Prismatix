import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolveQualificationEnvironment } from './env-contract.mjs';

export async function createByokFixtureAccount(emailPrefix, query) {
  const target = resolveQualificationEnvironment(process.env);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(serviceKey, 'local fixture service key required');
  const api = (path) => `${target.supabaseUrl}${path}`;
  const adminHeaders = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' };
  const email = `qual-${emailPrefix}-${randomUUID()}@example.test`;
  const password = randomUUID();

  const created = await fetch(api('/auth/v1/admin/users'), {
    method: 'POST', headers: adminHeaders, body: JSON.stringify({ email, password, email_confirm: true }),
  });
  assert.equal(created.status, 200, 'create isolated qualification account');
  const signIn = await fetch(api('/auth/v1/token?grant_type=password'), {
    method: 'POST', headers: { apikey: target.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(signIn.status, 200, 'sign in isolated qualification account');
  const { access_token: token, user } = await signIn.json();
  const headers = { apikey: target.anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const conversationId = randomUUID();
  const inserted = await fetch(api('/rest/v1/conversations'), {
    method: 'POST', headers, body: JSON.stringify({ id: conversationId, user_id: user.id }),
  });
  assert.equal(inserted.status, 201, 'create owned conversation');

  const settings = (body) => fetch(api('/functions/v1/provider-settings'), body
    ? { method: 'POST', headers, body: JSON.stringify(body) }
    : { headers });
  const turn = (overrides = {}) => fetch(api('/functions/v1/router'), {
    method: 'POST', headers: { ...headers, 'x-client-request-id': randomUUID() },
    body: JSON.stringify({ conversationId, query, platform: 'mobile', history: [], ...overrides }),
  });
  const receipt = (executionId) => fetch(api('/functions/v1/router'), {
    method: 'POST', headers, body: JSON.stringify({ action: 'execution_receipt', executionId }),
  });
  const providerCalls = async () => {
    const response = await fetch(`${target.stubUrl}/__requests`);
    assert.equal(response.status, 200);
    return (await response.json()).requests.filter((request) => request.kind !== 'metadata');
  };
  const stubScenario = async (scenario) => {
    const response = await fetch(`${target.stubUrl}/__control`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario }),
    });
    assert.equal(response.status, 200);
  };
  const noDispatch = async (overrides, status, code) => {
    const before = (await providerCalls()).length;
    const response = await turn(overrides);
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.code ?? body.error, code);
    assert.equal((await providerCalls()).length, before, `${code} must not reach any provider`);
  };

  return { settings, turn, receipt, providerCalls, stubScenario, noDispatch };
}
