// tests/deployment/check-deployment-parity.test.ts
// PX00 deployment-parity checker contract tests.
//
// These tests pin the behavior of scripts/check-deployment-parity.mjs:
//   - expected vs observed function inventory (all six deployed slugs),
//   - migration applied-set parity,
//   - schema column anchors,
//   - frontend build identity (never "verified" when unknown),
//   - secret detection in observed artifacts,
//   - CLI exit codes.
// They also keep docs/engineering/deployment-manifest.md in sync with the
// machine baseline fixtures used here, and prove the public manifest stays
// sanitized (no secret-shaped values).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// The parity checker is a dependency-free Node ESM script and deliberately
// ships no .d.mts declarations (the PX00 packet adds no files beyond the
// manifest, the script, and this test); its exported contract is pinned by
// the assertions in this file.
// @ts-expect-error -- no type declarations for the .mjs checker script; typed below
import { checkDeploymentParity as untypedCheck } from '../../scripts/check-deployment-parity.mjs';

type Severity = 'error' | 'warn' | 'info';

interface Finding {
  code: string;
  severity: Severity;
  message: string;
}

interface ParityResult {
  ok: boolean;
  findings: Finding[];
}

type ParityInput = Record<string, unknown> | null | undefined;

const checkDeploymentParity = untypedCheck as unknown as (
  expected: ParityInput,
  observed: ParityInput,
) => ParityResult;

// ============================================================================
// BASELINE FIXTURES — mirror docs/engineering/deployment-manifest.md
// ============================================================================

type BaselineFunction = {
  slug: string;
  status?: string;
  version?: number | null;
  verify_jwt?: boolean | null;
  bundle_sha256?: string | null;
  notes?: string;
};

type Baseline = {
  release: { audited_main_sha: string };
  frontend: { provider: string; build_sha: string | null };
  api: { project_name: string; project_ref: string; endpoint_base: string };
  functions: BaselineFunction[];
  migrations: { applied: string[] };
  schema: { columns: Record<string, string[]> };
};

const AUDITED_MAIN_SHA = '41d9b9e7d2f97867d78077e605294b6e49f4b2e0';
const ROUTER_BUNDLE_SHA256 = '2e2865a3843fb3ad4d0f8e872a7a8c176c90a1fa5121284fdf1eda320709d3bf';
const VIDEO_WORKER_BUNDLE_SHA256 = '88dbce8cb4dd582f1a2486dafc7a3e0fc671ea43e3c3f9b58bcb71c852b89fbc';
const API_ENDPOINT_BASE = 'https://sqjfbqjogylkfwzsyprd.supabase.co';
const KNOWN_FRONTEND_SHA = '1111222233334444aaaabbbbccccddddeeeeffff';

// Six deployed slugs. The repo has only five function directories; the sixth
// slug (spend-stats) is the legacy hyphenated duplicate.
const DEPLOYED_SLUGS = [
  'router',
  'spend_stats',
  'spend-stats',
  'video-intake',
  'video-status',
  'video-worker',
];

// Migrations applied on the deployed database (June 2026 audit). The repo also
// contains 20260601000000_add_cost_log_idempotency.sql, which is NOT applied.
const APPLIED_MIGRATIONS = [
  '20260210000000',
  '20260211070000',
  '20260212090000',
  '20260216100000',
  '20260216103000',
  '20260219100000',
  '20260308000000',
  '20260410000000',
  '20260519000000',
];

const PENDING_REPO_MIGRATION = '20260601000000_add_cost_log_idempotency.sql';

// Schema anchors derived only from applied migrations (the pending
// idempotency migration's column is deliberately not an anchor yet).
const COST_LOGS_COLUMNS = [
  'id', 'user_id', 'conversation_id', 'model', 'provider',
  'input_tokens', 'output_tokens', 'thinking_tokens',
  'input_cost', 'output_cost', 'thinking_cost', 'total_cost',
  'pricing_version', 'complexity_score', 'route_rationale', 'created_at',
];

const VIDEO_ASSETS_COLUMNS = [
  'id', 'user_id', 'conversation_id', 'storage_bucket', 'storage_path',
  'mime_type', 'file_size_bytes', 'duration_ms', 'width', 'height', 'status',
  'checksum_sha256', 'error_code', 'error_message', 'metadata',
  'created_at', 'updated_at',
];

