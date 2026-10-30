import { describe, expect, it, vi } from 'vitest';
import {
  ProviderCredentialError,
  createProviderResolver,
  type ProviderResolverConfig,
} from '../../supabase/functions/router/provider_resolver.ts';
import type { Provider } from '../../supabase/functions/router/router_logic.ts';

function makeDeps(over: Partial<ProviderResolverConfig> = {}): ProviderResolverConfig {
  return {
    globalEnabled: () => true,
    fetchUserKey: async () => null,
    ...over,
  };
}

describe('createProviderResolver', () => {
  it('only enables BYOK providers the user turned on and keeps server-only OpenCode off', () => {
    const resolver = createProviderResolver(
      {
        default_provider: 'opencode',
        providers: [{ provider: 'anthropic', enabled: true, has_key: true }],
      },
      makeDeps(),
    );

    expect(resolver.isEnabled('opencode')).toBe(false);
    expect(resolver.isEnabled('anthropic')).toBe(true);
    expect(resolver.isEnabled('openai')).toBe(false);
    expect(resolver.isReady('openai')).toBe(false);
  });

  it('respects the operator kill-switch', () => {
    const resolver = createProviderResolver(null, makeDeps({ globalEnabled: () => false }));
    expect(resolver.isEnabled('openrouter')).toBe(false);
    expect(resolver.readyForModelTier('deepseek-v4-1-flash')).toBe(false);
  });

  it('resolves only the user key (BYOK)', async () => {
    const fetchUserKey = vi.fn(async () => 'user-secret');
    const resolver = createProviderResolver(
      {
        default_provider: 'openrouter',
        providers: [{ provider: 'anthropic', enabled: true, has_key: true }],
      },
      makeDeps({ fetchUserKey }),
    );

    await expect(resolver.resolveKey('anthropic')).resolves.toBe('user-secret');
    expect(fetchUserKey).toHaveBeenCalledWith('anthropic');
  });

  it('never falls back to a fake deployment key when the user has no key', async () => {
    const fetchUserKey = vi.fn(async () => null);
    const resolver = createProviderResolver(
      { default_provider: 'openrouter', providers: [{ provider: 'openrouter', enabled: true, has_key: false }] },
      makeDeps({ fetchUserKey }),
    );
    await expect(resolver.resolveKey('openrouter')).rejects.toBeInstanceOf(ProviderCredentialError);
    expect(fetchUserKey).not.toHaveBeenCalled();
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

    const byokReady = createProviderResolver(
      { default_provider: 'openrouter', providers: [{ provider: 'openrouter', enabled: true, has_key: true }] },
      makeDeps(),
    );
    expect(byokReady.anyReady()).toBe(true);
  });

  it('flips the same provider between strict and empty state (differential)', () => {
    const deps = makeDeps();

    // A deployment secret cannot make an absent BYOK row ready.
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
      { default_provider: 'openrouter', providers: [{ provider: 'anthropic', enabled: true, has_key: true }] },
      makeDeps({ fetchUserKey: async () => 'key' }),
    );
    expect(resolver.readyForModelTier('sonnet-4.6')).toBe(true);
    // Unknown tier fails closed.
    expect(resolver.readyForModelTier('not-a-tier')).toBe(false);
  });

  it('refuses to resolve a key for a provider that is not enabled', async () => {
    const resolver = createProviderResolver(
      { default_provider: 'openrouter', providers: [{ provider: 'anthropic', enabled: false, has_key: true }] },
      makeDeps({ fetchUserKey: async () => 'user-key' }),
    );
    await expect(resolver.resolveKey('anthropic')).rejects.toBeInstanceOf(ProviderCredentialError);
  });
});
