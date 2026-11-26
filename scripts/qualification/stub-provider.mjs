#!/usr/bin/env node
// Deterministic, non-billable provider substitute for local qualification.
//
// Point the local stack's PRISMATIX_QUAL_PROVIDER_BASE_URL at this process
// to exercise the Edge handlers, database and settlement against fixtures.
//
// Safety properties:
//   * binds to 127.0.0.1 only;
//   * never performs outbound network I/O;
//   * refuses to start when the configured port is already bound;
//   * records request metadata without capturing credential values.
//
// Control surface (loopback only):
//   GET  /__health            -> { ok, scenario, requests }
//   POST /__control {scenario} defaults | slow | error | malformed | empty | no-usage | zero
//   POST /__reset             -> clears recorded requests, restores `default`
//   GET  /__requests          -> recorded request metadata

import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 8899);
// Loopback by default. CI runs the stub on an isolated machine and needs the
// Edge runtime container to reach it through the Docker bridge gateway, so a
// non-loopback bind is allowed only when explicitly opted in.
const HOST = process.env.STUB_HOST ?? '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(HOST) && process.env.STUB_ALLOW_NETWORK_BIND !== '1') {
  console.error(`[stub-provider] refusing non-loopback bind ${HOST}; set STUB_ALLOW_NETWORK_BIND=1 only on an isolated CI host`);
  process.exit(1);
}
const TEXT = process.env.STUB_TEXT ?? 'Prismatix deterministic stub response.';
const EXPECTED_KEY = process.env.STUB_EXPECTED_KEY ?? 'fake-byok-provider-key';
const FIXTURE_KEYS = {
  openai: 'fixture-openai-provider-key',
  openrouter: EXPECTED_KEY,
  opencode: 'fixture-opencode-console-key',
  opencode_go: 'fixture-opencode-go-key',
};
const OPENCODE_MODEL = {
  id: 'fixture-code-model', name: 'Fixture Coding Model', canonical_id: 'fixtures/code-model',
  type: 'chat', recommended_api: 'chat-completions', limit: { context: 128000, output: 8192 },
  modalities: { input: ['text'], output: ['text'] }, capabilities: { reasoning: { supported: true } },
  go: { training: false }, cost: { text: { input: { price: 1 }, output: { price: 2 } } },
};
const DELAY_MS = Number(process.env.STUB_DELAY_MS ?? 250);

const SCENARIOS = new Set(['default', 'slow', 'streaming', 'error', 'malformed', 'empty', 'no-usage', 'zero', 'restricted', 'retired', 'malformed-inventory', 'quota-exhausted', 'new-catalog', 'revised-catalog']);

let scenario = 'default';
let requests = [];

function record(entry) {
  requests.push({ ...entry, at: new Date().toISOString() });
  if (requests.length > 200) requests.shift();
}

