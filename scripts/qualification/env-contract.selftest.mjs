#!/usr/bin/env node
// Negative controls for the qualification environment contract.
//
// Proves that unsafe targets are rejected BEFORE any script can issue a
// state-changing request, and that the authorization is identity-based rather
// than a user-supplied boolean.

import assert from 'node:assert/strict';
import {
  PRODUCTION_HOST,
  redactSecrets,
  resolveQualificationEnvironment,
} from './env-contract.mjs';

const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

const STAGING_REF = 'abcdefghijklmnopqrst';

test('accepts the default loopback stack', () => {
  const target = resolveQualificationEnvironment({ SUPABASE_ANON_KEY: 'local-anon' });
  assert.equal(target.kind, 'local');
  assert.equal(target.environment, 'local');
  assert.equal(target.supabaseHostname, '127.0.0.1');
});

test('rejects the production host unconditionally', () => {
  assert.throws(
    () => resolveQualificationEnvironment({
      SUPABASE_URL: `https://${PRODUCTION_HOST}`,
      SUPABASE_ANON_KEY: 'x',
    }),
    /production project/,
  );
});

test('rejects a production subdomain', () => {
  assert.throws(
    () => resolveQualificationEnvironment({
      SUPABASE_URL: `https://evil.${PRODUCTION_HOST}`,
      SUPABASE_ANON_KEY: 'x',
    }),
    /production project/,
  );
});

test('rejects a hosted target without an allowlist (old boolean override does nothing)', () => {
  assert.throws(
    () => resolveQualificationEnvironment({
      SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
      SUPABASE_ANON_KEY: 'x',
      ALLOW_NONLOCAL_QUALIFICATION: '1',
    }),
    /not in QUALIFICATION_ALLOWED_PROJECT_REFS/,
  );
});

test('rejects production even when allowlisted', () => {
  assert.throws(
    () => resolveQualificationEnvironment({
      SUPABASE_URL: `https://${PRODUCTION_HOST}`,
      SUPABASE_ANON_KEY: 'x',
      QUALIFICATION_ALLOWED_PROJECT_REFS: PRODUCTION_HOST.split('.')[0],
      QUALIFICATION_ENVIRONMENT: 'staging',
    }),
    /production project/,
  );
});

test('rejects an allowlisted host without an explicit environment identity', () => {
  assert.throws(
    () => resolveQualificationEnvironment({
      SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
      SUPABASE_ANON_KEY: 'x',
      QUALIFICATION_ALLOWED_PROJECT_REFS: STAGING_REF,
    }),
    /requires QUALIFICATION_ENVIRONMENT/,
  );
});

test('rejects a nonproduction environment name of "production"', () => {
  assert.throws(
    () => resolveQualificationEnvironment({
      SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
      SUPABASE_ANON_KEY: 'x',
      QUALIFICATION_ALLOWED_PROJECT_REFS: STAGING_REF,
      QUALIFICATION_ENVIRONMENT: 'production',
    }),
    /QUALIFICATION_ENVIRONMENT must be/,
  );
});

test('accepts an allowlisted staging identity over https', () => {
  const target = resolveQualificationEnvironment({
    SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
    SUPABASE_ANON_KEY: 'x',
    QUALIFICATION_ALLOWED_PROJECT_REFS: STAGING_REF,
    QUALIFICATION_ENVIRONMENT: 'staging',
  });
  assert.equal(target.kind, 'hosted');
  assert.equal(target.projectRef, STAGING_REF);
});

test('rejects plain http for a hosted identity', () => {
  assert.throws(
    () => resolveQualificationEnvironment({
      SUPABASE_URL: `http://${STAGING_REF}.supabase.co`,
      SUPABASE_ANON_KEY: 'x',
      QUALIFICATION_ALLOWED_PROJECT_REFS: STAGING_REF,
      QUALIFICATION_ENVIRONMENT: 'staging',
    }),
    /must use https/,
  );
});

test('rejects malformed URLs instead of falling back', () => {
  assert.throws(
    () => resolveQualificationEnvironment({ SUPABASE_URL: 'not a url', SUPABASE_ANON_KEY: 'x' }),
    /not a valid URL/,
  );
});

test('rejects embedded credentials', () => {
  assert.throws(
    () => resolveQualificationEnvironment({
      SUPABASE_URL: 'http://user:pass@127.0.0.1:54321',
      SUPABASE_ANON_KEY: 'x',
    }),
    /must not embed credentials/,
  );
});

test('rejects a router endpoint on a different project', () => {
  assert.throws(
    () => resolveQualificationEnvironment({
      SUPABASE_ANON_KEY: 'x',
      SUPABASE_ROUTER_URL: 'https://some-other-project.example/functions/v1/router',
    }),
    /does not match the Supabase host/,
  );
});

test('rejects a non-loopback stub provider by default', () => {
  assert.throws(
    () => resolveQualificationEnvironment({
      SUPABASE_ANON_KEY: 'x',
      STUB_URL: 'http://10.0.0.9:8899',
    }),
    /QUALIFICATION_ALLOWED_STUB_HOSTS/,
  );
});

test('redacts credentials from diagnostics', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart';
  const redacted = redactSecrets(`apikey=${jwt} authorization: Bearer ${jwt}`);
  assert.ok(!redacted.includes(jwt));
  assert.match(redacted, /<redacted/);
});

let failed = 0;
for (const { name, fn } of cases) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(`     ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed > 0) {
  console.error(`\nqualification env-contract self-test failed: ${failed}/${cases.length}`);
  process.exit(1);
}
console.log(`\nqualification env-contract self-test: ${cases.length}/${cases.length} passed`);
