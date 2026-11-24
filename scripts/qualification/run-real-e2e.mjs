#!/usr/bin/env node
// Builds the app against the local Supabase stack and runs the real-backend
// Playwright journeys (no route mocks, deterministic provider stub).
//
// Required environment:
//   SUPABASE_URL              e.g. http://127.0.0.1:54321
//   SUPABASE_ANON_KEY         local anon key from `supabase status -o env`
// Optional:
//   STUB_URL                  default http://127.0.0.1:8899
//   PLAYWRIGHT_PORT           default 4174
//
// Safety: refuses a non-local SUPABASE_URL unless ALLOW_NONLOCAL_QUALIFICATION=1.
// Never run this against production: it seeds and writes disposable data.

import { spawnSync } from 'node:child_process';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

function isLocal(url) {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

if (!ANON_KEY) {
  console.error('run-real-e2e: SUPABASE_ANON_KEY is required (supabase status -o env)');
  process.exit(1);
}
if (!isLocal(SUPABASE_URL) && process.env.ALLOW_NONLOCAL_QUALIFICATION !== '1') {
  console.error(`run-real-e2e: refusing non-local SUPABASE_URL ${SUPABASE_URL}`);
  process.exit(1);
}

function run(command, args, env) {
  console.log(`\n[run-real-e2e] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const buildEnv = {
  NODE_ENV: 'production',
  VITE_SUPABASE_URL: SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: ANON_KEY,
  VITE_ALLOW_SIGNUP: 'true',
  VITE_ENABLE_VIDEO_PIPELINE: 'false',
  VITE_PX08_COMPARE_DURABILITY: process.env.VITE_PX08_COMPARE_DURABILITY ?? 'false',
};

run('npm', ['run', 'build'], buildEnv);
run('npx', ['playwright', 'test', '--config=playwright.real.config.ts', ...process.argv.slice(2)], {
  ...buildEnv,
  PLAYWRIGHT_PORT: process.env.PLAYWRIGHT_PORT ?? '4174',
  STUB_URL: process.env.STUB_URL ?? 'http://127.0.0.1:8899',
});
