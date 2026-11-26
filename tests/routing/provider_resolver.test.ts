import { describe, expect, it, vi } from 'vitest';
import { createProviderResolver, ProviderCredentialError, ProviderKeyUnavailableError } from '../../supabase/functions/router/provider_resolver.ts';
import { providerRow, servingRouteFixture } from '../helpers/serving-route-fixtures.ts';

const route = servingRouteFixture();
const config = { providers: [providerRow(route)] };
const globalEnabled = () => true;

describe('provider resolver', () => {
  it('authorizes only the selected account route and its current revision', async () => {
    const fetchRouteKey = vi.fn(async () => 'fixture-key');
    const resolver = createProviderResolver(config, { globalEnabled, fetchRouteKey });
    expect(resolver.eligibleRoutes()).toEqual([route]);
    await expect(resolver.resolveKey(route.provider, route)).resolves.toBe('fixture-key');
    expect(fetchRouteKey).toHaveBeenCalledExactlyOnceWith(route.provider, 'fixture-revision', route.id);
  });

  it.each([
    ['fresh', null],
    ['preference only', { default_provider: 'openai' }],
    ['keyless', { providers: [{ ...providerRow(route), has_key: false }] }],
    ['disabled', { providers: [providerRow(route, false)] }],
    ['unverified', { providers: [{ ...providerRow(route), inventory: null }] }],
    ['stale', { providers: [{ ...providerRow(route), inventory: { ...providerRow(route).inventory, discoveredAt: '2025-01-01T00:00:00Z' } }] }],
    ['restricted', { providers: [{ ...providerRow(route), inventory: { ...providerRow(route).inventory, restrictedRouteIds: [route.id] } }] }],
  ])('keeps %s account routes out of dispatch', async (_name, providerConfig) => {
    const fetchRouteKey = vi.fn(async () => 'fixture-key');
    const resolver = createProviderResolver(providerConfig, { globalEnabled, fetchRouteKey });
    expect(resolver.anyReady()).toBe(false);
    expect(resolver.eligibleRoutes()).toEqual([]);
    await expect(resolver.resolveKey(route.provider, route)).rejects.toBeInstanceOf(ProviderCredentialError);
    expect(fetchRouteKey).not.toHaveBeenCalled();
  });

  it('applies the operator switch to a verified account', () => {
    expect(createProviderResolver(config, { globalEnabled: () => false }).anyReady()).toBe(false);
  });

  it('fails closed when the final database read rejects a stale revision', async () => {
    const resolver = createProviderResolver(config, { globalEnabled, fetchRouteKey: async () => null });
    await expect(resolver.resolveKey('openai', route)).rejects.toBeInstanceOf(ProviderCredentialError);
  });

  it('fails closed on unavailable key material', async () => {
    const resolver = createProviderResolver(config, { globalEnabled, fetchRouteKey: async () => { throw new Error('unavailable'); } });
    await expect(resolver.resolveKey('openai', route)).rejects.toBeInstanceOf(ProviderKeyUnavailableError);
  });
});
