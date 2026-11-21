import { afterEach, describe, expect, it, vi } from 'vitest';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession } } }));

import {
  deleteProviderKey,
  fetchProviderSettings,
  setDefaultProvider,
  setProviderEnabled,
  setProviderKey,
  validateProviderKey,
} from './providerSettings';

const operations = [
  ['fetch settings', () => fetchProviderSettings('account-a')],
  ['validate key', () => validateProviderKey('account-a', 'openrouter', 'sk-key')],
  ['save key', () => setProviderKey('openrouter', 'sk-key', 'account-a')],
  ['toggle provider', () => setProviderEnabled('openrouter', true, 'account-a')],
  ['remove key', () => deleteProviderKey('openrouter', 'account-a')],
  ['set default', () => setDefaultProvider('openrouter', 'account-a')],
] as const;

describe('provider settings account binding', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getSession.mockReset();
  });

  it.each(operations)('does not dispatch %s with a different account session', async (_name, operation) => {
    getSession.mockResolvedValue({
      data: { session: { access_token: 'account-b-token', user: { id: 'account-b' } } },
      error: null,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

    await expect(operation()).rejects.toThrow(/account_changed/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