function buildExpectedBaseline(): Baseline {
  return {
    release: { audited_main_sha: AUDITED_MAIN_SHA },
    frontend: { provider: 'vercel', build_sha: null },
    api: {
      project_name: 'Prismatix Router',
      project_ref: 'sqjfbqjogylkfwzsyprd',
      endpoint_base: API_ENDPOINT_BASE,
    },
    functions: [
      { slug: 'router', status: 'deployed', version: 53, verify_jwt: true, bundle_sha256: ROUTER_BUNDLE_SHA256 },
      { slug: 'spend_stats', status: 'deployed', version: 5, verify_jwt: false, bundle_sha256: null, notes: 'manual Bearer auth in-function' },
      { slug: 'spend-stats', status: 'deployed', version: null, verify_jwt: null, bundle_sha256: null, notes: 'legacy hyphenated duplicate; no repo directory' },
      { slug: 'video-intake', status: 'deployed', version: null, verify_jwt: null, bundle_sha256: null },
      { slug: 'video-status', status: 'deployed', version: null, verify_jwt: null, bundle_sha256: null },
      { slug: 'video-worker', status: 'deployed', version: 4, verify_jwt: false, bundle_sha256: VIDEO_WORKER_BUNDLE_SHA256 },
    ],
    migrations: { applied: [...APPLIED_MIGRATIONS] },
    schema: {
      columns: {
        cost_logs: [...COST_LOGS_COLUMNS],
        video_assets: [...VIDEO_ASSETS_COLUMNS],
      },
    },
  };
}

function buildObservedBaseline(): Baseline {
  // Observed capture matches the audited deployed state (fixture basis only).
  return JSON.parse(JSON.stringify(buildExpectedBaseline())) as Baseline;
}

// ============================================================================
// IMMUTABLE FIXTURE HELPERS
// ============================================================================

function withFrontendBuildSha(baseline: Baseline, sha: string | null): Baseline {
  return { ...baseline, frontend: { ...baseline.frontend, build_sha: sha } };
}

function withoutSlug(baseline: Baseline, slug: string): Baseline {
  return { ...baseline, functions: baseline.functions.filter((f) => f.slug !== slug) };
}

function withExtraSlug(baseline: Baseline, slug: string): Baseline {
  return {
    ...baseline,
    functions: [
      ...baseline.functions,
      { slug, status: 'deployed', version: null, verify_jwt: null, bundle_sha256: null },
    ],
  };
}

function withSlugBundleSha(baseline: Baseline, slug: string, sha: string | null): Baseline {
  return {
    ...baseline,
    functions: baseline.functions.map((f) => (f.slug === slug ? { ...f, bundle_sha256: sha } : f)),
  };
}

function withoutMigration(baseline: Baseline, migration: string): Baseline {
  return {
    ...baseline,
    migrations: { applied: baseline.migrations.applied.filter((m) => m !== migration) },
  };
}

function withoutColumn(baseline: Baseline, table: string, column: string): Baseline {
  const columns = baseline.schema.columns;
  return {
    ...baseline,
    schema: { columns: { ...columns, [table]: (columns[table] ?? []).filter((c) => c !== column) } },
  };
}

// ============================================================================
// FINDING HELPERS + PATHS
// ============================================================================

function codesOf(result: ParityResult): string[] {
  return result.findings.map((f) => f.code);
}

function findingsBy(result: ParityResult, code: string): Finding[] {
  return result.findings.filter((f) => f.code === code);
}

// NOTE: import.meta.url is assigned to a variable first because Vite's
// transform rewrites the literal `new URL(..., import.meta.url)` pattern and
// resolves it against jsdom's http://localhost:3000 base in this environment.
const MODULE_URL = import.meta.url;
const MANIFEST_PATH = fileURLToPath(new URL('../../docs/engineering/deployment-manifest.md', MODULE_URL));
const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/check-deployment-parity.mjs', MODULE_URL));

