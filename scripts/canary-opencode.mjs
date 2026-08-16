#!/usr/bin/env node
/**
 * canary-opencode.mjs
 * Durable, reusable qualification tool for OpenCode Zen wire protocols and models.
 *
 * Requirements:
 * - Requires explicit CANARY_LIVE=1 env var to execute.
 * - Reads credentials strictly from environment or local .env (never prints secrets).
 * - Caps token requests to tiny budgets (max_tokens: 10).
 * - Flags:
 *     --protocol <chat|responses|messages|gemini|all>
 *     --model <modelId>
 *     --vision
 *
 * Example:
 *   CANARY_LIVE=1 node scripts/canary-opencode.mjs --protocol all --vision
 */

import fs from 'fs';
import path from 'path';

function printUsage() {
  console.log(`
Usage:
  CANARY_LIVE=1 node scripts/canary-opencode.mjs [options]

Options:
  --protocol <chat|responses|messages|gemini|all>  Protocol to test (default: all)
  --model <id>                                     Explicit model to test
  --vision                                         Include multimodal vision test
  --help                                           Show this message
`);
}

if (!process.env.CANARY_LIVE || process.env.CANARY_LIVE !== '1') {
  console.log('NOTICE: canary-opencode.mjs requires CANARY_LIVE=1 to prevent accidental network/billing calls.');
  console.log('Run with: CANARY_LIVE=1 node scripts/canary-opencode.mjs [options]');
  process.exit(0);
}

function loadKey() {
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY;

  const envPaths = [
    'C:/Workspace/Babel-private/babel-cli/.env',
    'C:/Workspace/Project_SaaS/Prismatix/.env',
  ];
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const [k, ...v] = trimmed.split('=');
        const val = v.join('=').trim().replace(/^["']|["']$/g, '');
        if (k.trim() === 'OPENCODE_API_KEY' && val) return val;
      }
    }
  }
  return null;
}

const key = loadKey();
if (!key) {
  console.error('ERROR: No OPENCODE_API_KEY found in environment or workspace .env files.');
  process.exit(1);
}

const BASE_URL = 'https://opencode.ai/zen/v1';
const args = process.argv.slice(2);

let protocolArg = 'all';
let explicitModel = null;
let testVision = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--protocol' && args[i + 1]) {
    protocolArg = args[++i];
  } else if (args[i] === '--model' && args[i + 1]) {
    explicitModel = args[++i];
  } else if (args[i] === '--vision') {
    testVision = true;
  } else if (args[i] === '--help') {
    printUsage();
    process.exit(0);
  }
}

function evaluateStatus(status, text = '') {
  if (status >= 200 && status < 300) return 'PASS';
  if (text.includes('CreditsError') || text.includes('balance') || text.includes('quota') || status === 402) {
    return 'BLOCKED_BY_CREDITS';
  }
  return 'FAIL';
}

async function testChat(modelId) {
  const url = `${BASE_URL}/chat/completions`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Ping' }],
        max_tokens: 10,
        stream: true,
      }),
    });
    const status = res.status;
    if (res.ok) {
      const reader = res.body.getReader();
      let chunks = 0;
      while (true) {
        const { done } = await reader.read();
        if (done) break;
        chunks++;
        if (chunks > 3) {
          await reader.cancel();
          break;
        }
      }
      return { result: 'PASS', status, endpoint: url, model: modelId, chunks };
    }
    const errText = await res.text();
    return {
      result: evaluateStatus(status, errText),
      status,
      endpoint: url,
      model: modelId,
      message: errText.slice(0, 80),
    };
  } catch (e) {
    return { result: 'FAIL', status: 0, endpoint: url, model: modelId, error: e.message };
  }
}

async function testResponses(modelId) {
  const url = `${BASE_URL}/responses`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        input: 'user: Ping',
        max_output_tokens: 10,
        stream: true,
      }),
    });
    const status = res.status;
    if (res.ok) {
      const reader = res.body.getReader();
      let chunks = 0;
      while (true) {
        const { done } = await reader.read();
        if (done) break;
        chunks++;
        if (chunks > 3) {
          await reader.cancel();
          break;
        }
      }
      return { result: 'PASS', status, endpoint: url, model: modelId, chunks };
    }
    const errText = await res.text();
    return {
      result: evaluateStatus(status, errText),
      status,
      endpoint: url,
      model: modelId,
      message: errText.slice(0, 80),
    };
  } catch (e) {
    return { result: 'FAIL', status: 0, endpoint: url, model: modelId, error: e.message };
  }
}

