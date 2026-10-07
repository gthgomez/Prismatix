// Stale model coupling inventory.
//
// Scans the repo for hardcoded references to a retiring model generation.
// Couplings are not bugs per se (fallback planes legitimately pin legacy
// ids) — the point is to make them visible and RATCHETING: the committed
// budget file records how many couplings are acceptable per pattern, and
// `--check` fails when any pattern exceeds it. Deliberate additions must
// regenerate the budget via `--update-budget` in the same change.
//
// Usage:
//   node scripts/audit-stale-models.mjs [root]            report-only
//   node scripts/audit-stale-models.mjs [root] --check    exit 1 over budget
//   node scripts/audit-stale-models.mjs [root] --update-budget
//
// root defaults to the repo root (parent of scripts/), or $PRISMATIX_ROOT.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(scriptDir, '..');
const rootArg = process.argv[2] && !process.argv[2].startsWith('--')
  ? resolve(process.argv[2])
  : resolve(process.env.PRISMATIX_ROOT ?? defaultRoot);

const mode = process.argv.includes('--check')
  ? 'check'
  : process.argv.includes('--update-budget')
    ? 'update'
    : 'report';

const BUDGET_FILE = join(scriptDir, 'stale-model-budget.json');

// The generation being retired by the 2026-10 catalog refresh, plus the
// direct-fallback plane it must NOT spread into (SMD tier, legacy ladders).
const patterns = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'claude-opus-5',
  'claude-sonnet-5',
  'gpt-5.4',
  'gemini-3-flash',
  'gemini-2.5-flash',
  'gemini-3.1-pro',
  'opus-4.6',
  'sonnet-4.6',
  'haiku-4.5',
  'deepinfra',
  'nemotron',
  'llama-4',
  'qwen3',
  'glm-4.7',
  'mistral-nemo',
  'step-3.5',
  'SMD_MODEL_TIER',
];

const results = {};

function scanDir(dir) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === '.vercel') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath);
    } else if (/\.(ts|tsx|json|md|env.*)$/.test(entry)) {
      // Never count this script's own output/patterns.
      if (fullPath === BUDGET_FILE || fullPath === fileURLToPath(import.meta.url)) continue;
      const content = readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        for (const pat of patterns) {
          if (line.includes(pat)) {
            const rel = relative(rootArg, fullPath).replaceAll('\\', '/');
            if (!results[pat]) results[pat] = [];
            results[pat].push({ file: rel, line: idx + 1, text: line.trim() });
          }
        }
      });
    }
  }
}

scanDir(rootArg);

console.log('=== STALE MODEL COUPLING INVENTORY ===');
for (const pat of patterns) {
  const matches = results[pat] ?? [];
  console.log(`\nPattern: "${pat}" (Found ${matches.length} occurrences)`);
  for (const m of matches.slice(0, 8)) {
    console.log(`  ${m.file}:${m.line} -> ${m.text.slice(0, 100)}`);
  }
  if (matches.length > 8) {
    console.log(`  ... and ${matches.length - 8} more`);
  }
}

if (mode === 'report') process.exit(0);

const counts = Object.fromEntries(patterns.map((p) => [p, (results[p] ?? []).length]));

if (mode === 'update') {
  writeFileSync(BUDGET_FILE, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`\nBudget written to ${relative(rootArg, BUDGET_FILE)}`);
  process.exit(0);
}

// --check
let budget;
try {
  budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf-8'));
} catch {
  console.error(`\n--check failed: missing budget file ${BUDGET_FILE}`);
  console.error('Run with --update-budget to record the current counts, review it, and commit it.');
  process.exit(1);
}

const over = patterns.filter((p) => (counts[p] ?? 0) > (budget[p] ?? 0));
if (over.length > 0) {
  console.error('\nSTALE MODEL BUDGET EXCEEDED — the retiring generation is spreading:');
  for (const p of over) {
    console.error(`  "${p}": ${counts[p]} > budget ${budget[p] ?? 0}`);
  }
  console.error('If the new couplings are deliberate, run with --update-budget and commit the file.');
  process.exit(1);
}
console.log('\nStale-model budget holds: every pattern is at or under its committed count.');