// The same secret shapes the checker enforces on observed artifacts; used
// here to prove the public manifest itself stays sanitized.
const SECRET_SCAN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'sk- style API key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: 'GitHub token', pattern: /\b(?:gh[opusr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})/ },
  { name: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { name: 'service role reference', pattern: /service_role/i },
  {
    name: 'provider key env name',
    pattern: /\b(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_API_KEY|NVIDIA_API_KEY|DEEPINFRA_API_KEY|OPENCODE_API_KEY|SUPABASE_SERVICE_ROLE_KEY)\b/,
  },
];

// ============================================================================
// EXPECTED BASELINE FIXTURE
// ============================================================================

describe('expected baseline fixture', () => {
  it('accounts for all six deployed slugs, including the legacy spend-stats duplicate', () => {
    const expected = buildExpectedBaseline();
    expect(expected.functions.map((f) => f.slug)).toEqual(DEPLOYED_SLUGS);
    expect(new Set(expected.functions.map((f) => f.slug)).size).toBe(6);
  });

  it('mirrors the deployment manifest (slugs, SHAs, endpoint, pending migration)', () => {
    const manifest = readFileSync(MANIFEST_PATH, 'utf-8');
    for (const slug of DEPLOYED_SLUGS) {
      expect(manifest, `manifest must document slug "${slug}"`).toContain(slug);
    }
    expect(manifest).toContain(AUDITED_MAIN_SHA);
    expect(manifest).toContain(ROUTER_BUNDLE_SHA256);
    expect(manifest).toContain(VIDEO_WORKER_BUNDLE_SHA256);
    expect(manifest).toContain(API_ENDPOINT_BASE);
    expect(manifest).toContain(PENDING_REPO_MIGRATION);
  });

  it('does not require the pending repo migration in the expected applied set', () => {
    const expected = buildExpectedBaseline();
    expect(expected.migrations.applied).not.toContain('20260601000000');
    const result = checkDeploymentParity(expected, buildObservedBaseline());
    expect(codesOf(result)).not.toContain('MISSING_MIGRATION');
  });
});

describe('manifest sanitization', () => {
  it('contains no secret-shaped values (public artifact)', () => {
    const manifest = readFileSync(MANIFEST_PATH, 'utf-8');
    for (const { name, pattern } of SECRET_SCAN_PATTERNS) {
      expect(pattern.test(manifest), `manifest matched secret pattern "${name}"`).toBe(false);
    }
  });
});

// ============================================================================
// PARITY — MATCHING DEPLOYMENT
// ============================================================================

