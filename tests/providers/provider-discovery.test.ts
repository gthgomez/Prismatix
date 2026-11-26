import { describe, expect, it, vi } from 'vitest';
import { discoverProviderInventory, normalizeProviderModels } from '../../supabase/functions/_shared/provider_discovery';
vi.stubGlobal('Deno', { env: { get: () => undefined }, serve: () => undefined });
const { buildProviderStates } = await import('../../supabase/functions/provider-settings/index');

const openRouterModel = { id: 'demo/model', name: 'Demo Model', context_length: 32000, top_provider: { max_completion_tokens: 4096 }, pricing: { prompt: '0.000001', completion: '0.000002' }, architecture: { input_modalities: ['text'] }, supported_parameters: ['tools'] };

describe('provider discovery', () => {
  it('preserves provider-qualified identities and converts catalog prices', () => {
    const routes = normalizeProviderModels('openrouter', { data: [openRouterModel] });
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ id: 'openrouter:demo/model', provider: 'openrouter', upstreamId: 'demo/model', canonicalId: 'demo/model', protocol: 'chat_completions', contextWindow: 32000, maxOutputTokens: 4096, supportsImages: false, supportsTools: true });
    expect(routes[0]?.tariff).toMatchObject({ inputPerMillion: 1, outputPerMillion: 2, source: 'https://openrouter.ai/docs/api/api-reference/models/list-models-for-user' });
  });

  it('does not qualify a model with unknown price', () => {
    expect(normalizeProviderModels('openrouter', { data: [{ id: 'unpriced' }] })).toEqual([]);
  });

  it('rejects malformed and empty catalogs without marking them verified', async () => {
    for (const body of [{ data: [] }, { nope: [] }]) {
      const inventory = await discoverProviderInventory('openai', 'fixture-key', { fetchFn: async () => new Response(JSON.stringify(body), { status: 200 }) });
      expect(inventory.status).toBe('unavailable');
      expect(inventory.discoveredAt).toBeNull();
    }
  });

  it('qualifies current direct OpenAI models with documented native protocol and tariff', () => {
    const routes = normalizeProviderModels('openai', { data: [{ id: 'gpt-6.2-sol' }] });
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ id: 'openai:gpt-6.2-sol', protocol: 'responses', contextWindow: 1_050_000, maxOutputTokens: 128_000, supportsTools: true });
    expect(routes[0]?.tariff).toMatchObject({ inputPerMillion: 2, outputPerMillion: 10, source: 'https://platform.openai.com/docs/models/gpt-6.2-sol' });
  });

  it('uses documented metadata calls and distinguishes forbidden credentials', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/auth/key')
      ? new Response(JSON.stringify({ data: { label: 'fixture key' } }), { status: 200 })
      : new Response(JSON.stringify({ data: [openRouterModel] }), { status: 200 }));
    const inventory = await discoverProviderInventory('openrouter', 'fixture-key', { fetchFn, now: new Date('2026-11-26T00:00:00Z') });
    expect(fetchFn).toHaveBeenCalledWith('https://openrouter.ai/api/v1/auth/key', expect.objectContaining({ headers: { Authorization: 'Bearer fixture-key' } }));
    expect(fetchFn).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models/user', expect.objectContaining({ headers: { Authorization: 'Bearer fixture-key' }, redirect: 'error' }));
    expect(inventory.status).toBe('verified');
    expect(inventory.routes).toHaveLength(1);
    const forbidden = await discoverProviderInventory('openai', 'fixture-key', { fetchFn: async () => new Response('', { status: 403 }) });
    expect(forbidden.status).toBe('restricted');
    const revoked = await discoverProviderInventory('openai', 'fixture-key', { fetchFn: async () => new Response('', { status: 401 }) });
    expect(revoked.status).toBe('invalid_revoked');
  });

  it('requires OpenCode Go authenticated usage entitlement and uses documented per-token pricing fields', async () => {
    const goModel = {
      id: 'fixture-go-model', name: 'Fixture Go Model', canonical_id: 'vendor/model', owned_by: 'opencode',
      last_updated: '2026-11-26', recommended_api: 'chat-completions', limit: { context: 128000, output: 8192 },
      modalities: { input: ['text'], output: ['text'] }, capabilities: { tools: { supported: true }, reasoning: { supported: true } },
      go: { training: false },
      cost: { text: { input: { price: 0.15, cache: { read: 0.003, write: 0.15 } }, output: { price: 0.6 } } },
    };
    const fetchFn = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/usage')
      ? new Response(JSON.stringify({ usage: { rolling: { status: 'ok', percent: 1 }, weekly: { status: 'ok', percent: 2 }, monthly: { status: 'ok', percent: 3 } } }), { status: 200 })
      : new Response(JSON.stringify({ data: [goModel] }), { status: 200 }));
    const inventory = await discoverProviderInventory('opencode_go', 'go-fixture-key', { fetchFn, now: new Date('2026-11-26T00:00:00Z') });
    expect(fetchFn).toHaveBeenCalledWith('https://opencode.ai/inference/go/v1/usage', expect.objectContaining({ redirect: 'error', headers: { Authorization: 'Bearer go-fixture-key' } }));
    expect(inventory.status).toBe('verified');
    expect(inventory.routes[0]).toMatchObject({ id: 'opencode_go:fixture-go-model', canonicalId: 'vendor/model', contextWindow: 128000, maxOutputTokens: 8192, protocol: 'chat_completions' });
    expect(inventory.routes[0]?.tariff).toMatchObject({ inputPerMillion: 0.15, outputPerMillion: 0.6, cachedReadPerMillion: 0.003, billing: 'subscription_allowance' });

    const noEntitlementFetch = vi.fn(async () => new Response(JSON.stringify({ type: 'error', error: { type: 'EntitlementError' } }), { status: 404 }));
    const noEntitlement = await discoverProviderInventory('opencode_go', 'go-no-plan', { fetchFn: noEntitlementFetch });
    expect(noEntitlement.status).toBe('restricted');
    expect(noEntitlementFetch).toHaveBeenCalledTimes(1);
  });

  it('authenticates the OpenCode Console list and distinguishes a restricted key', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 403 }));
    const inventory = await discoverProviderInventory('opencode', 'console-key', { fetchFn });
    expect(inventory.status).toBe('restricted');
    expect(fetchFn).toHaveBeenCalledWith('https://opencode.ai/inference/v1/models', expect.objectContaining({
      headers: { Authorization: 'Bearer console-key' }, redirect: 'error',
    }));
  });

  it('admits exact new OpenAI IDs from authenticated inventory plus compatible registry metadata', () => {
    const model = 'fixture-new-text-model';
    const metadata = new Map([[model, {
      id: model, modalities: { input: ['text'], output: ['text'] },
      limit: { context: 16000, output: 2000 }, cost: { input: 1, output: 3 },
    }]]);
    expect(normalizeProviderModels('openai', { data: [{ id: model }] }, metadata)).toMatchObject([{
      id: `openai:${model}`, protocol: 'responses', tariff: { source: 'https://models.dev/api.json' },
    }]);
    expect(normalizeProviderModels('openai', { data: [] }, metadata)).toEqual([]);
  });

  it('does not expose an unverified saved key as enabled or the default', () => {
    const state = buildProviderStates({ default_provider: 'openrouter', providers: [{ provider: 'openrouter', enabled: true, has_key: true, inventory: { status: 'unverified', routes: [] } }] }, () => undefined);
    expect(state.defaultProvider).toBeNull();
    expect(state.providers.find((p) => p.id === 'openrouter')?.enabled).toBe(false);
    expect(state.routes).toEqual([]);
  });
});
