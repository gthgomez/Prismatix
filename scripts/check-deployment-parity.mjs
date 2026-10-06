#!/usr/bin/env node
// scripts/check-deployment-parity.mjs — PX00 deployment-parity checker.
//
// Compares an EXPECTED deployment baseline (codified from
// docs/engineering/deployment-manifest.md) against an OBSERVED deployment
// capture and reports drift as findings. Dependency-free Node ESM (Node
// builtins only). Read-only by design: it never fetches anything, never
// deploys, never mutates external state, and never prints secret values.
//
// CLI:
//   node scripts/check-deployment-parity.mjs <expected.json> <observed.json>
//   npm run check:parity -- <expected.json> <observed.json>
//
// Exit codes:
//   0 — parity holds (warnings and info findings allowed)
//   1 — parity FAIL (at least one error-severity finding)
//   2 — usage or input error
//
// API:
//   checkDeploymentParity(expected, observed) -> { ok, findings }
//     ok       boolean — false when any finding has severity "error".
//     findings Array<{ code, severity, message }>
//               severity: 'error' | 'warn' | 'info'
//
// JSON contract (both inputs share the same shape; unknown/unverifiable
// values MUST be recorded as null, never guessed):
//   {
//     "release":    { "audited_main_sha": "..." },          // informational
//     "frontend":   { "provider": "vercel", "build_sha": "<sha>" | null },
//     "api":        { "project_name": "...", "project_ref": "...", "endpoint_base": "..." },
//     "functions":  [ { "slug": "...", "bundle_sha256": "<sha256>" | null, ... } ],
//     "migrations": { "applied": ["20260210000000", ...] },
//     "schema":     { "columns": { "cost_logs": ["id", ...], ... } },
//   }
//
// Findings (code / severity / meaning):
//   MISSING_FUNCTION      error  expected function slug absent from observed
//   EXTRA_FUNCTION        warn   observed slug is not in the expected baseline
//   BUNDLE_HASH_MISMATCH  error  slug present but bundle sha256 differs (only when both are known)
//   MISSING_MIGRATION     error  expected applied migration absent from observed applied set
//   MISSING_COLUMN        error  expected schema column absent from observed schema
//   STALE_FRONTEND        error  observed frontend build SHA differs from a known expected SHA
//   UNKNOWN_FRONTEND      info   frontend identity unknown — never reported as verified
//   SECRET_DETECTED       error  observed artifact contains a secret-shaped value
//
// Contract tests: tests/deployment/check-deployment-parity.test.ts.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ============================================================================
// SECRET SHAPES — scanned against the OBSERVED artifact only
// ============================================================================

const SECRET_PATTERNS = [
  { name: 'OpenAI-style API key (sk-...)', pattern: /\bsk-[A-Za-z0-9_-]{16,}/ },
  {
    name: 'GitHub token (gh*_.../github_pat_...)',
    pattern: /\b(?:gh[opusr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})/,
  },
  {
    name: 'JWT (eyJ...)',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  },
  { name: 'service-role token reference', pattern: /service_role/i },
  {
    name: 'provider key env name',
    pattern: /\b(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_API_KEY|NVIDIA_API_KEY|DEEPINFRA_API_KEY|OPENCODE_API_KEY|SUPABASE_SERVICE_ROLE_KEY)\b/,
  },
];

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Compare an expected deployment baseline against an observed capture.
 *
 * @param {Record<string, unknown>} expected codified baseline (see header)
 * @param {Record<string, unknown>} observed fresh read-only capture
 * @returns {{ ok: boolean, findings: Array<{ code: string, severity: 'error' | 'warn' | 'info', message: string }> }}
 */
export function checkDeploymentParity(expected, observed) {
  const expectedInput = asRecord(expected, 'expected');
  const observedInput = asRecord(observed, 'observed');

  const findings = [];
  compareFunctions(expectedInput, observedInput, findings);
  compareMigrations(expectedInput, observedInput, findings);
  compareSchema(expectedInput, observedInput, findings);
  compareFrontend(expectedInput, observedInput, findings);
  scanForSecrets(observedInput, '$', findings);

  const ok = !findings.some((finding) => finding.severity === 'error');
  return { ok, findings };
}

// ============================================================================
// SECTION COMPARISONS
// ============================================================================

function compareFunctions(expected, observed, findings) {
  const expectedFunctions = functionEntries(expected.functions);
  const observedFunctions = functionEntries(observed.functions);
  const observedBySlug = new Map(observedFunctions.map((fn) => [fn.slug, fn]));

  for (const fn of expectedFunctions) {
    const deployed = observedBySlug.get(fn.slug);
    if (!deployed) {
      findings.push({
        code: 'MISSING_FUNCTION',
        severity: 'error',
        message: `Expected function "${fn.slug}" is absent from the observed deployment.`,
      });
      continue;
    }
    const expectedHash = normalizeHash(fn.bundle_sha256);
    const observedHash = normalizeHash(deployed.bundle_sha256);
    // Only a mismatch of two KNOWN hashes is drift; an unknown hash on
    // either side is an observation gap, not a bundle change.
    if (expectedHash && observedHash && expectedHash !== observedHash) {
      findings.push({
        code: 'BUNDLE_HASH_MISMATCH',
        severity: 'error',
        message: `Function "${fn.slug}" bundle sha256 mismatch: expected ${expectedHash}, observed ${observedHash}.`,
      });
    }
  }

  const expectedSlugs = new Set(expectedFunctions.map((fn) => fn.slug));
  for (const fn of observedFunctions) {
    if (!expectedSlugs.has(fn.slug)) {
      findings.push({
        code: 'EXTRA_FUNCTION',
        severity: 'warn',
        message: `Observed function "${fn.slug}" is not part of the expected deployment baseline.`,
      });
    }
  }
}

