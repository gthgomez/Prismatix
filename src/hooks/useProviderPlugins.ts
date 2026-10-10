// src/hooks/useProviderPlugins.ts
// Loads the signed-in user's provider plug-in state (which providers are on,
// which have keys, and which is the default gateway). Owns all mutations so the
// model picker and the settings panel share one source of truth.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProviderSettingsPayload, ProviderState } from '../types';
import type { ProviderId } from '../providerRegistry';
import {
  deleteProviderKey,
  fetchProviderSettings,
  setDefaultProvider,
  setProviderEnabled,
  setProviderKey,
} from '../services/providerSettings';

export interface ProviderPlugins {
  providers: ProviderState[];
  defaultProvider: ProviderId | null;
  enabledProviders: ReadonlySet<ProviderId>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setEnabled: (provider: ProviderId, enabled: boolean) => Promise<void>;
  setKey: (provider: ProviderId, apiKey: string) => Promise<void>;
  removeKey: (provider: ProviderId) => Promise<void>;
  setDefault: (provider: ProviderId) => Promise<void>;
}

const OPENCODE: ProviderId = 'opencode';

export function useProviderPlugins(): ProviderPlugins {
  const [payload, setPayload] = useState<ProviderSettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyPayload = useCallback((next: ProviderSettingsPayload) => {
    setPayload(next);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      applyPayload(await fetchProviderSettings());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'provider_settings_failed');
    } finally {
      setLoading(false);
    }
  }, [applyPayload]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (fn: () => Promise<ProviderSettingsPayload>) => {
      try {
        applyPayload(await fn());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'provider_settings_failed');
      }
    },
    [applyPayload],
  );

  const providers = payload?.providers ?? [];

  // Fail safe: until state loads, expose OpenCode only so the picker is never
  // empty and auto-routing stays on the default gateway.
  const enabledProviders = useMemo<ReadonlySet<ProviderId>>(() => {
    if (!payload) return new Set<ProviderId>([OPENCODE]);
    return new Set(payload.providers.filter((p) => p.enabled).map((p) => p.id));
  }, [payload]);

  return {
    providers,
    defaultProvider: payload?.defaultProvider ?? null,
    enabledProviders,
    loading,
    error,
    refresh,
    setEnabled: (provider, enabled) => mutate(() => setProviderEnabled(provider, enabled)),
    setKey: (provider, apiKey) => mutate(() => setProviderKey(provider, apiKey)),
    removeKey: (provider) => mutate(() => deleteProviderKey(provider)),
    setDefault: (provider) => mutate(() => setDefaultProvider(provider)),
  };
}