describe('checkDeploymentParity — matching deployment', () => {
  it('reports parity (ok=true, no error findings) when observed matches expected', () => {
    const result = checkDeploymentParity(buildExpectedBaseline(), buildObservedBaseline());
    expect(result.ok).toBe(true);
    expect(result.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(codesOf(result)).not.toContain('SECRET_DETECTED');
  });
});

// ============================================================================
// PARITY — FRONTEND BUILD IDENTITY
// ============================================================================

describe('checkDeploymentParity — frontend build identity', () => {
  it('rejects a deliberately stale frontend fixture (STALE_FRONTEND, ok=false)', () => {
    const expected = withFrontendBuildSha(buildExpectedBaseline(), KNOWN_FRONTEND_SHA);
    const observed = withFrontendBuildSha(buildObservedBaseline(), 'ffff0000ffff0000ffff0000ffff0000ffff0000');
    const result = checkDeploymentParity(expected, observed);
    expect(result.ok).toBe(false);
    const stale = findingsBy(result, 'STALE_FRONTEND');
    expect(stale).toHaveLength(1);
    expect(stale[0]!.severity).toBe('error');
  });

  it('reports no frontend finding when both build SHAs are known and equal', () => {
    const expected = withFrontendBuildSha(buildExpectedBaseline(), KNOWN_FRONTEND_SHA);
    const observed = withFrontendBuildSha(buildObservedBaseline(), KNOWN_FRONTEND_SHA);
    const result = checkDeploymentParity(expected, observed);
    expect(result.ok).toBe(true);
    expect(codesOf(result)).not.toContain('STALE_FRONTEND');
    expect(codesOf(result)).not.toContain('UNKNOWN_FRONTEND');
  });

  it('yields UNKNOWN_FRONTEND (info) and never reports an unknown identity as verified', () => {
    const bothUnknown = checkDeploymentParity(buildExpectedBaseline(), buildObservedBaseline());
    const observedUnknown = checkDeploymentParity(
      withFrontendBuildSha(buildExpectedBaseline(), KNOWN_FRONTEND_SHA),
      buildObservedBaseline(),
    );
    const expectedUnknown = checkDeploymentParity(
      buildExpectedBaseline(),
      withFrontendBuildSha(buildObservedBaseline(), KNOWN_FRONTEND_SHA),
    );

    for (const result of [bothUnknown, observedUnknown, expectedUnknown]) {
      expect(codesOf(result)).toContain('UNKNOWN_FRONTEND');
      expect(codesOf(result)).not.toContain('STALE_FRONTEND');
      expect(result.ok).toBe(true); // info severity must never block parity
      for (const finding of findingsBy(result, 'UNKNOWN_FRONTEND')) {
        expect(finding.severity).toBe('info');
        expect(finding.message).toMatch(/unverified/i);
      }
    }
  });
});

// ============================================================================
// PARITY — FUNCTION INVENTORY
// ============================================================================

describe('checkDeploymentParity — function inventory', () => {
  it('flags an expected slug missing from the observed deployment (MISSING_FUNCTION, error)', () => {
    const observed = withoutSlug(buildObservedBaseline(), 'router');
    const result = checkDeploymentParity(buildExpectedBaseline(), observed);
    expect(result.ok).toBe(false);
    const missing = findingsBy(result, 'MISSING_FUNCTION');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.severity).toBe('error');
    expect(missing[0]!.message).toContain('router');
  });

  it('flags an observed slug outside the baseline (EXTRA_FUNCTION, warn only)', () => {
    const observed = withExtraSlug(buildObservedBaseline(), 'rogue-relay');
    const result = checkDeploymentParity(buildExpectedBaseline(), observed);
    const extra = findingsBy(result, 'EXTRA_FUNCTION');
    expect(extra).toHaveLength(1);
    expect(extra[0]!.severity).toBe('warn');
    expect(result.ok).toBe(true); // warnings alone do not fail parity
  });

  it('flags a drifted router bundle hash (BUNDLE_HASH_MISMATCH, error)', () => {
    const observed = withSlugBundleSha(buildObservedBaseline(), 'router', '0'.repeat(64));
    const result = checkDeploymentParity(buildExpectedBaseline(), observed);
    expect(result.ok).toBe(false);
    const mismatch = findingsBy(result, 'BUNDLE_HASH_MISMATCH');
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]!.severity).toBe('error');
    expect(mismatch[0]!.message).toContain(ROUTER_BUNDLE_SHA256);
  });

  it('does not claim a hash mismatch when the observed hash is unknown', () => {
    const observed = withSlugBundleSha(buildObservedBaseline(), 'router', null);
    const result = checkDeploymentParity(buildExpectedBaseline(), observed);
    expect(codesOf(result)).not.toContain('BUNDLE_HASH_MISMATCH');
    expect(result.ok).toBe(true);
  });
});

// ============================================================================
// PARITY — MIGRATIONS AND SCHEMA
// ============================================================================

describe('checkDeploymentParity — migrations and schema', () => {
  it('flags an applied migration missing from the observed set (MISSING_MIGRATION, error)', () => {
    const observed = withoutMigration(buildObservedBaseline(), '20260519000000');
    const result = checkDeploymentParity(buildExpectedBaseline(), observed);
    expect(result.ok).toBe(false);
    const missing = findingsBy(result, 'MISSING_MIGRATION');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.severity).toBe('error');
    expect(missing[0]!.message).toContain('20260519000000');
  });

  it('detects a missing database column (MISSING_COLUMN, error)', () => {
    const observed = withoutColumn(buildObservedBaseline(), 'cost_logs', 'complexity_score');
    const result = checkDeploymentParity(buildExpectedBaseline(), observed);
    expect(result.ok).toBe(false);
    const missing = findingsBy(result, 'MISSING_COLUMN');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.severity).toBe('error');
    expect(missing[0]!.message).toContain('cost_logs.complexity_score');
  });

  it('detects a missing column on the second anchor table', () => {
    const observed = withoutColumn(buildObservedBaseline(), 'video_assets', 'metadata');
    const result = checkDeploymentParity(buildExpectedBaseline(), observed);
    const missing = findingsBy(result, 'MISSING_COLUMN');
    expect(missing).toHaveLength(1);
    expect(missing[0]!.message).toContain('video_assets.metadata');
  });
});

