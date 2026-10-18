// @vitest-environment node
// Deterministic enabled-debate integration test invoking the actual router edge-function handler.
// Verifies:
// 1. Terminal receipt ordering: client receives finalized execution status, ok outcome, settled state, and transcript durability BEFORE [DONE].
// 2. Initial participant meta event emission in SSE stream.
// 3. Durable persistence via px07_persist_message with debate metadata.
// 4. Degradation fallback when a challenger fails, emitting degradation headers and preserving receipt ordering.

import { afterEach, describe, expect, it, vi } from 'vitest';

const ROUTER_ENTRY = ['../../supabase/functions/router/index.ts'].join('');

const SUBJECT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = 'test-service-role-key';
const ANTHROPIC_KEY = 'test-anthropic-key';
const OPENAI_KEY = 'test-openai-key';
const OPENCODE_KEY = 'test-opencode-key';

const BASE_ROUTER_ENV: Record<string, string> = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  ANTHROPIC_API_KEY: ANTHROPIC_KEY,
  OPENAI_API_KEY: OPENAI_KEY,
  OPENCODE_API_KEY: OPENCODE_KEY,
  OPENCODE_BASE_URL: 'https://opencode.ai/zen/v1',
  ENABLE_DEBATE_MODE: 'true',
  PRISMATIX_PROTOCOL_VERSION: 'test-protocol-9',
  PRISMATIX_SCHEMA_VERSION: 'test-schema-9',
  PRISMATIX_CATALOG_VERSION: 'test-catalog-9',
  PRISMATIX_TARIFF_VERSION: 'test-tariff-9',
  RELEASE_SHA: 'test-sha-debate',
};

interface ServeHandler {
  (req: Request): Promise<Response>;
}

