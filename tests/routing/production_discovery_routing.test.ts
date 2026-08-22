import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveProductionRoute,
  DEFAULT_OPENCODE_BASE_URL,
} from '../../supabase/functions/router/production_routing.ts';
import { resetDiscoveryCacheForTests } from '../../supabase/functions/router/opencode_discovery.ts';
import type { RouterParams } from '../../supabase/functions/router/router_logic.ts';

function baseParams(over: Partial<RouterParams> = {}): RouterParams {
  return {
    userQuery: 'hi',
    currentSessionTokens: 0,
    platform: 'web',
    history: [],
    ...over,
  };
}

describe('production discovery routing integration', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetDiscoveryCacheForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetDiscoveryCacheForTests();
  });

  it('uses live discovery to pick OpenCode fallback when primary is absent from gateway', async () => {
    const discoveryPayload = {
      data: ['gpt-5.6-luna', 'gemini-3.7-flash', 'claude-sonnet-5'],
    };

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe(`${DEFAULT_OPENCODE_BASE_URL}/models`);
      return new Response(JSON.stringify(discoveryPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const decision = await resolveProductionRoute(baseParams(), undefined, {
      openCodePrimary: true,
      openCodeApiKey: 'test-opencode-key',
      openCodeBaseUrl: DEFAULT_OPENCODE_BASE_URL,
    });

    expect(decision.modelTier).toBe('gpt-5.6-luna');
    expect(decision.routeRole).toBe('economy');
    expect(decision.rationaleTag).toBe('opencode-economy');
  });

  it('falls back to legacy providers when discovery returns no curated models', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ data: ['unrelated-model-only'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const decision = await resolveProductionRoute(baseParams(), undefined, {
      openCodePrimary: true,
      openCodeApiKey: 'test-opencode-key',
    });

    expect(decision.modelTier).toBe('qwen3-235b');
    expect(decision.rationaleTag).toBe('economy-fallback');
  });

  it('skips discovery fetch when OpenCode is not primary', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;

    const decision = await resolveProductionRoute(baseParams(), undefined, {
      openCodePrimary: false,
      openCodeApiKey: 'ignored',
    });

    expect(fetchCalled).toBe(false);
    expect(decision.modelTier).toBe('qwen3-235b');
  });
});
