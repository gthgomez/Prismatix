// @vitest-environment node
// provider-settings edge function: per-user provider state + BYOK key handling.
import { describe, expect, it, vi } from 'vitest';

const ENTRY = ['../../supabase/functions/provider-settings/index.ts'].join('');
const BYOK_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

interface RpcCall {
  fn: string;
  params: Record<string, unknown>;
}

type Loaded = {
  buildProviderStates: (config: unknown, getEnv: (k: string) => string | undefined) => {
    providers: Array<{ id: string; enabled: boolean; hasKey: boolean; defaultProvider: boolean }>;
    defaultProvider: string;
  };
  handleProviderSettings: (
    req: Request,
    deps: { getEnv: (k: string) => string | undefined; createClient: () => unknown },
  ) => Promise<Response>;
};

function installDenoStub(env: Record<string, string | undefined>): void {
  (globalThis as unknown as Record<string, unknown>).Deno = {
    env: { get: (key: string): string | undefined => env[key] },
    serve: (): void => {},
  };
}

async function loadModule(env: Record<string, string | undefined>): Promise<Loaded> {
  vi.resetModules();
  installDenoStub(env);
  return (await import(/* @vite-ignore */ ENTRY)) as unknown as Loaded;
}

const BASE_ENV: Record<string, string | undefined> = {
  SUPABASE_URL: 'http://x',
  SUPABASE_SERVICE_ROLE_KEY: 'k',
  BYOK_ENCRYPTION_KEY: BYOK_KEY,
};

function stubClient(userId: string | null, calls: RpcCall[], config: unknown = null) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: userId ? null : { message: 'invalid' },
      }),
    },
    rpc: async (fn: string, params: Record<string, unknown>) => {
      calls.push({ fn, params });
      if (fn === 'get_user_provider_config') return { data: config };
      return { data: null, error: null };
    },
  };
}