interface FetchCall {
  url: string;
  method: string;
  body: string;
  headers: Headers;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function anthropicSseResponse(text: string): Response {
  const sse = [
    'data: {"type":"message_start","message":{"id":"msg_test","usage":{"input_tokens":50,"output_tokens":10}}}',
    '',
    `data: {"type":"content_block_delta","delta":{"text":${JSON.stringify(text)}}}`,
    '',
    'data: {"type":"message_delta","usage":{"output_tokens":25}}',
    '',
    'data: {"type":"message_stop"}',
    '',
    '',
  ].join('\n');
  return new Response(sse, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function openaiSseResponse(text: string): Response {
  const sse = [
    `data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant","content":${JSON.stringify(text)}}}]}`,
    '',
    'data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":40,"completion_tokens":20,"total_tokens":60}}',
    '',
    'data: [DONE]',
    '',
    '',
  ].join('\n');
  return new Response(sse, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function opencodeResponsesSseResponse(text: string): Response {
  const sse = [
    'data: {"type":"response.created","response":{"id":"resp_1"}}',
    '',
    `data: {"type":"response.output_text.delta","delta":{"text":${JSON.stringify(text)}}}`,
    '',
    'data: {"type":"response.completed","response":{"usage":{"input_tokens":30,"output_tokens":15}}}',
    '',
    'data: [DONE]',
    '',
    '',
  ].join('\n');
  return new Response(sse, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function fetchCallInfo(input: RequestInfo | URL, init?: RequestInit): FetchCall {
  let url: string;
  let method: string;
  if (typeof input === 'string') {
    url = input;
    method = init?.method ?? 'GET';
  } else if (input instanceof URL) {
    url = input.href;
    method = init?.method ?? 'GET';
  } else {
    url = input.url;
    method = init?.method ?? input.method;
  }
  const body = typeof init?.body === 'string' ? init.body : '';
  return { url, method: method.toUpperCase(), body, headers: new Headers(init?.headers) };
}

function installFetchRecorder(routes?: (call: FetchCall) => Response | null): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const call = fetchCallInfo(input, init);
    calls.push(call);
    const routed = routes ? routes(call) : null;
    return routed ?? jsonResponse(null);
  });
  return calls;
}

function installDenoStub(env: Record<string, string | undefined>): ServeHandler[] {
  const handlers: ServeHandler[] = [];
  (globalThis as unknown as Record<string, unknown>).Deno = {
    env: {
      get: (key: string): string | undefined => env[key],
    },
    serve: (handler: ServeHandler): void => {
      handlers.push(handler);
    },
  };
  return handlers;
}

async function loadServeHandler(
  entry: string,
  env: Record<string, string | undefined>,
): Promise<ServeHandler> {
  vi.resetModules();
  const handlers = installDenoStub(env);
  await import(/* @vite-ignore */ entry);
  const handler = handlers[0];
  if (!handler) {
    throw new Error(`Deno.serve handler was not registered for ${entry}`);
  }
  return handler;
}

interface SseParsedMessage {
  event?: string;
  data: string;
}

async function readAllSseEvents(response: Response): Promise<SseParsedMessage[]> {
  const reader = response.body?.getReader();
  if (!reader) return [];
  const decoder = new TextDecoder();
  let buffer = '';
  const events: SseParsedMessage[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      if (!part.trim()) continue;
      const lines = part.split('\n');
      let event: string | undefined;
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
      }
      events.push({ event, data: dataLines.join('\n') });
    }
  }
  return events;
}

function routerRequest(body: unknown, token = 'test-user-token'): Request {
  return new Request('http://127.0.0.1:54321/functions/v1/router', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

const EXECUTION_ID = 'e0000000-0000-4000-8000-000000000099';

function createSupabaseAndProviderRoutes(options?: {
  challengerFails?: boolean;
}) {
  let callCount = 0;
  return (call: FetchCall): Response | null => {
    // Auth endpoint
    if (call.url.includes('/auth/v1/user')) {
      return jsonResponse({
        id: SUBJECT_A,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'debate-user@example.test',
      });
    }
    // Entitlements
    if (call.url.includes('/rest/v1/rpc/get_access_grant')) {
      return jsonResponse({
        subject_id: SUBJECT_A,
        role: 'user',
        enabled: true,
        allowed_features: ['chat'],
        max_daily_usd: '10.000000',
        max_per_execution_usd: '2.000000',
      });
    }
    // Provider config
    if (call.url.includes('/rest/v1/rpc/get_user_provider_config')) {
      return jsonResponse({
        default_provider: 'opencode',
        providers: [
          { provider: 'opencode', enabled: true, has_key: false },
          { provider: 'anthropic', enabled: true, has_key: false },
          { provider: 'openai', enabled: true, has_key: false },
        ],
      });
    }
    if (call.url.includes('/rest/v1/conversations')) {
      return jsonResponse({ user_id: SUBJECT_A, total_tokens: 0 });
    }
    if (call.url.includes('/rest/v1/cost_logs') || call.url.includes('/rest/v1/user_memories')) {
      return jsonResponse([]);
    }
    if (call.url.includes('/rest/v1/conversation_memory_state')) {
      return jsonResponse(null);
    }
    if (call.url.includes('/rest/v1/messages')) {
      return jsonResponse([]);
    }

    // PX03 create execution
    if (call.url.includes('/rest/v1/rpc/px03_create_execution')) {
      return jsonResponse({
        execution: {
          id: EXECUTION_ID,
          subject_id: SUBJECT_A,
          conversation_id: CONVERSATION_ID,
          client_request_key: 'req-debate-test',
          payload_hash: 'hash-debate-test',
          status: 'started',
          terminal_outcome: null,
        },
        reused: false,
      });
    }

    // PX05 admit execution
    if (call.url.includes('/rest/v1/rpc/px05_admit_execution')) {
      return jsonResponse({
        admitted: true,
        reason: 'admitted',
        reservation_id: 'r0000000-0000-4000-8000-000000000099',
        lease_id: 'l0000000-0000-4000-8000-000000000099',
        retry_after_seconds: 0,
        remaining_usd: '5.0',
      });
    }

    // PX03 record model call
    if (call.url.includes('/rest/v1/rpc/px03_record_model_call')) {
      callCount++;
      return jsonResponse({
        id: `c0000000-0000-4000-8000-00000000000${callCount}`,
        execution_id: EXECUTION_ID,
        stage: 'debate',
        participant: 'provider',
        status: 'completed',
        total_cost: 0.002,
        cost_status: 'settled',
      });
    }

    // PX05 commit from ledger
    if (call.url.includes('/rest/v1/rpc/px05_commit_from_ledger')) {
      return jsonResponse({
        state: 'committed',
        updated: true,
        reservation_id: 'r0000000-0000-4000-8000-000000000099',
        committed_usd: '0.006',
        calls: callCount,
      });
    }

    // PX03 finalize execution
    if (call.url.includes('/rest/v1/rpc/px03_finalize_execution')) {
      return jsonResponse({
        execution: {
          id: EXECUTION_ID,
          status: 'completed',
          terminal_outcome: 'ok',
          finalized_at: new Date().toISOString(),
        },
        finalized: true,
      });
    }

    // PX03 get execution receipt
    if (call.url.includes('/rest/v1/rpc/px03_get_execution_receipt')) {
      return jsonResponse({
        execution: {
          id: EXECUTION_ID,
          status: 'completed',
          terminal_outcome: 'ok',
          created_at: '2026-10-18T00:00:00.000Z',
          updated_at: '2026-10-18T00:00:05.000Z',
        },
        calls: [
          {
            stage: 'debate-proposer',
            participant: 'opencode',
            attempt_number: 1,
            cost_status: 'settled',
            total_cost: 0.002,
          },
          {
            stage: 'debate-challenger',
            participant: 'opencode',
            attempt_number: 1,
            cost_status: 'settled',
            total_cost: 0.002,
          },
          {
            stage: 'debate-synthesis',
            participant: 'opencode',
            attempt_number: 1,
            cost_status: 'settled',
            total_cost: 0.002,
          },
        ],
        reservation: {
          state: 'committed',
          committed_usd: 0.006,
        },
      });
    }

    // PX07 persist message
    if (call.url.includes('/rest/v1/rpc/px07_persist_message')) {
      return jsonResponse({
        message_id: 'm0000000-0000-4000-8000-000000000099',
        inserted: true,
      });
    }

    // Provider mock responses
    if (call.url.includes('/models')) {
      return jsonResponse({
        data: [
          { id: 'deepseek-v4.1-flash' },
          { id: 'deepseek-v4-flash' },
          { id: 'deepseek-v4-pro' },
          { id: 'gpt-6-luna' },
          { id: 'gpt-6-sol' },
          { id: 'claude-haiku-5-5' },
          { id: 'gemini-3.8-flash' },
        ],
      });
    }

    if (call.url.includes('opencode.ai')) {
      if (options?.challengerFails && call.body.includes('skeptic')) {
        return new Response('OpenCode challenger upstream error', { status: 500 });
      }
      if (call.url.includes('/responses')) {
        return opencodeResponsesSseResponse('OpenCode debate turn response text.');
      }
      return openaiSseResponse('OpenCode debate turn response text.');
    }

    if (call.url.includes('api.openai.com')) {
      if (options?.challengerFails) {
        return new Response('OpenAI upstream error', { status: 500 });
      }
      return openaiSseResponse('OpenAI challenger critique identifying architectural risks.');
    }

    if (call.url.includes('api.anthropic.com')) {
      return anthropicSseResponse('Anthropic response synthesizing multi-model debate.');
    }

    return null;
  };
}

describe('Deterministic Enabled-Debate Handler Integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs enabled debate: emits participant meta event, persists debate metadata, and orders terminal receipt before [DONE]', async () => {
    const calls = installFetchRecorder(createSupabaseAndProviderRoutes());
    const handler = await loadServeHandler(ROUTER_ENTRY, BASE_ROUTER_ENV);

    const req = routerRequest({
      conversationId: CONVERSATION_ID,
      query: 'Debate the pros and cons of distributed consensus algorithms in high-throughput pipelines.',
      history: [],
      mode: 'debate',
      debateProfile: 'general',
      platform: 'web',
    });

    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('X-Debate-Mode')).toBe('true');
    expect(res.headers.get('X-Debate-Profile')).toBe('general');
    expect(res.headers.get('X-Debate-Trigger')).toBe('explicit');

    const events = await readAllSseEvents(res);
    expect(events.length).toBeGreaterThan(0);

    // 1. Participant meta event must be emitted
    const metaPayload = events
      .map((e) => {
        try {
          return JSON.parse(e.data);
        } catch {
          return null;
        }
      })
      .find((p) => p?.type === 'meta');
    expect(metaPayload).toBeTruthy();
    expect(Array.isArray(metaPayload.debate_participants)).toBe(true);
    expect(metaPayload.debate_participants.length).toBeGreaterThan(0);

    // 2. Terminal receipt event must appear BEFORE [DONE]
    const doneIndex = events.findIndex((e) => e.data.trim() === '[DONE]');
    expect(doneIndex).toBeGreaterThan(-1);

    const receiptIndex = events.findIndex((e) => {
      try {
        return JSON.parse(e.data)?.type === 'receipt';
      } catch {
        return false;
      }
    });
    expect(receiptIndex).toBeGreaterThan(-1);
    expect(receiptIndex).toBeLessThan(doneIndex);

    const receiptPayload = JSON.parse(events[receiptIndex]!.data);
    expect(receiptPayload.executionId).toBe(EXECUTION_ID);
    expect(receiptPayload.status).toBe('completed');
    expect(receiptPayload.terminalOutcome).toBe('ok');
    expect(receiptPayload.settlement.state).toBe('settled');
    expect(receiptPayload.transcript.saved).toBe(true);
    expect(receiptPayload.finalizedAt).toBeTruthy();

    // 3. px07_persist_message must have been called with assistant debate metadata
    const persistCalls = calls.filter((c) => c.url.includes('/rest/v1/rpc/px07_persist_message'));
    expect(persistCalls.length).toBeGreaterThanOrEqual(2); // user turn + assistant turn

    const assistantPersistCall = persistCalls.find((c) => {
      const body = JSON.parse(c.body);
      return body.p_role === 'assistant';
    });
    expect(assistantPersistCall).toBeTruthy();
    const assistantBody = JSON.parse(assistantPersistCall!.body);
    expect(assistantBody.p_metadata?.debate?.active).toBe(true);
    expect(assistantBody.p_metadata?.debate?.profile).toBe('general');
    expect(Array.isArray(assistantBody.p_metadata?.debate?.participants)).toBe(true);
  });

  it('handles challenger upstream failure by degrading gracefully to single-model response while preserving receipt ordering', async () => {
    const calls = installFetchRecorder(createSupabaseAndProviderRoutes({ challengerFails: true }));
    const handler = await loadServeHandler(ROUTER_ENTRY, BASE_ROUTER_ENV);

    const req = routerRequest({
      conversationId: CONVERSATION_ID,
      query: 'Analyze the architectural trade-offs with challenger failure.',
      history: [],
      mode: 'debate',
      debateProfile: 'general',
      platform: 'web',
    });

    const res = await handler(req);
    expect(res.status).toBe(200);

    // Degradation header must be stamped
    expect(res.headers.get('X-Debate-Degraded')).toBe('true');
    expect(res.headers.get('X-Debate-Degraded-Reason')).toBeTruthy();

    const events = await readAllSseEvents(res);
    const doneIndex = events.findIndex((e) => e.data.trim() === '[DONE]');
    const receiptIndex = events.findIndex((e) => {
      try {
        return JSON.parse(e.data)?.type === 'receipt';
      } catch {
        return false;
      }
    });

    expect(receiptIndex).toBeGreaterThan(-1);
    expect(receiptIndex).toBeLessThan(doneIndex);

    const receiptPayload = JSON.parse(events[receiptIndex]!.data);
    expect(receiptPayload.status).toBe('completed');
    expect(receiptPayload.terminalOutcome).toBe('ok');

    // Assistant message must persist degradation metadata
    const persistCalls = calls.filter((c) => c.url.includes('/rest/v1/rpc/px07_persist_message'));
    const assistantPersistCall = persistCalls.find((c) => {
      const body = JSON.parse(c.body);
      return body.p_role === 'assistant';
    });
    expect(assistantPersistCall).toBeTruthy();
    const assistantBody = JSON.parse(assistantPersistCall!.body);
    expect(assistantBody.p_metadata?.debate?.degraded).toBe(true);
    expect(assistantBody.p_metadata?.debate?.degradedReason).toBe('debate_pipeline_failed_or_timed_out');
  });

  it('guards against late model call dispatch on already finalized execution', async () => {
    const { runMeteredCall, MeteredCallAccountingError } = await import('../../supabase/functions/router/metered_call.ts');
    const dummyStoreClient = {
      rpc: vi.fn(),
    };
    const finalizedExecution = {
      id: EXECUTION_ID,
      status: 'completed' as const,
      terminal_outcome: 'ok',
    };

    await expect(
      runMeteredCall(
        {
          store: dummyStoreClient as any,
          execution: finalizedExecution as any,
          stage: 'debate-challenger',
          participant: 'opencode',
        },
        async () => ({
          result: new Response('dummy'),
          servedModel: 'deepseek-v4-1-flash',
          usagePromise: Promise.resolve(null),
        }),
      ),
    ).rejects.toThrow(MeteredCallAccountingError);
  });
});
