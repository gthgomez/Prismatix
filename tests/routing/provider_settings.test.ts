// @vitest-environment node
// provider-settings edge function: per-user provider state + BYOK key handling.
import { describe, expect, it, vi } from 'vitest';

const ENTRY = ['../../supabase/functions/provider-settings/index.ts'].join('');
const BYOK_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

interface RpcCall {
  fn: string;
  params: Record<string, unknown>;
}

function installDenoStub(env: Record<string, string | undefined>): void {
  (globalThis as unknown as Record<string, unknown>).Deno = {
    env: { get: (key: string): string | undefined => env[key] },
    serve: (): void => {},
  };
}

async function loadModule(env: Record<string, string | undefined>): Promise<{
  buildProviderStates: (config: unknown, getEnv: (k: string) => string | undefined) => {
    providers: Array<{ id: string; enabled: boolean; hasKey: boolean; defaultProvider: boolean }>;
    defaultProvider: string;
  };
  handleProviderSettings: (
    req: Request,
    deps: { getEnv: (k: string) => string | undefined; createClient: () => unknown },
  ) => Promise<Response>;
}> {
  vi.resetModules();
  installDenoStub(env);
  return (await import(/* @vite-ignore */ ENTRY)) as never;
}

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

describe('provider-settings', () => {
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

  it('rejects an unauthenticated GET (401)', async () => {
    const env: Record<string, string | undefined> = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    const mod = await loadModule(env);
    const calls: RpcCall[] = [];
    const res = await mod.handleProviderSettings(new Request('http://x', { method: 'GET' }), {
      getEnv: (k) => env[k],
      createClient: () => stubClient(null, calls),
    });
    expect(res.status).toBe(401);
  });

  it('encrypts a connected key and never returns plaintext or ciphertext', async () => {
    const env: Record<string, string | undefined> = {
      SUPABASE_URL: 'http://x',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      BYOK_ENCRYPTION_KEY: BYOK_KEY,
    };
    const mod = await loadModule(env);
    const calls: RpcCall[] = [];
    const config = { default_provider: 'opencode', providers: [] };

    const res = await mod.handleProviderSettings(
      new Request('http://x', {
        method: 'POST',
        headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_key', provider: 'deepinfra', apiKey: 'di-secret-abcd' }),
      }),
      { getEnv: (k) => env[k], createClient: () => stubClient('user-1', calls, config) },
    );

    expect(res.status).toBe(200);
    const setCall = calls.find((c) => c.fn === 'set_user_provider_key');
    expect(setCall).toBeDefined();
    expect(String(setCall!.params.p_ciphertext)).not.toContain('di-secret');
    expect(setCall!.params.p_last4).toBe('abcd');

    const bodyText = JSON.stringify(await res.json());
    expect(bodyText).not.toContain('di-secret');
    expect(bodyText).not.toContain(String(setCall!.params.p_ciphertext));
  });

  it('passes the authenticated subject id, never a client-supplied one', async () => {
    const env: Record<string, string | undefined> = {
      SUPABASE_URL: 'http://x',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      BYOK_ENCRYPTION_KEY: BYOK_KEY,
    };
    const mod = await loadModule(env);
    const calls: RpcCall[] = [];
    await mod.handleProviderSettings(
      new Request('http://x', {
        method: 'POST',
        headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_enabled',
          provider: 'anthropic',
          enabled: true,
          subjectId: 'attacker',
        }),
      }),
      { getEnv: (k) => env[k], createClient: () => stubClient('real-user', calls, null) },
    );
    const call = calls.find((c) => c.fn === 'set_user_provider_enabled');
    expect(call!.params.p_subject_id).toBe('real-user');
  });
});