// ============================================================================
// PARITY — SECRET DETECTION
// ============================================================================

describe('checkDeploymentParity — secret detection', () => {
  const SECRET_FIXTURES: Array<{ name: string; value: string }> = [
    { name: 'sk- style API key', value: 'sk-AbCdEf1234567890AbCd' },
    { name: 'GitHub OAuth token', value: 'gho_16AbCdEf1234567890AbCdEf12' },
    { name: 'GitHub PAT', value: 'github_pat_11AbCdEf1234567890AbCdEf12' },
    {
      name: 'JWT',
      value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    },
    { name: 'service role reference', value: 'service_role' },
    { name: 'provider key env name', value: 'OPENCODE_API_KEY' },
  ];

  it('does not false-positive on the sanitized baseline', () => {
    const result = checkDeploymentParity(buildExpectedBaseline(), buildObservedBaseline());
    expect(codesOf(result)).not.toContain('SECRET_DETECTED');
    expect(result.ok).toBe(true);
  });

  it.each(SECRET_FIXTURES)(
    'flags a leaked $name in the observed artifact (SECRET_DETECTED, error)',
    ({ name, value }) => {
      const observed: Record<string, unknown> = {
        ...buildObservedBaseline(),
        captured_env: { value },
      };
      const result = checkDeploymentParity(buildExpectedBaseline(), observed);
      expect(result.ok).toBe(false);
      const detected = findingsBy(result, 'SECRET_DETECTED');
      expect(detected.length, `secret fixture "${name}" must be detected`).toBeGreaterThanOrEqual(1);
      expect(detected[0]!.severity).toBe('error');
      expect(detected[0]!.message).toContain('$.captured_env.value');
      // The finding must point at the leak without echoing the secret value.
      expect(detected[0]!.message).not.toContain(value);
    },
  );
});

// ============================================================================
// CLI
// ============================================================================

describe('check-deployment-parity CLI', () => {
  let workDir: string | undefined;

  afterEach(() => {
    if (workDir) {
      rmSync(workDir, { recursive: true, force: true });
      workDir = undefined;
    }
  });

  function writeFixtures(expected: unknown, observed: unknown): [string, string] {
    workDir = mkdtempSync(join(tmpdir(), 'prismatix-parity-'));
    const expectedPath = join(workDir, 'expected.json');
    const observedPath = join(workDir, 'observed.json');
    writeFileSync(expectedPath, `${JSON.stringify(expected, null, 2)}\n`);
    writeFileSync(observedPath, `${JSON.stringify(observed, null, 2)}\n`);
    return [expectedPath, observedPath];
  }

  it('exits 0 and prints the summary when the deployment matches the baseline', () => {
    const [expectedPath, observedPath] = writeFixtures(buildExpectedBaseline(), buildObservedBaseline());
    const run = spawnSync(process.execPath, [SCRIPT_PATH, expectedPath, observedPath], { encoding: 'utf-8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('deployment parity: OK');
    expect(run.stdout).toContain('UNKNOWN_FRONTEND');
  });

  it('exits non-zero and prints findings when the fixture is stale', () => {
    const expected = withFrontendBuildSha(buildExpectedBaseline(), KNOWN_FRONTEND_SHA);
    const observed = withoutSlug(
      withFrontendBuildSha(buildObservedBaseline(), 'ffff0000ffff0000ffff0000ffff0000ffff0000'),
      'router',
    );
    const [expectedPath, observedPath] = writeFixtures(expected, observed);
    const run = spawnSync(process.execPath, [SCRIPT_PATH, expectedPath, observedPath], { encoding: 'utf-8' });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('deployment parity: FAIL');
    expect(run.stdout).toContain('STALE_FRONTEND');
    expect(run.stdout).toContain('MISSING_FUNCTION');
  });

  it('exits 2 with usage output when arguments are missing', () => {
    const run = spawnSync(process.execPath, [SCRIPT_PATH], { encoding: 'utf-8' });
    expect(run.status).toBe(2);
    expect(`${run.stdout ?? ''}${run.stderr ?? ''}`).toContain('Usage');
  });
});
