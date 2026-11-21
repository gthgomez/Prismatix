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
  validateProviderKeyMetadata: (
    provider: string,
    apiKey: string,
    fetchFn?: typeof fetch,
  ) => Promise<{ status: string; message?: string }>;
  handleProviderSettings: (
    req: Request,
    deps: { getEnv: (k: string) => string | undefined; createClient: () => unknown; fetchFn?: typeof fetch },
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
  it('a fresh or legacy-OpenCode-default user gets OpenRouter BYOK', async () => {
    const mod = await loadModule({});
    const state = mod.buildProviderStates({ default_provider: 'opencode', providers: [] }, () => undefined);
    expect(state.providers.filter((p) => p.enabled).map((p) => p.id)).toEqual(['openrouter']);
    expect(state.defaultProvider).toBe('openrouter');
  });

  it('reports only user-stored key metadata even when a fake server key exists', async () => {
    const mod = await loadModule({});
    const state = mod.buildProviderStates(
      { default_provider: 'openrouter', providers: [{ provider: 'deepinfra', enabled: true, has_key: true, key_last4: 'abcd' }] },
      (k) => (k === 'OPENCODE_API_KEY' ? 'server-key' : undefined),
    );
    const byId = new Map(state.providers.map((p) => [p.id, p]));
    expect(byId.get('openrouter')?.enabled).toBe(true);
    expect(byId.get('deepinfra')?.enabled).toBe(true);
    expect(byId.get('deepinfra')?.hasKey).toBe(true);
    expect(byId.get('opencode')?.hasKey).toBe(false);
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

  it('allows only the BYOK OpenRouter gateway as the default', async () => {
    const mod = await loadModule(BASE_ENV);
    const calls: RpcCall[] = [];
    const ok = await invoke(mod, { action: 'set_default', provider: 'openrouter' }, BASE_ENV, 'user-1', calls);
    expect(ok.status).toBe(200);
    expect(calls.find((c) => c.fn === 'set_user_default_provider')!.params).toMatchObject({
      p_subject_id: 'user-1',
      p_provider: 'openrouter',
    });

    const bad = await invoke(mod, { action: 'set_default', provider: 'opencode' });
    expect(bad.status).toBe(400);
  });

  it('rejects opencode for enable and delete', async () => {
    const mod = await loadModule(BASE_ENV);
    expect((await invoke(mod, { action: 'set_enabled', provider: 'opencode', enabled: true })).status).toBe(400);
    expect((await invoke(mod, { action: 'delete_key', provider: 'opencode' })).status).toBe(400);
  });
});

describe('provider-settings — safe metadata key validation (F01)', () => {
  it('does not claim NVIDIA keys are verified when no metadata check exists', async () => {
    const mod = await loadModule(BASE_ENV);
    const mockFetch = vi.fn();
    const response = await mod.handleProviderSettings(
      post({ action: 'validate_key', provider: 'nvidia', apiKey: 'nvapi-synthetic-key' }),
      {
        getEnv: (k) => BASE_ENV[k],
        createClient: () => stubClient('user-1', []),
        fetchFn: mockFetch as unknown as typeof fetch,
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      provider: 'nvidia',
      status: 'unknown',
      message: 'A metadata verification check is not available in Prismatix for this provider.',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not expose unexpected draft or decrypted-key fetch exceptions', async () => {
    const mod = await loadModule(BASE_ENV);
    const secret = 'AIza-synthetic-google-secret';
    const rawError = `request failed for https://generativelanguage.googleapis.com/v1beta/models?key=${secret}`;
    const mockFetch = vi.fn(async () => { throw new Error(rawError); });
    const draftResponse = await mod.handleProviderSettings(
      post({ action: 'validate_key', provider: 'google', apiKey: secret }),
      {
        getEnv: (k) => BASE_ENV[k],
        createClient: () => stubClient('user-1', []),
        fetchFn: mockFetch as unknown as typeof fetch,
      },
    );
    const draftBody = await draftResponse.text();
    expect(draftResponse.status).toBe(200);
    expect(draftBody).toContain('"status":"unknown"');
    expect(draftBody).not.toContain(secret);
    expect(draftBody).not.toContain(rawError);

    const crypto = await import('../../supabase/functions/_shared/byok_crypto.ts');
    const stored = await crypto.encryptKey(secret);
    const savedResponse = await mod.handleProviderSettings(
      post({ action: 'validate_key', provider: 'google' }),
      {
        getEnv: (k) => BASE_ENV[k],
        createClient: () => ({
          auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
          rpc: async (fn: string) => fn === 'get_user_provider_key_material'
            ? { data: stored.ciphertext, error: null }
            : { data: null, error: null },
        }),
        fetchFn: mockFetch as unknown as typeof fetch,
      },
    );
    const savedBody = await savedResponse.text();
    expect(savedResponse.status).toBe(200);
    expect(savedBody).toContain('"status":"unknown"');
    expect(savedBody).not.toContain(secret);
    expect(savedBody).not.toContain(rawError);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps recognizable network failures unavailable without exposing their details', async () => {
    const mod = await loadModule(BASE_ENV);
    const secret = 'sk-synthetic-network-secret';
    const rawError = `fetch failed for key ${secret}`;
    const response = await mod.handleProviderSettings(
      post({ action: 'validate_key', provider: 'openai', apiKey: secret }),
      {
        getEnv: (k) => BASE_ENV[k],
        createClient: () => stubClient('user-1', []),
        fetchFn: vi.fn(async () => { throw new TypeError(rawError); }) as unknown as typeof fetch,
      },
    );
    const body = await response.text();
    expect(body).toContain('"status":"unavailable"');
    expect(body).toContain('Provider metadata check unreachable');
    expect(body).not.toContain(secret);
    expect(body).not.toContain(rawError);
  });

  it('reports a native metadata timeout as unavailable without exposing its message', async () => {
    const mod = await loadModule(BASE_ENV);
    const result = await mod.validateProviderKeyMetadata('openrouter', 'synthetic-key', vi.fn(async () => {
      throw new DOMException('The operation timed out with private details', 'TimeoutError');
    }) as unknown as typeof fetch);
    expect(result).toEqual({ status: 'unavailable', message: 'Provider metadata check unreachable' });
  });

  it('sends Google validation credentials in the existing x-goog-api-key header, not URL', async () => {
    const mod = await loadModule(BASE_ENV);
    const secret = 'AIza-synthetic-google-secret';
    const mockFetch = vi.fn(async () => new Response('{}', { status: 200 }));
    const result = await mod.validateProviderKeyMetadata('google', secret, mockFetch as unknown as typeof fetch);

    expect(result.status).toBe('enabled');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect(url).not.toContain(secret);
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe(secret);
  });

  it('validates a valid key via metadata endpoint without paid inference', async () => {
    const mod = await loadModule(BASE_ENV);
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ data: { label: 'my-key' } }), { status: 200 }));
    const res = await mod.handleProviderSettings(
      post({ action: 'validate_key', provider: 'openrouter', apiKey: 'sk-or-valid-test-key' }),
      {
        getEnv: (k) => BASE_ENV[k],
        createClient: () => stubClient('user-1', []),
        fetchFn: mockFetch as unknown as typeof fetch,
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      provider: 'openrouter',
      status: 'enabled',
    });
    // Never leaks the secret in the response body!
    expect(JSON.stringify(body)).not.toContain('sk-or-valid-test-key');
    expect(mockFetch).toHaveBeenCalledWith('https://openrouter.ai/api/v1/auth/key', expect.anything());
  });

  it('reports invalid_revoked when metadata endpoint returns 401/403', async () => {
    const mod = await loadModule(BASE_ENV);
    const mockFetch = vi.fn(async () => new Response('Unauthorized', { status: 401 }));
    const res = await mod.handleProviderSettings(
      post({ action: 'validate_key', provider: 'openai', apiKey: 'sk-openai-invalid-key' }),
      {
        getEnv: (k) => BASE_ENV[k],
        createClient: () => stubClient('user-1', []),
        fetchFn: mockFetch as unknown as typeof fetch,
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      provider: 'openai',
      status: 'invalid_revoked',
    });
  });

  it('reports unavailable on network failure or 5xx outage', async () => {
    const mod = await loadModule(BASE_ENV);
    const mockFetch = vi.fn(async () => new Response('Service Unavailable', { status: 503 }));
    const res = await mod.handleProviderSettings(
      post({ action: 'validate_key', provider: 'anthropic', apiKey: 'sk-ant-test-key' }),
      {
        getEnv: (k) => BASE_ENV[k],
        createClient: () => stubClient('user-1', []),
        fetchFn: mockFetch as unknown as typeof fetch,
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      provider: 'anthropic',
      status: 'unavailable',
    });
  });
});
