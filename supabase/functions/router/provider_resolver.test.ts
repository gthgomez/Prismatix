import { describe, expect, it, vi } from 'vitest';
import { createProviderResolver } from './provider_resolver.ts';
import { providerRow, servingRouteFixture } from '../../../tests/helpers/serving-route-fixtures.ts';

const route = servingRouteFixture('openrouter', 'openai/gpt-6.2-sol');

describe('BYOK-only provider resolution', () => {
  it.each([
    ['revoked key', async () => null],
    ['empty decrypted key', async () => '  '],
    ['decrypt failure', async () => { throw new Error('fake decrypt failure'); }],
  ])('never dispatches after %s', async (_label, fetchRouteKey) => {
    const dispatch = vi.fn(async (key: string) => key);
    const resolver = createProviderResolver({ providers: [providerRow(route)] }, {
      globalEnabled: () => true,
      fetchRouteKey,
    });
    await expect(async () => dispatch(await resolver.resolveKey(route.provider, route))).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
