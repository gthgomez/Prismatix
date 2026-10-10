import { describe, expect, it, vi } from 'vitest';
import {
  ProviderCredentialError,
  createProviderResolver,
  type ProviderResolverConfig,
} from '../../supabase/functions/router/provider_resolver.ts';
import type { Provider } from '../../supabase/functions/router/router_logic.ts';

function makeDeps(over: Partial<ProviderResolverConfig> = {}): ProviderResolverConfig {
  return {
    serverKey: () => undefined,
    globalEnabled: () => true,
    fetchUserKey: async () => null,
    ...over,
  };
}

describe('createProviderResolver', () => {
  it('only enables providers the user turned on', () => {
    const resolver = createProviderResolver(
      {
        default_provider: 'opencode',
        providers: [{ provider: 'anthropic', enabled: true, has_key: true }],
      },
      makeDeps({ serverKey: () => 'server-key' }),
    );

    expect(resolver.isEnabled('opencode')).toBe(true);
    expect(resolver.isEnabled('anthropic')).toBe(true);
    expect(resolver.isEnabled('openai')).toBe(false);
    expect(resolver.isReady('openai')).toBe(false);
  });

  it('respects the operator kill-switch', () => {
    const resolver = createProviderResolver(null, makeDeps({ globalEnabled: () => false }));
    expect(resolver.isEnabled('opencode')).toBe(false);
    expect(resolver.readyForModelTier('deepseek-v4-1-flash')).toBe(false);
  });

  it('prefers the user key (BYOK) over the server key', async () => {
    const fetchUserKey = vi.fn(async () => 'user-secret');
    const resolver = createProviderResolver(
      {
        default_provider: 'opencode',
        providers: [{ provider: 'anthropic', enabled: true, has_key: true }],
      },
      makeDeps({ serverKey: () => 'server-secret', fetchUserKey }),
    );

    await expect(resolver.resolveKey('anthropic')).resolves.toBe('user-secret');
    expect(fetchUserKey).toHaveBeenCalledWith('anthropic');
  });

  it('falls back to the server key when no user key is stored', async () => {
    const resolver = createProviderResolver(null, makeDeps({ serverKey: () => 'server-secret' }));
    await expect(resolver.resolveKey('opencode')).resolves.toBe('server-secret');
  });

  it('fails closed with ProviderCredentialError when no key resolves', async () => {
    const resolver = createProviderResolver(null, makeDeps());
    await expect(resolver.resolveKey('opencode' as Provider)).rejects.toBeInstanceOf(
      ProviderCredentialError,
    );
  });

  it('reports anyReady only when an enabled provider has credentials', () => {
    const noneReady = createProviderResolver(null, makeDeps());
    expect(noneReady.anyReady()).toBe(false);

    const serverReady = createProviderResolver(null, makeDeps({ serverKey: () => 'k' }));
    expect(serverReady.anyReady()).toBe(true);
  });

  it('flips the same provider between strict and empty state (differential)', () => {
    const deps = makeDeps({ serverKey: (p) => (p === 'openai' ? 'server-key' : undefined) });

    // Same server key, but the user config omits openai → suppressed.
    const configured = createProviderResolver(
      { default_provider: 'opencode', providers: [{ provider: 'anthropic', enabled: true, has_key: false }] },
      deps,
    );
    expect(configured.isEnabled('openai')).toBe(false);
    expect(configured.isReady('openai')).toBe(false);
  });

  it('treats an enabled-but-keyless provider as enabled but not ready', () => {
    const resolver = createProviderResolver(
      { default_provider: 'opencode', providers: [{ provider: 'openrouter', enabled: true, has_key: false }] },
      makeDeps(),
    );
    expect(resolver.isEnabled('openrouter')).toBe(true);
    expect(resolver.isReady('openrouter')).toBe(false);
  });

  it('readyForModelTier is true for a ready native provider', () => {
    const resolver = createProviderResolver(
      { default_provider: 'opencode', providers: [{ provider: 'anthropic', enabled: true, has_key: false }] },
      makeDeps({ serverKey: (p) => (p === 'anthropic' ? 'key' : undefined) }),
    );
    expect(resolver.readyForModelTier('sonnet-4.6')).toBe(true);
    // Unknown tier fails closed.
    expect(resolver.readyForModelTier('not-a-tier')).toBe(false);
  });

  it('refuses to resolve a key for a provider that is not enabled', async () => {
    const resolver = createProviderResolver(
      { default_provider: 'opencode', providers: [{ provider: 'anthropic', enabled: false, has_key: true }] },
      makeDeps({ serverKey: () => 'server-key', fetchUserKey: async () => 'user-key' }),
    );
    await expect(resolver.resolveKey('anthropic')).rejects.toBeInstanceOf(ProviderCredentialError);
  });
});
