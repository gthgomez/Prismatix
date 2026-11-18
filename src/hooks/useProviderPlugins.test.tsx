import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { useProviderPlugins, type ProviderPlugins } from './useProviderPlugins';
import type { ProviderSettingsPayload } from '../types';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../services/providerSettings', () => ({
  deleteProviderKey: vi.fn(),
  fetchProviderSettings: vi.fn(),
  setDefaultProvider: vi.fn(),
  setProviderEnabled: vi.fn(),
  setProviderKey: vi.fn(),
  validateProviderKey: vi.fn(),
}));

import { fetchProviderSettings, validateProviderKey } from '../services/providerSettings';

const configuredPayload: ProviderSettingsPayload = {
  providers: [{
    id: 'openrouter',
    label: 'OpenRouter',
    enabled: true,
    hasKey: true,
    keyLast4: '1234',
    offeredByDefault: true,
    defaultProvider: true,
    status: 'enabled',
  }],
  defaultProvider: 'openrouter',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe('useProviderPlugins account-scoped verification', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let result: ProviderPlugins | null = null;

  function Harness({ userId }: { userId: string }) {
    result = useProviderPlugins(userId);
    return null;
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    result = null;
    vi.mocked(fetchProviderSettings).mockResolvedValue(configuredPayload);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    container.remove();
    vi.clearAllMocks();
  });

  it('discards a prior account verification and remains unverified until the new account check finishes', async () => {
    const oldCheck = deferred<Awaited<ReturnType<typeof validateProviderKey>>>();
    vi.mocked(validateProviderKey)
      .mockReturnValueOnce(oldCheck.promise)
      .mockResolvedValueOnce({ provider: 'openrouter', status: 'enabled' });

    root = createRoot(container);
    await act(async () => {
      root!.render(<Harness userId='account-a' />);
      await Promise.resolve();
    });
    expect(result?.isConfigured).toBe(true);
    expect(result?.isVerified).toBe(false);

    let oldVerification!: Promise<boolean>;
    await act(async () => {
      oldVerification = result!.verifyEnabledProviders();
      await Promise.resolve();
    });
    expect(result?.verificationLoading).toBe(true);

    await act(async () => {
      root!.render(<Harness userId='account-b' />);
      await Promise.resolve();
    });
    expect(result?.isConfigured).toBe(true);
    expect(result?.isVerified).toBe(false);
    expect(result?.verificationStatus).toBe('unverified');
    expect(result?.verificationLoading).toBe(false);

    let oldResult = true;
    await act(async () => {
      oldCheck.resolve({ provider: 'openrouter', status: 'enabled' });
      oldResult = await oldVerification;
    });
    expect(oldResult).toBe(false);
    expect(result?.isVerified).toBe(false);
    expect(result?.verificationStatus).toBe('unverified');
    expect(result?.verificationLoading).toBe(false);

    let newResult = false;
    await act(async () => {
      newResult = await result!.verifyEnabledProviders();
    });
    expect(newResult).toBe(true);
    expect(result?.isVerified).toBe(true);
    expect(result?.verificationStatus).toBe('verified');
  });
  it('does not apply the result of testing a draft key to a saved key', async () => {
    vi.mocked(validateProviderKey).mockResolvedValue({ provider: 'openrouter', status: 'enabled' });
    root = createRoot(container);
    await act(async () => root!.render(<Harness userId='account-a' />));

    await act(async () => { await result!.validateKey('openrouter', 'sk-synthetic-draft'); });
    expect(result?.verificationStatus).toBe('unverified');
    expect(result?.verifiedProviders?.has('openrouter')).toBe(false);

    await act(async () => { await result!.validateKey('openrouter'); });
    expect(result?.verificationStatus).toBe('verified');
    expect(result?.verifiedProviders?.has('openrouter')).toBe(true);
  });

});
