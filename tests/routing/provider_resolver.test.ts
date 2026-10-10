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
});
