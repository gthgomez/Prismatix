import { createClient } from 'npm:@supabase/supabase-js@2';
import { assertEntitled, loadAccessGrant } from '../_shared/access_policy.ts';
import { executeMemoryTool, memoryRpc, type MemoryRpcClient } from '../_shared/memory_contract.ts';
import { keepAlive, readEnv, runtime } from './runtime.ts';
import { runMemoryJobs } from './worker.ts';
interface MemoryClient extends MemoryRpcClient {
  auth: {
    getUser(token: string): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>;
  };
}
export interface MemoryDeps {
  getEnv?: (key: string) => string | undefined;
  createClient?: (url: string, key: string) => MemoryClient;
  background?: (task: Promise<unknown>) => void;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function readBody(req: Request): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('invalid_memory_request');
  let bytes = 0;
  let text = '';
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 8192) throw new Error('memory_request_too_large');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid_memory_request');
  }
  return parsed;
}
export async function handleMemoryRequest(req: Request, deps: MemoryDeps = {}): Promise<Response> {
  const getEnv = deps.getEnv ?? readEnv;
  const headers = {
    'Access-Control-Allow-Origin': getEnv('ALLOWED_ORIGIN') ?? 'http://localhost:3000',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
    'Content-Type': 'application/json',
  };
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status, headers });
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (!['GET', 'POST'].includes(req.method)) return json({ error: 'method_not_allowed' }, 405);
  const token = req.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return json({ error: 'unauthorized' }, 401);
  const url = getEnv('SUPABASE_URL'), key = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: 'memory_unavailable' }, 503);
  const client = (deps.createClient ??
    ((u, k) =>
      createClient(u, k, {
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as MemoryClient))(url, key);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return json({ error: 'unauthorized' }, 401);
  const subject = data.user.id;
  try {
    assertEntitled(await loadAccessGrant(client, subject), 'chat');
  } catch {
    return json({ error: 'not_entitled' }, 403);
  }
  let body: Record<string, unknown>;
  try {
    body = req.method === 'GET' ? { action: 'status' } : await readBody(req);
  } catch {
    return json({ error: 'invalid_memory_request' }, 400);
  }
  const action = body.action;
  const allowed: Record<string, string[]> = {
    status: ['action'],
    list: ['action', 'before'],
    search_memory: ['action', 'query', 'limit'],
    read_memory: ['action', 'ids'],
    settings: ['action', 'enabled', 'forgetOnChatDelete'],
    remember: ['action', 'text'],
    correct: ['action', 'id', 'text'],
    forget: ['action', 'id'],
    retry: ['action'],
  };
  if (
    typeof action !== 'string' || !allowed[action] ||
    Object.keys(body).some((k) => !allowed[action]!.includes(k))
  ) return json({ error: 'invalid_memory_request' }, 400);
  if (
    ['correct', 'forget'].includes(action) && (typeof body.id !== 'string' || !uuid.test(body.id))
  ) return json({ error: 'invalid_memory_id' }, 400);
  if (
    ['remember', 'correct'].includes(action) &&
    (typeof body.text !== 'string' || body.text.trim().length < 3 || body.text.length > 500)
  ) return json({ error: 'invalid_memory_text' }, 400);
  if (
    action === 'settings' &&
    (['enabled', 'forgetOnChatDelete'].some((k) =>
      body[k] !== undefined && typeof body[k] !== 'boolean'
    ))
  ) return json({ error: 'invalid_memory_settings' }, 400);
  if (
    action === 'list' && body.before !== undefined &&
    (typeof body.before !== 'string' || !uuid.test(body.before))
  ) return json({ error: 'invalid_memory_cursor' }, 400);
  try {
    if (action === 'status') {
      return json(await memoryRpc(client, 'memory_status', { p_subject_id: subject }));
    }
    if (action === 'list') {
      return json(
        await memoryRpc(client, 'memory_list', {
          p_subject_id: subject,
          p_before: body.before ?? null,
        }),
      );
    }
    if (action === 'search_memory' || action === 'read_memory') {
      const args = Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'action'));
      try {
        return json(await executeMemoryTool(client, subject, action, args));
      } catch (e) {
        if (
          e instanceof Error &&
          ['invalid_memory_arguments', 'unknown_memory_tool'].includes(e.message)
        ) return json({ error: e.message }, 400);
        throw e;
      }
    }
    const result = await memoryRpc(client, 'memory_control', {
      p_subject_id: subject,
      p_action: action,
      p_item_id: body.id ?? null,
      p_text: body.text ?? null,
      p_enabled: body.enabled ?? null,
      p_forget_on_chat_delete: body.forgetOnChatDelete ?? null,
    });
    if (action === 'retry') {
      (deps.background ?? keepAlive)(runMemoryJobs(client, subject, { getEnv }));
    }
    return json(result);
  } catch {
    return json({ error: 'memory_storage_unavailable' }, 503);
  }
}
if (runtime.Deno) runtime.Deno.serve((req) => handleMemoryRequest(req));
