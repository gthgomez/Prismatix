import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const patterns = [
  'gemini-2.5-flash',
  'gemini-3.1-pro',
  'gemini-3-flash',
  'gpt-5.4-mini',
  'gpt-5.4',
  'sonnet-4.6',
  'opus-4.6',
  'haiku-4.5',
  'deepseek-v3',
  'qwen3',
  'deepinfra',
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
      const content = readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        for (const pat of patterns) {
          if (line.includes(pat)) {
            const rel = relative('C:\\Workspace\\Project_SaaS\\Prismatix', fullPath);
            if (!results[pat]) results[pat] = [];
            results[pat].push({ file: rel, line: idx + 1, text: line.trim() });
          }
        }
      });
    }
  }
}

scanDir('C:\\Workspace\\Project_SaaS\\Prismatix');

console.log('=== STALE MODEL COUPLING INVENTORY ===');
for (const [pat, matches] of Object.entries(results)) {
  console.log(`\nPattern: "${pat}" (Found ${matches.length} occurrences)`);
  for (const m of matches.slice(0, 8)) {
    console.log(`  ${m.file}:${m.line} -> ${m.text.slice(0, 100)}`);
  }
  if (matches.length > 8) {
    console.log(`  ... and ${matches.length - 8} more`);
  }
}
