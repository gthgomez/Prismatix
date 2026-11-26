import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { useProviderPlugins, type ProviderKeySaveResult, type ProviderPlugins } from './useProviderPlugins';
import type { ProviderSettingsPayload } from '../types';
import { servingRouteFixture } from '../../tests/helpers/serving-route-fixtures';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../services/providerSettings', () => ({
  deleteProviderKey: vi.fn(),
  fetchProviderSettings: vi.fn(),
  setDefaultProvider: vi.fn(),
  setProviderEnabled: vi.fn(),
  setProviderKey: vi.fn(),
  validateProviderKey: vi.fn(),
}));

import { fetchProviderSettings, setProviderKey, validateProviderKey } from '../services/providerSettings';

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
    inventoryStatus: 'verified',
    lastSuccessfulRefresh: new Date().toISOString(),
    availableModelCount: 1,
    qualifiedModelCount: 1,
  }],
  defaultProvider: 'openrouter',
  routes: [servingRouteFixture('openrouter', 'google/gemini-3.8-flash')],
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

  it('can resolve first-run OpenRouter recovery without certifying an unsupported enabled provider', async () => {
    vi.mocked(fetchProviderSettings).mockResolvedValue({
      providers: [
        configuredPayload.providers[0]!,
        {
          id: 'nvidia', label: 'NVIDIA', enabled: true, hasKey: true, keyLast4: '5678',
          offeredByDefault: false, defaultProvider: false, status: 'enabled',
        },
      ],
      defaultProvider: 'openrouter',
      routes: [],
    });
    vi.mocked(validateProviderKey).mockImplementation(async (_userId, provider) => ({
      provider,
      status: provider === 'openrouter' ? 'enabled' : 'unknown',
      message: provider === 'nvidia' ? 'No safe metadata check exists.' : undefined,
    }));
    root = createRoot(container);
    await act(async () => root!.render(<Harness userId='account-a' />));

    let allVerified = true;
    await act(async () => { allVerified = await result!.verifyEnabledProviders(); });
    expect(allVerified).toBe(false);
    expect(result?.isVerified).toBe(false);

    let openRouterVerified = false;
    await act(async () => { openRouterVerified = await result!.verifyEnabledProviders('openrouter'); });
    expect(openRouterVerified).toBe(true);
    expect(result?.isVerified).toBe(false);
    expect(result?.verifiedProviders?.has('openrouter')).toBe(true);
    expect(result?.verifiedProviders?.has('nvidia')).toBe(false);
  });

  it('does not treat the old backend saved-only response as a verified NVIDIA key', async () => {
    vi.mocked(fetchProviderSettings).mockResolvedValue({
      providers: [{
        id: 'nvidia', label: 'NVIDIA', enabled: true, hasKey: true, keyLast4: '5678',
        offeredByDefault: false, defaultProvider: false, status: 'enabled',
      }],
      defaultProvider: 'openrouter',
      routes: [],
    });
    vi.mocked(validateProviderKey).mockResolvedValue({ provider: 'nvidia', status: 'enabled', message: 'Key saved' });
    root = createRoot(container);
    await act(async () => root!.render(<Harness userId='account-a' />));

    let verified = true;
    await act(async () => { verified = await result!.verifyEnabledProviders(); });
    expect(verified).toBe(false);
    expect(result?.verifiedProviders?.has('nvidia')).toBe(false);
    expect(result?.providers[0]?.status).toBe('unknown');
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

  it('does not save a key using a validation result from a previous account', async () => {
    vi.mocked(validateProviderKey).mockResolvedValue({ provider: 'openrouter', status: 'enabled' });
    vi.mocked(setProviderKey).mockResolvedValue(configuredPayload);
    root = createRoot(container);
    await act(async () => root!.render(<Harness userId='account-a' />));

    let validation!: Awaited<ReturnType<ProviderPlugins['validateKey']>>;
    await act(async () => { validation = await result!.validateKey('openrouter', 'sk-account-a-key'); });
    expect(validation.status).toBe('enabled');

    await act(async () => root!.render(<Harness userId='account-b' />));
    let saved: ProviderKeySaveResult = { saved: true, verified: false };
    await act(async () => { saved = await result!.setKey('openrouter', 'sk-account-a-key', validation); });

    expect(saved.saved).toBe(false);
    expect(setProviderKey).not.toHaveBeenCalled();
    expect(result?.isVerified).toBe(false);
  });

  it('does not accept unscoped validation evidence as verified when saving a key', async () => {
    vi.mocked(setProviderKey).mockResolvedValue(configuredPayload);
    root = createRoot(container);
    await act(async () => root!.render(<Harness userId='account-a' />));

    let saved: ProviderKeySaveResult = { saved: true, verified: false };
    await act(async () => {
      saved = await result!.setKey('openrouter', 'sk-unscoped-key', { status: 'enabled' });
    });

    expect(saved.saved).toBe(false);
    expect(setProviderKey).not.toHaveBeenCalled();
    expect(result?.isVerified).toBe(false);
  });

  it('uses verified account inventory returned after a save as authoritative readiness', async () => {
    vi.mocked(setProviderKey).mockResolvedValue(configuredPayload);
    root = createRoot(container);
    await act(async () => root!.render(<Harness userId='account-a' />));

    let saved: ProviderKeySaveResult = { saved: false, verified: false };
    await act(async () => { saved = await result!.setKey('openrouter', 'sk-unchecked-key'); });

    expect(saved).toEqual(expect.objectContaining({ saved: true, verified: true, inventoryStatus: 'verified', qualifiedModelCount: 1 }));
    expect(setProviderKey).toHaveBeenCalledWith('openrouter', 'sk-unchecked-key', 'account-a');
    expect(result?.verificationStatus).toBe('verified');
    expect(result?.verifiedProviders?.has('openrouter')).toBe(true);
  });

});
