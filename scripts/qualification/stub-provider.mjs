#!/usr/bin/env node
// Deterministic, non-billable provider substitute for local qualification.
//
// The router dispatches to `${OPENROUTER_BASE_URL}/chat/completions`. Pointing
// that variable at this process lets the real Edge function, the real database
// and the real settlement path run end to end without a live provider call.
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
const HOST = '127.0.0.1';
const TEXT = process.env.STUB_TEXT ?? 'Prismatix deterministic stub response.';
const EXPECTED_KEY = process.env.STUB_EXPECTED_KEY ?? 'fake-byok-provider-key';
const DELAY_MS = Number(process.env.STUB_DELAY_MS ?? 250);

const SCENARIOS = new Set(['default', 'slow', 'streaming', 'error', 'malformed', 'empty', 'no-usage', 'zero']);

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

async function handleChatCompletions(req, res) {
  const raw = await readBody(req);
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  const authorization = String(req.headers.authorization ?? '');
  const presentedKey = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  record({
    path: '/v1/chat/completions',
    model: parsed?.model ?? null,
    stream: parsed?.stream ?? null,
    hasUsageOption: Boolean(parsed?.stream_options?.include_usage),
    authPresent: authorization !== '',
    authMatched: presentedKey === EXPECTED_KEY,
    messageCount: Array.isArray(parsed?.messages) ? parsed.messages.length : null,
  });

  if (!authorization.startsWith('Bearer ') || presentedKey !== EXPECTED_KEY) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'stub: missing or unexpected bearer credential' } }));
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

  deltaFrame(res, '');
  for (const chunk of chunks) {
    deltaFrame(res, chunk);
    if (scenario === 'slow' || streaming) await sleep(streaming ? 200 : DELAY_MS);
  }

  if (scenario === 'zero') {
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

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    try {
      await handleChatCompletions(req, res);
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