function sseChunk(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function deltaFrame(res, text) {
  sseChunk(res, { id: 'stub-1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: text } }] });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleInference(req, res, path, provider, protocol) {
  const raw = await readBody(req);
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  const authorization = String(req.headers.authorization ?? '');
  const presentedKey = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const expectedKey = FIXTURE_KEYS[provider];
  const firstContent = parsed?.messages?.[0]?.content ?? parsed?.input?.[0]?.content;
  const firstText = typeof firstContent === 'string' ? firstContent
    : Array.isArray(firstContent) ? firstContent.find((part) => typeof part?.text === 'string')?.text : '';

  record({
    path, provider, protocol,
    workload: firstText?.includes('Extract only durable preferences') ? 'memory' : 'chat',
    model: parsed?.model ?? null,
    stream: parsed?.stream ?? null,
    hasUsageOption: Boolean(parsed?.stream_options?.include_usage),
    authPresent: authorization !== '',
    authMatched: presentedKey === expectedKey,
    stableSessionPresent: Boolean(req.headers['x-opencode-session']),
    messageCount: Array.isArray(parsed?.messages) ? parsed.messages.length : null,
  });

  if (!authorization.startsWith('Bearer ') || presentedKey !== expectedKey) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'stub: missing or unexpected bearer credential' } }));
    return;
  }

  if (scenario === 'restricted' || scenario === 'retired') {
    res.writeHead(scenario === 'restricted' ? 403 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'stub: emulated upstream access rejection' } }));
    return;
  }
  if (scenario === 'error') {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'stub: emulated upstream failure' } }));
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const streaming = scenario === 'streaming';
  // `streaming` keeps the response open long enough for a human/automation to
  // interrupt it mid-flight: small chunks with a fixed delay between them.
  const chunks = streaming
    ? (TEXT.match(/.{1,2}/gs) ?? [TEXT])
    : (TEXT.match(/.{1,18}/gs) ?? [TEXT]);

  if (scenario === 'malformed') {
    res.write('data: {not-json\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  if (scenario === 'empty') {
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  if (protocol === 'chat_completions') deltaFrame(res, '');
  for (const chunk of chunks) {
    if (protocol === 'responses') sseChunk(res, { type: 'response.output_text.delta', delta: chunk });
    else deltaFrame(res, chunk);
    if (scenario === 'slow' || streaming) await sleep(streaming ? 200 : DELAY_MS);
  }

  if (protocol === 'responses' && scenario !== 'no-usage') {
    sseChunk(res, { type: 'response.completed', response: { model: parsed.model, usage: {
      input_tokens: 40, output_tokens: 12, output_tokens_details: { reasoning_tokens: 4 },
    } } });
  } else if (scenario === 'zero') {
    sseChunk(res, { id: 'stub-1', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } });
  } else if (scenario !== 'no-usage') {
    sseChunk(res, { id: 'stub-1', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 40, completion_tokens: 12 } });
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  const remote = req.socket.remoteAddress ?? '';

  if (req.method === 'GET' && url.pathname === '/__health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, scenario, requests: requests.length }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/__requests') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ scenario, requests }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/__control') {
    const body = await readBody(req);
    let next = '';
    try {
      next = String(JSON.parse(body)?.scenario ?? '');
    } catch {
      next = '';
    }
    if (!SCENARIOS.has(next)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `unknown scenario: ${next}`, allowed: [...SCENARIOS] }));
      return;
    }
    scenario = next;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, scenario }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/__reset') {
    scenario = 'default';
    requests = [];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const inventory = url.pathname.match(/^\/(openai|openrouter|opencode|opencode_go)\/v1\/(models(?:\/user)?|auth\/key|key|usage|public-models)$/);
  if (req.method === 'GET' && inventory) {
    const [, provider, action] = inventory;
    const key = FIXTURE_KEYS[provider];
    const valid = (provider === 'opencode' && action === 'public-models' && !req.headers.authorization) || req.headers.authorization === `Bearer ${key}`;
    record({ path: url.pathname, provider, kind: 'metadata', authMatched: valid });
    res.writeHead(valid ? 200 : 401, { 'content-type': 'application/json' });
    const data = provider === 'openai' ? [
      { id: 'gpt-6.2-sol', object: 'model', owned_by: 'system' },
      { id: 'fixture-unpriced-model', object: 'model', owned_by: 'system' },
    ] : provider === 'opencode' || provider === 'opencode_go' ? [OPENCODE_MODEL] : [{
      id: 'google/gemini-3.8-flash', canonical_slug: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash',
      context_length: 1_000_000, top_provider: { max_completion_tokens: 8192 }, max_completion_tokens: 8192,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      supported_parameters: ['max_tokens', 'tools'],
      pricing: { prompt: '0.00000075', completion: '0.00000375', request: '0', image: '0', web_search: '0', internal_reasoning: '0' },
    }];
    if (provider === 'openrouter' && ['new-catalog', 'revised-catalog'].includes(scenario)) {
      const [base] = data;
      data.push({
        ...base, id: 'fixtures/new-compatible-chat', canonical_slug: 'fixtures/new-compatible-chat', name: 'New Compatible Chat',
        pricing: { ...base.pricing, prompt: scenario === 'revised-catalog' ? '0.0000015' : '0.0000005' },
      });
    }
    const payload = !valid ? { error: { message: 'fixture key rejected' } }
      : action === 'auth/key' || action === 'key' ? { data: { limit: 10, limit_remaining: 10, usage: 0 } }
      : action === 'usage' ? { usage: Object.fromEntries(['rolling', 'weekly', 'monthly'].map((window) =>
        [window, scenario === 'quota-exhausted' ? { status: 'rate-limited', percent: 100 } : { status: 'ok', percent: 20 }],
      )) } : scenario === 'malformed-inventory' ? { data: null } : { data };
    res.end(JSON.stringify(payload));
    return;
  }

  const inference = url.pathname.match(/^\/(?:(openai|openrouter|opencode|opencode_go)\/)?v1\/(chat\/completions|responses)$/);
  if (req.method === 'POST' && inference) {
    try {
      await handleInference(req, res, url.pathname, inference[1] ?? 'openrouter', inference[2] === 'responses' ? 'responses' : 'chat_completions');
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `stub failure: ${error instanceof Error ? error.message : 'unknown'}` } }));
      } else {
        res.end();
      }
    }
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'stub: not found', path: url.pathname, remote: Boolean(remote) }));
});

server.on('error', (error) => {
  console.error(`[stub-provider] failed to bind ${HOST}:${PORT}: ${error.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[stub-provider] listening on http://${HOST}:${PORT} (scenario=${scenario})`);
});
