// scripts/verify-catalog.mjs
// PX04 — dependency-free drift gate for the authoritative pricing/identity
// catalog.
//
// The runtime TypeScript tables (`supabase/functions/router/pricing_registry.ts`
// and `src/pricingRegistry.ts`) are still hand-maintained in this packet, so this
// gate keeps them in lockstep with the JSON authorities (`catalog/prices.json`,
// `catalog/approved-models.json`) and with the Auto route policy. It is the
// single source-of-truth enforcement until the later codegen step derives the TS
// tables from these JSON files.
//
// Exports `verifyCatalog(options)` and runs as a CLI:
//   node scripts/verify-catalog.mjs [--root <dir>] [--today YYYY-MM-DD]
//
// Exit code 1 on any drift/violation. Node ESM, no dependencies.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');

const PRICES_REL = 'catalog/prices.json';
const APPROVED_REL = 'catalog/approved-models.json';
const SERVER_REGISTRY_REL = 'supabase/functions/router/pricing_registry.ts';
const FRONTEND_REGISTRY_REL = 'src/pricingRegistry.ts';
const MODELS_HUB_REL = 'supabase/functions/router/models_hub.ts';

const ALLOWED_PROTOCOLS = new Set([
  'openai-responses',
  'openai-chat',
  'anthropic-messages',
  'gemini',
]);
const ALLOWED_QUALIFICATIONS = new Set(['approved', 'candidate', 'disabled']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_RE = /^\d+(\.\d+)?$/;

const PRICE_REQUIRED = [
  'gateway',
  'endpointModelId',
  'inputPer1M',
  'outputPer1M',
  'effectiveFrom',
  'sourceUrl',
  'verifiedAt',
];
const PRICE_OPTIONAL = [
  'cachedReadPer1M',
  'cachedWritePer1M',
  'longContextThreshold',
  'longContextInputPer1M',
  'effectiveTo',
];
const PRICE_ALLOWED = new Set([...PRICE_REQUIRED, ...PRICE_OPTIONAL]);
const PRICE_MONEY_FIELDS = [
  'inputPer1M',
  'outputPer1M',
  'cachedReadPer1M',
  'cachedWritePer1M',
  'longContextInputPer1M',
];

const APPROVED_REQUIRED = [
  'id',
  'gateway',
  'apiModelId',
  'protocol',
  'modalities',
  'contextLimit',
  'maxOutputTokens',
  'privacy',
  'tariffKey',
  'qualification',
];
const APPROVED_OPTIONAL = ['reason'];
const APPROVED_ALLOWED = new Set([...APPROVED_REQUIRED, ...APPROVED_OPTIONAL]);

// Rates shared by the server authority and the frontend display mirror.
const SHARED_RATE_FIELDS = [
  'inputRatePer1M',
  'outputRatePer1M',
  'cachedReadRatePer1M',
  'cachedWriteRatePer1M',
  'reasoningRatePer1M',
  'longContextThreshold',
  'longContextInputRatePer1M',
  'longContextOutputRatePer1M',
  'longContextCachedReadRatePer1M',
  'longContextCachedWriteRatePer1M',
  'offPeakInputRatePer1M',
  'offPeakOutputRatePer1M',
  'offPeakCachedReadRatePer1M',
];

// JSON price field -> server registry field (money is a decimal string in JSON).
const PRICE_TO_REGISTRY_FIELD = {
  inputPer1M: 'inputRatePer1M',
  outputPer1M: 'outputRatePer1M',
  cachedReadPer1M: 'cachedReadRatePer1M',
  cachedWritePer1M: 'cachedWriteRatePer1M',
  longContextThreshold: 'longContextThreshold',
  longContextInputPer1M: 'longContextInputRatePer1M',
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function readSource(root, rel) {
  return readFileSync(resolve(root, rel), 'utf8');
}

function readJson(root, rel) {
  return JSON.parse(readSource(root, rel));
}

/**
 * Extracts the object literal that follows `export const <constName>` using a
 * string/comment-aware brace matcher, so comments or braces inside strings never
 * confuse the boundary. The extracted literal is evaluated with `Function`
 * (repo-controlled source only, never user input) to obtain the registry.
 */
function extractObjectLiteral(source, constName) {
  const marker = `export const ${constName}`;
  const markerIdx = source.indexOf(marker);
  if (markerIdx === -1) {
    throw new Error(`could not find '${marker}'`);
  }
  const braceStart = source.indexOf('{', markerIdx);
  if (braceStart === -1) {
    throw new Error(`no object literal after '${marker}'`);
  }

  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }

  throw new Error(`unbalanced braces after '${marker}'`);
}

function parseObjectLiteral(source, constName) {
  const literal = extractObjectLiteral(source, constName);
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${literal});`)();
}

function extractStringConst(source, constName) {
  const match = source.match(
    new RegExp(`export const ${constName}\\s*=\\s*(['"\`])([^'"\`]*)\\1`),
  );
  return match ? match[2] : undefined;
}

function loadCatalogInputs(options) {
  const root = options.root ?? DEFAULT_ROOT;
  const load = (override, rel, parser) => {
    if (override !== undefined) return override;
    return parser(root, rel);
  };

  return {
    root,
    prices: load(options.prices, PRICES_REL, readJson),
    approved: load(options.approved, APPROVED_REL, readJson),
    serverRegistry: options.serverRegistry,
    serverVersion: options.serverVersion,
    frontendRegistry: options.frontendRegistry,
    frontendVersion: options.frontendVersion,
    autoPolicy: options.autoPolicy,
    serverRegistrySource:
      options.serverRegistrySource ??
      (options.serverRegistry ? undefined : readSource(root, SERVER_REGISTRY_REL)),
    frontendRegistrySource:
      options.frontendRegistrySource ??
      (options.frontendRegistry ? undefined : readSource(root, FRONTEND_REGISTRY_REL)),
    modelsHubSource:
      options.modelsHubSource ??
      (options.autoPolicy ? undefined : readSource(root, MODELS_HUB_REL)),
  };
}

function validatePrices(prices, today, push) {
  if (!isPlainObject(prices)) {
    push(`${PRICES_REL}: expected a JSON object keyed by canonical model id`);
    return;
  }

  for (const [modelId, entry] of Object.entries(prices)) {
    const where = `${PRICES_REL}[${modelId}]`;
    if (!isPlainObject(entry)) {
      push(`${where}: expected an object`);
      continue;
    }

    for (const field of PRICE_REQUIRED) {
      if (!(field in entry)) {
        push(`${where}: missing required field '${field}'`);
      }
    }
    for (const field of Object.keys(entry)) {
      if (!PRICE_ALLOWED.has(field)) {
        push(`${where}: unknown field '${field}'`);
      }
    }

    for (const field of ['gateway', 'endpointModelId', 'sourceUrl']) {
      if (field in entry && (typeof entry[field] !== 'string' || entry[field].trim() === '')) {
        push(`${where}.${field}: expected a non-empty string`);
      }
    }
    if (typeof entry.sourceUrl === 'string' && !/^https?:\/\//.test(entry.sourceUrl)) {
      push(`${where}.sourceUrl: expected an http(s) URL`);
    }

    for (const field of PRICE_MONEY_FIELDS) {
      if (field in entry && (typeof entry[field] !== 'string' || !DECIMAL_RE.test(entry[field]))) {
        push(`${where}.${field}: money must be an exact decimal string`);
      }
    }

    if (
      'longContextThreshold' in entry &&
      (!Number.isInteger(entry.longContextThreshold) || entry.longContextThreshold <= 0)
    ) {
      push(`${where}.longContextThreshold: expected a positive integer`);
    }

    for (const field of ['effectiveFrom', 'effectiveTo']) {
      if (field in entry && (typeof entry[field] !== 'string' || !DATE_RE.test(entry[field]))) {
        push(`${where}.${field}: expected a YYYY-MM-DD date`);
      }
    }

    if (entry.effectiveTo && DATE_RE.test(entry.effectiveTo) && entry.effectiveTo < today) {
      push(`${where}: price expired on ${entry.effectiveTo} (today ${today})`);
    }
    if (
      entry.effectiveFrom &&
      entry.effectiveTo &&
      DATE_RE.test(entry.effectiveFrom) &&
      DATE_RE.test(entry.effectiveTo) &&
      entry.effectiveFrom > entry.effectiveTo
    ) {
      push(`${where}: effectiveFrom ${entry.effectiveFrom} is after effectiveTo ${entry.effectiveTo}`);
    }
  }
}

function validateApproved(approved, prices, today, push) {
  if (!Array.isArray(approved)) {
    push(`${APPROVED_REL}: expected an array of approved endpoints`);
    return;
  }

  const seen = new Set();
  for (const [index, entry] of approved.entries()) {
    const where = `${APPROVED_REL}[${index}]`;
    if (!isPlainObject(entry)) {
      push(`${where}: expected an object`);
      continue;
    }

    for (const field of APPROVED_REQUIRED) {
      if (!(field in entry)) {
        push(`${where}: missing required field '${field}'`);
      }
    }
    for (const field of Object.keys(entry)) {
      if (!APPROVED_ALLOWED.has(field)) {
        push(`${where}: unknown field '${field}'`);
      }
    }

    if (typeof entry.id === 'string') {
      if (seen.has(entry.id)) push(`${where}: duplicate endpoint id '${entry.id}'`);
      seen.add(entry.id);
    } else {
      push(`${where}.id: expected a non-empty string`);
    }

    if (typeof entry.gateway !== 'string' || entry.gateway.trim() === '') {
      push(`${where}.gateway: expected a non-empty string`);
    }
    if (typeof entry.apiModelId !== 'string' || entry.apiModelId.trim() === '') {
      push(`${where}.apiModelId: expected a non-empty string`);
    }
    if (!ALLOWED_PROTOCOLS.has(entry.protocol)) {
      push(`${where}.protocol: unsupported protocol '${entry.protocol}'`);
    }
    if (
      !Array.isArray(entry.modalities) ||
      entry.modalities.length === 0 ||
      entry.modalities.some((m) => typeof m !== 'string' || m.trim() === '')
    ) {
      push(`${where}.modalities: expected a non-empty array of strings`);
    }
    if (!Number.isInteger(entry.contextLimit) || entry.contextLimit <= 0) {
      push(`${where}.contextLimit: expected a positive integer`);
    }
    if (!Number.isInteger(entry.maxOutputTokens) || entry.maxOutputTokens <= 0) {
      push(`${where}.maxOutputTokens: expected a positive integer`);
    }
    if (!isPlainObject(entry.privacy)) {
      push(`${where}.privacy: expected an object`);
    } else {
      if (typeof entry.privacy.retention !== 'string') {
        push(`${where}.privacy.retention: expected a string`);
      }
      if (typeof entry.privacy.trainsOnData !== 'boolean') {
        push(`${where}.privacy.trainsOnData: expected a boolean`);
      }
    }
    if (!ALLOWED_QUALIFICATIONS.has(entry.qualification)) {
      push(`${where}.qualification: unsupported qualification '${entry.qualification}'`);
    }

    // Every declared tariffKey must resolve to a non-expired price.
    if (typeof entry.tariffKey === 'string') {
      const price = isPlainObject(prices) ? prices[entry.tariffKey] : undefined;
      if (!price) {
        push(`${where}: tariffKey '${entry.tariffKey}' does not resolve to a price`);
      } else if (price.effectiveTo && DATE_RE.test(price.effectiveTo) && price.effectiveTo < today) {
        push(`${where}: tariffKey '${entry.tariffKey}' resolves to an expired price`);
      }
    } else {
      push(`${where}.tariffKey: expected a string`);
    }
  }
}

function validateMirrors(inputs, approved, prices, push) {
  let serverRegistry = inputs.serverRegistry;
  let serverVersion = inputs.serverVersion;
  let frontendRegistry = inputs.frontendRegistry;
  let frontendVersion = inputs.frontendVersion;

  try {
    if (!serverRegistry) {
      serverRegistry = parseObjectLiteral(inputs.serverRegistrySource, 'PRICING_REGISTRY');
    }
    if (serverVersion === undefined) {
      serverVersion = extractStringConst(inputs.serverRegistrySource, 'PRICING_VERSION');
    }
  } catch (error) {
    push(`${SERVER_REGISTRY_REL}: ${error.message}`);
  }

  try {
    if (!frontendRegistry) {
      frontendRegistry = parseObjectLiteral(inputs.frontendRegistrySource, 'PRICING_REGISTRY');
    }
    if (frontendVersion === undefined) {
      frontendVersion = extractStringConst(inputs.frontendRegistrySource, 'PRICING_VERSION');
    }
  } catch (error) {
    push(`${FRONTEND_REGISTRY_REL}: ${error.message}`);
  }

  if (!serverRegistry || !frontendRegistry) return;

  if (serverVersion !== frontendVersion) {
    push(
      `PRICING_VERSION drift: server='${serverVersion}' frontend='${frontendVersion}'`,
    );
  }

  const ids = Array.isArray(approved)
    ? approved.filter((entry) => isPlainObject(entry) && typeof entry.id === 'string')
    : [];

  for (const entry of ids) {
    const server = serverRegistry[entry.id];
    const frontend = frontendRegistry[entry.id];
    if (!server) {
      push(`${SERVER_REGISTRY_REL}: missing registry entry for catalog model '${entry.id}'`);
    }
    if (!frontend) {
      push(`${FRONTEND_REGISTRY_REL}: missing registry entry for catalog model '${entry.id}'`);
    }
    if (!server || !frontend) continue;

    for (const field of SHARED_RATE_FIELDS) {
      if (server[field] !== frontend[field]) {
        push(
          `rate drift for '${entry.id}'.${field}: server=${server[field]} frontend=${frontend[field]}`,
        );
      }
    }

    // prices.json is the authority: its money must match the server table.
    const price = isPlainObject(prices) ? prices[entry.id] : undefined;
    if (!price) {
      push(`${PRICES_REL}: no price entry for catalog model '${entry.id}'`);
      continue;
    }
    for (const [jsonField, registryField] of Object.entries(PRICE_TO_REGISTRY_FIELD)) {
      if (!(jsonField in price)) continue;
      const jsonValue = jsonField === 'longContextThreshold'
        ? price[jsonField]
        : Number(price[jsonField]);
      if (jsonValue !== server[registryField]) {
        push(
          `${PRICES_REL}[${entry.id}].${jsonField}=${price[jsonField]} does not match ` +
            `${SERVER_REGISTRY_REL}.${registryField}=${server[registryField]}`,
        );
      }
    }
  }
}

function validateAutoPolicy(inputs, approved, push) {
  let autoPolicy = inputs.autoPolicy;
  if (!autoPolicy) {
    try {
      autoPolicy = parseObjectLiteral(inputs.modelsHubSource, 'CURATED_ROUTE_POLICY');
    } catch (error) {
      push(`${MODELS_HUB_REL}: ${error.message}`);
      return;
    }
  }

  if (!isPlainObject(autoPolicy)) {
    push(`${MODELS_HUB_REL}: CURATED_ROUTE_POLICY is not an object`);
    return;
  }

  const approvedById = new Map();
  if (Array.isArray(approved)) {
    for (const entry of approved) {
      if (isPlainObject(entry) && typeof entry.id === 'string') {
        approvedById.set(entry.id, entry);
      }
    }
  }

  for (const [role, policy] of Object.entries(autoPolicy)) {
    if (!isPlainObject(policy)) {
      push(`Auto policy role '${role}' is malformed`);
      continue;
    }
    const candidates = [policy.primary, ...(Array.isArray(policy.fallback) ? policy.fallback : [])];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') {
        push(`Auto policy role '${role}' has a non-string candidate`);
        continue;
      }
      const entry = approvedById.get(candidate);
      if (!entry) {
        push(`Auto reachable model '${candidate}' (role '${role}') is not in ${APPROVED_REL}`);
        continue;
      }
      if (entry.qualification !== 'approved') {
        push(
          `Auto reachable model '${candidate}' (role '${role}') has qualification ` +
            `'${entry.qualification}', expected 'approved'`,
        );
      }
      if (isPlainObject(entry.privacy) && entry.privacy.trainsOnData !== false) {
        push(
          `Auto reachable model '${candidate}' (role '${role}') is privacy-unapproved ` +
            `(trainsOnData=${entry.privacy.trainsOnData})`,
        );
      }
    }
  }
}

/**
 * Verifies the catalog, the duplicated runtime pricing tables and the Auto route
 * policy. All inputs are optional and default to the committed repository files;
 * tests inject overrides to prove the gate fails on drift.
 *
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function verifyCatalog(options = {}) {
  const today = options.today ?? todayIso();
  const violations = [];
  const push = (message) => violations.push(message);

  const inputs = loadCatalogInputs(options);
  const { prices, approved } = inputs;

  validatePrices(prices, today, push);
  validateApproved(approved, prices, today, push);
  validateMirrors(inputs, approved, prices, push);
  validateAutoPolicy(inputs, approved, push);

  return { ok: violations.length === 0, violations };
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const todayIdx = argv.indexOf('--today');
  const options = {};
  if (rootIdx !== -1) options.root = argv[rootIdx + 1];
  if (todayIdx !== -1) options.today = argv[todayIdx + 1];

  const result = verifyCatalog(options);
  if (result.ok) {
    console.log(
      'verify-catalog: OK — catalog, pricing mirrors and Auto policy are in lockstep.',
    );
    return 0;
  }

  console.error(`verify-catalog: FAILED with ${result.violations.length} violation(s):`);
  for (const violation of result.violations) {
    console.error(`  - ${violation}`);
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