async function testMessages(modelId) {
  const url = `${BASE_URL}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'Authorization': `Bearer ${key}`,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Ping' }],
        max_tokens: 10,
        stream: true,
      }),
    });
    const status = res.status;
    if (res.ok) {
      const reader = res.body.getReader();
      let chunks = 0;
      while (true) {
        const { done } = await reader.read();
        if (done) break;
        chunks++;
        if (chunks > 3) {
          await reader.cancel();
          break;
        }
      }
      return { result: 'PASS', status, endpoint: url, model: modelId, chunks };
    }
    const errText = await res.text();
    return {
      result: evaluateStatus(status, errText),
      status,
      endpoint: url,
      model: modelId,
      message: errText.slice(0, 80),
    };
  } catch (e) {
    return { result: 'FAIL', status: 0, endpoint: url, model: modelId, error: e.message };
  }
}

async function testGemini(modelId) {
  const url = `${BASE_URL}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Say hello in one word' }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 10,
          temperature: 0.2,
        },
      }),
    });
    const status = res.status;
    if (res.ok) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let textDeltas = [];
      let chunks = 0;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks++;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            if (dataStr && dataStr !== '[DONE]') {
              try {
                const parsed = JSON.parse(dataStr);
                const part = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (part) textDeltas.push(part);
              } catch (_) {}
            }
          }
        }
        if (chunks > 10) {
          await reader.cancel();
          break;
        }
      }

      const reconstructedText = textDeltas.join('').trim();
      return {
        result: 'PASS',
        status,
        endpoint: url,
        model: modelId,
        chunks,
        reconstructedText: reconstructedText.slice(0, 60),
      };
    }
    const errText = await res.text();
    return {
      result: evaluateStatus(status, errText),
      status,
      endpoint: url,
      model: modelId,
      message: errText.slice(0, 80),
    };
  } catch (e) {
    return { result: 'FAIL', status: 0, endpoint: url, model: modelId, error: e.message };
  }
}

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function testVisionProbe(modelId) {
  const url = `${BASE_URL}/chat/completions`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe image' },
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${TINY_PNG_BASE64}` },
              },
            ],
          },
        ],
        max_tokens: 10,
      }),
    });
    const status = res.status;
    const text = await res.text();
    return {
      result: evaluateStatus(status, text),
      status,
      model: modelId,
      endpoint: url,
      message: text.slice(0, 80),
    };
  } catch (e) {
    return { result: 'FAIL', status: 0, model: modelId, error: e.message };
  }
}

async function run() {
  console.log('=== OPENCODE ZEN WIRE PROTOCOL QUALIFICATION CANARY ===');
  const results = [];

  if (protocolArg === 'chat' || protocolArg === 'all') {
    const m = explicitModel || 'deepseek-v4-flash-free';
    results.push(await testChat(m));
  }
  if (protocolArg === 'responses' || protocolArg === 'all') {
    const m = explicitModel || 'gpt-5.6-luna';
    results.push(await testResponses(m));
  }
  if (protocolArg === 'messages' || protocolArg === 'all') {
    const m = explicitModel || 'claude-haiku-4-5';
    results.push(await testMessages(m));
  }
  if (protocolArg === 'gemini' || protocolArg === 'all') {
    const m = explicitModel || 'gemini-3.7-flash';
    results.push(await testGemini(m));
  }

  if (testVision) {
    console.log('\n--- Multimodal Vision Capability Tests ---');
    const visionModels = ['gemini-3.7-flash', 'gpt-5.6-luna', 'claude-haiku-4-5', 'claude-sonnet-5'];
    for (const vm of visionModels) {
      results.push(await testVisionProbe(vm));
    }
  }

  console.log('\n=== CANARY RESULTS MATRIX ===');
  for (const r of results) {
    const symbol = r.result === 'PASS' ? '✅' : r.result === 'BLOCKED_BY_CREDITS' ? '⚠️' : '❌';
    console.log(
      `${symbol} [${r.result.padEnd(18)}] model: ${r.model.padEnd(24)} status: ${String(r.status).padEnd(4)} endpoint: ${r.endpoint}`,
    );
  }
}

run().catch((e) => {
  console.error('Fatal error during canary execution:', e);
  process.exit(1);
});
