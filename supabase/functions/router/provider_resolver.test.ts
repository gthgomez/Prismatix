import { describe, expect, it, vi } from 'vitest';
import { createProviderResolver, ProviderCredentialError } from './provider_resolver.ts';

const openRouterConfig = (hasKey: boolean) => ({
  default_provider: 'openrouter',
  providers: [{ provider: 'openrouter', enabled: true, has_key: hasKey }],
});

describe('BYOK-only provider resolution', () => {
  it('does not consider or resolve a deployment key when the user has no key', async () => {
    const fetchUserKey = vi.fn(async () => null);
    const dispatch = vi.fn(async (key: string) => key);
    const resolver = createProviderResolver(openRouterConfig(false), {
      globalEnabled: () => true,
      fetchUserKey,
    });

    expect(resolver.hasCredentials('openrouter')).toBe(false);
    expect(resolver.isReady('openrouter')).toBe(false);
    await expect(resolver.resolveKey('openrouter')).rejects.toBeInstanceOf(ProviderCredentialError);
    expect(fetchUserKey).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ['revoked key', async () => null],
    ['empty decrypted key', async () => '  '],
    ['decrypt failure', async () => { throw new Error('fake decrypt failure'); }],
    ['key lookup failure', async () => { throw new Error('fake lookup failure'); }],
  ])('never dispatches with a server key after %s', async (_label, fetchUserKey) => {
    const dispatch = vi.fn(async (key: string) => key);
    const resolver = createProviderResolver(openRouterConfig(true), {
      globalEnabled: () => true,
      fetchUserKey,
    });

    await expect(async () => dispatch(await resolver.resolveKey('openrouter'))).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches only with a valid user key, even when a fake server key exists', async () => {
    const dispatch = vi.fn(async (key: string) => key);
    const resolver = createProviderResolver(openRouterConfig(true), {
      globalEnabled: () => true,
      fetchUserKey: async () => 'fake-user-key',
    });

    expect(await dispatch(await resolver.resolveKey('openrouter'))).toBe('fake-user-key');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('fake-user-key');
  });
});