function post(body: unknown): Request {
  return new Request('http://x', {
    method: 'POST',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function invoke(
  mod: Loaded,
  body: unknown,
  env: Record<string, string | undefined> = BASE_ENV,
  userId: string | null = 'user-1',
  calls: RpcCall[] = [],
  config: unknown = null,
): Promise<Response> {
  return mod.handleProviderSettings(post(body), {
    getEnv: (k) => env[k],
    createClient: () => stubClient(userId, calls, config),
  });
}

describe('provider-settings — state', () => {
  it('a fresh user (no rows) has only opencode enabled', async () => {
    const mod = await loadModule({});
    const state = mod.buildProviderStates({ default_provider: 'opencode', providers: [] }, () => undefined);
    expect(state.providers.filter((p) => p.enabled).map((p) => p.id)).toEqual(['opencode']);
    expect(state.defaultProvider).toBe('opencode');
  });

  it('opts in to openrouter as the chosen default and reports server keys', async () => {
    const mod = await loadModule({});
    const state = mod.buildProviderStates(
      { default_provider: 'openrouter', providers: [{ provider: 'deepinfra', enabled: true, has_key: true, key_last4: 'abcd' }] },
      (k) => (k === 'OPENCODE_API_KEY' ? 'server-key' : undefined),
    );
    const byId = new Map(state.providers.map((p) => [p.id, p]));
    expect(byId.get('openrouter')?.enabled).toBe(true);
    expect(byId.get('deepinfra')?.enabled).toBe(true);
    expect(byId.get('deepinfra')?.hasKey).toBe(true);
    expect(byId.get('opencode')?.hasKey).toBe(true);
    expect(byId.get('openrouter')?.defaultProvider).toBe(true);
  });
});

describe('provider-settings — auth and transport', () => {
  it('rejects an unauthenticated GET (401)', async () => {
    const mod = await loadModule(BASE_ENV);
    const res = await mod.handleProviderSettings(new Request('http://x', { method: 'GET' }), {
      getEnv: (k) => BASE_ENV[k],
      createClient: () => stubClient(null, []),
    });
    expect(res.status).toBe(401);
  });

  it('returns 500 when the deployment is misconfigured', async () => {
    const mod = await loadModule({});
    const res = await mod.handleProviderSettings(new Request('http://x', { method: 'GET' }), {
      getEnv: () => undefined,
      createClient: () => stubClient('user-1', []),
    });
    expect(res.status).toBe(500);
  });

  it('rejects an unsupported method (405)', async () => {
    const mod = await loadModule(BASE_ENV);
    const res = await mod.handleProviderSettings(
      new Request('http://x', { method: 'PUT', headers: { Authorization: 'Bearer token' } }),
      {
        getEnv: (k) => BASE_ENV[k],
        createClient: () => stubClient('user-1', []),
      },
    );
    expect(res.status).toBe(405);
  });

  it('rejects invalid JSON (400)', async () => {
    const mod = await loadModule(BASE_ENV);
    const res = await invoke(mod, '{not json');
    expect(res.status).toBe(400);
  });

  it('rejects an unknown action (400)', async () => {
    const mod = await loadModule(BASE_ENV);
    const res = await invoke(mod, { action: 'nope' });
    expect(res.status).toBe(400);
  });
});

describe('provider-settings — key handling', () => {
  it('encrypts a connected key and never returns plaintext or ciphertext', async () => {
    const mod = await loadModule(BASE_ENV);
    const calls: RpcCall[] = [];
    const res = await invoke(
      mod,
      { action: 'set_key', provider: 'deepinfra', apiKey: 'di-secret-abcd' },
      BASE_ENV,
      'user-1',
      calls,
      { default_provider: 'opencode', providers: [] },
    );

    expect(res.status).toBe(200);
    const setCall = calls.find((c) => c.fn === 'set_user_provider_key');
    expect(String(setCall!.params.p_ciphertext)).not.toContain('di-secret');
    expect(setCall!.params.p_last4).toBe('abcd');

    const bodyText = JSON.stringify(await res.json());
    expect(bodyText).not.toContain('di-secret');
    expect(bodyText).not.toContain(String(setCall!.params.p_ciphertext));
  });

  it('rejects a key shorter than 8 chars (400)', async () => {
    const mod = await loadModule(BASE_ENV);
    expect((await invoke(mod, { action: 'set_key', provider: 'deepinfra', apiKey: 'short' })).status).toBe(400);
  });

  it('rejects an over-length key (400)', async () => {
    const mod = await loadModule(BASE_ENV);
    const long = 'a'.repeat(600);
    expect((await invoke(mod, { action: 'set_key', provider: 'deepinfra', apiKey: long })).status).toBe(400);
  });

  it('fails closed with 500 when BYOK is not configured', async () => {
    const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    const mod = await loadModule(env);
    const res = await invoke(mod, { action: 'set_key', provider: 'deepinfra', apiKey: 'di-secret-abcd' }, env);
    expect(res.status).toBe(500);
  });

  it('rejects setting a key for opencode (server-managed)', async () => {
    const mod = await loadModule(BASE_ENV);
    expect((await invoke(mod, { action: 'set_key', provider: 'opencode', apiKey: 'di-secret-abcd' })).status).toBe(400);
  });
});

describe('provider-settings — enable / default / delete', () => {
  it('forwards provider + enabled, and the authenticated subject id only', async () => {
    const mod = await loadModule(BASE_ENV);
    const calls: RpcCall[] = [];
    await invoke(
      mod,
      { action: 'set_enabled', provider: 'anthropic', enabled: true, subjectId: 'attacker' },
      BASE_ENV,
      'real-user',
      calls,
    );
    const call = calls.find((c) => c.fn === 'set_user_provider_enabled');
    expect(call!.params).toMatchObject({
      p_subject_id: 'real-user',
      p_provider: 'anthropic',
      p_enabled: true,
    });
  });

  it('deletes a key for the authenticated subject', async () => {
    const mod = await loadModule(BASE_ENV);
    const calls: RpcCall[] = [];
    const res = await invoke(mod, { action: 'delete_key', provider: 'deepinfra' }, BASE_ENV, 'user-1', calls);
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.fn === 'delete_user_provider_key')!.params).toMatchObject({
      p_subject_id: 'user-1',
      p_provider: 'deepinfra',
    });
  });

  it('sets the default provider (opencode or openrouter only)', async () => {
    const mod = await loadModule(BASE_ENV);
    const calls: RpcCall[] = [];
    const ok = await invoke(mod, { action: 'set_default', provider: 'opencode' }, BASE_ENV, 'user-1', calls);
    expect(ok.status).toBe(200);
    expect(calls.find((c) => c.fn === 'set_user_default_provider')!.params).toMatchObject({
      p_subject_id: 'user-1',
      p_provider: 'opencode',
    });

    const bad = await invoke(mod, { action: 'set_default', provider: 'anthropic' });
    expect(bad.status).toBe(400);
  });

  it('rejects opencode for enable and delete', async () => {
    const mod = await loadModule(BASE_ENV);
    expect((await invoke(mod, { action: 'set_enabled', provider: 'opencode', enabled: true })).status).toBe(400);
    expect((await invoke(mod, { action: 'delete_key', provider: 'opencode' })).status).toBe(400);
  });
});