function compareMigrations(expected, observed, findings) {
  const expectedApplied = stringList(expected?.migrations?.applied);
  const observedApplied = new Set(stringList(observed?.migrations?.applied));
  for (const migration of expectedApplied) {
    if (!observedApplied.has(migration)) {
      findings.push({
        code: 'MISSING_MIGRATION',
        severity: 'error',
        message: `Expected applied migration "${migration}" is absent from the observed applied set.`,
      });
    }
  }
}

function compareSchema(expected, observed, findings) {
  const expectedColumns = columnMap(expected?.schema?.columns);
  const observedColumns = columnMap(observed?.schema?.columns);
  for (const [table, columns] of expectedColumns) {
    const observedTableColumns = observedColumns.get(table) ?? new Set();
    for (const column of columns) {
      if (!observedTableColumns.has(column)) {
        findings.push({
          code: 'MISSING_COLUMN',
          severity: 'error',
          message: `Expected schema column "${table}.${column}" is absent from the observed schema.`,
        });
      }
    }
  }
}

function compareFrontend(expected, observed, findings) {
  const expectedSha = normalizeHash(expected?.frontend?.build_sha);
  const observedSha = normalizeHash(observed?.frontend?.build_sha);
  if (!expectedSha || !observedSha) {
    const unknownSides = [];
    if (!expectedSha) unknownSides.push('expected');
    if (!observedSha) unknownSides.push('observed');
    findings.push({
      code: 'UNKNOWN_FRONTEND',
      severity: 'info',
      message:
        `Frontend build identity is unknown (${unknownSides.join(' and ')} build_sha not known); ` +
        'the deployment is treated as UNVERIFIED and must never be reported as verified.',
    });
    return;
  }
  if (expectedSha !== observedSha) {
    findings.push({
      code: 'STALE_FRONTEND',
      severity: 'error',
      message: `Observed frontend build ${observedSha} is stale: expected ${expectedSha}.`,
    });
  }
}

// ============================================================================
// SECRET SCAN (observed artifact only)
// ============================================================================

function scanForSecrets(value, path, findings) {
  if (typeof value === 'string') {
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(value)) {
        // Never include the matched value itself in the finding.
        findings.push({
          code: 'SECRET_DETECTED',
          severity: 'error',
          message:
            `Observed artifact contains a possible secret at "${path}" (matched: ${name}). ` +
            'Do not store, print, or commit secret values; redact and re-capture the observation.',
        });
        return;
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForSecrets(item, `${path}[${index}]`, findings));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      scanForSecrets(child, `${path}.${key}`, findings);
    }
  }
}

// ============================================================================
// INPUT NORMALIZATION
// ============================================================================

function asRecord(value, name) {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      `"${name}" must be a deployment-parity JSON object (got ${Array.isArray(value) ? 'array' : typeof value})`,
    );
  }
  return value;
}

function functionEntries(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry) => entry && typeof entry === 'object' && typeof entry.slug === 'string' && entry.slug.length > 0,
  );
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.length > 0);
}

function columnMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map();
  const map = new Map();
  for (const [table, columns] of Object.entries(value)) {
    if (!Array.isArray(columns)) continue;
    map.set(table, new Set(columns.filter((column) => typeof column === 'string' && column.length > 0)));
  }
  return map;
}

function normalizeHash(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

// ============================================================================
// CLI
// ============================================================================

function loadJson(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`cannot read ${filePath}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON in ${filePath}: ${err.message}`);
  }
}

function printFindings(findings, stream) {
  for (const finding of findings) {
    stream.write(`[${finding.severity}] ${finding.code}: ${finding.message}\n`);
  }
}

function summarize(ok, findings) {
  const counts = { error: 0, warn: 0, info: 0 };
  for (const finding of findings) {
    if (finding.severity in counts) counts[finding.severity] += 1;
  }
  return `deployment parity: ${ok ? 'OK' : 'FAIL'} (${counts.error} error(s), ${counts.warn} warning(s), ${counts.info} info)`;
}

function runCli(argv) {
  if (argv.length < 2) {
    process.stderr.write(
      'Usage: node scripts/check-deployment-parity.mjs <expected.json> <observed.json>\n' +
        '       npm run check:parity -- <expected.json> <observed.json>\n',
    );
    return 2;
  }
  const [expectedPath, observedPath] = argv;
  let result;
  try {
    result = checkDeploymentParity(loadJson(expectedPath), loadJson(observedPath));
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    return 2;
  }
  printFindings(result.findings, process.stdout);
  process.stdout.write(`${summarize(result.ok, result.findings)}\n`);
  return result.ok ? 0 : 1;
}

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  process.exitCode = runCli(process.argv.slice(2));
}
