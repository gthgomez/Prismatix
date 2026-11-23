#!/usr/bin/env node
// Fail-closed environment isolation gate.
//
// A Vercel *preview* deployment must never be able to reach the production
// Supabase project. Historically it could: the preview bundle shipped the real
// production URL, router endpoint, and anon key. This script refuses to build
// such an artifact.
//
// It intentionally reads the value Vite will actually ship, not what the
// operator believes they set. Precedence measured on 2026-11-22:
//   process.env.VITE_*  >  .env.<mode>.local  >  .env.<mode>  >  .env
// so `loadEnv` is used to reproduce Vite's own resolution rather than reading
// process.env alone.

import { loadEnv } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The production project reference. Not a secret: it is already embedded in
// every published production bundle, and knowing it grants no access.
const PRODUCTION_REF = 'sqjfbqjogylkfwzsyprd';

const root = process.cwd();
const mode = process.env.NODE_ENV === 'development' ? 'development' : 'production';

// VERCEL_ENV is injected by Vercel: 'production' | 'preview' | 'development'.
// Absent locally and in plain CI.
const vercelEnv = process.env.VERCEL_ENV || '';
const isProductionTarget = vercelEnv === 'production';
const isNonProductionTarget = vercelEnv !== '' && !isProductionTarget;

const env = loadEnv(mode, root, 'VITE_');

function read(key) {
  // Mirror Vite's precedence: process.env wins, then the env files.
  return String(process.env[key] ?? env[key] ?? '').trim();
}

const supabaseUrl = read('VITE_SUPABASE_URL');
const routerEndpoint = read('VITE_ROUTER_ENDPOINT');
const anonKey = read('VITE_SUPABASE_ANON_KEY');

const errors = [];
const notes = [];

function hostOf(value) {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
}

// Derived exactly as src/backendConfig.ts derives it, so the guard cannot pass
// on a value the app would resolve differently.
const derivedFromRouter = routerEndpoint
  ? routerEndpoint.replace(/\/functions\/v1\/router$/, '')
  : '';
const effectiveUrl = supabaseUrl || derivedFromRouter;
const effectiveHost = hostOf(effectiveUrl);

const productionHost = `${PRODUCTION_REF}.supabase.co`;

// --- Rule 1: a non-production Vercel deployment may not target production ---
if (isNonProductionTarget) {
  if (effectiveHost === productionHost) {
    errors.push(
      `VERCEL_ENV=${vercelEnv} resolves VITE_SUPABASE_URL to the production project ` +
        `(${productionHost}). Previews must point at a nonproduction Supabase project.`
    );
  }
  if (hostOf(routerEndpoint) === productionHost) {
    errors.push(
      `VERCEL_ENV=${vercelEnv} resolves VITE_ROUTER_ENDPOINT to the production project ` +
        `(${productionHost}). Previews must not call the production router.`
    );
  }
}

// --- Rule 2: a deployed build must be fully configured (no silent fallback) ---
if (vercelEnv !== '') {
  for (const [key, value] of [
    ['VITE_SUPABASE_URL', effectiveUrl],
    ['VITE_SUPABASE_ANON_KEY', anonKey],
  ]) {
    if (!value) {
      errors.push(
        `VERCEL_ENV=${vercelEnv} is set but ${key} is empty. A deployed build must not ` +
          `fall back to a synthetic backend.`
      );
    }
  }
  if (effectiveUrl && !/^https?:\/\//i.test(effectiveUrl)) {
    errors.push(`Resolved VITE_SUPABASE_URL is not an http(s) URL: ${effectiveUrl}`);
  }
}

// --- Rule 3: the router must live on the same project as the database ---
if (routerEndpoint && effectiveHost && hostOf(routerEndpoint) !== effectiveHost) {
  errors.push(
    `VITE_ROUTER_ENDPOINT host (${hostOf(routerEndpoint)}) does not match the resolved ` +
      `Supabase host (${effectiveHost}). The app would silently ignore the configured router.`
  );
}

// --- Reporting ---
notes.push(`mode=${mode}`);
notes.push(`VERCEL_ENV=${vercelEnv || '(unset)'}`);
notes.push(`resolved host=${effectiveHost || '(empty)'}`);
notes.push(`production ref=${productionHost}`);

if (errors.length === 0) {
  console.log('environment-isolation: OK');
  for (const n of notes) console.log(`  ${n}`);
  if (isNonProductionTarget) {
    console.log(`  nonproduction target differs from production: OK`);
  }
  process.exit(0);
}

console.error('environment-isolation: FAILED');
for (const n of notes) console.error(`  ${n}`);
console.error('');
for (const e of errors) console.error(`  ✗ ${e}`);
console.error('');
console.error('Refusing to build. Fix the environment variables for this deployment.');
process.exit(1);
