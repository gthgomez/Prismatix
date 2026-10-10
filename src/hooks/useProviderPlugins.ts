// src/hooks/useProviderPlugins.ts
// Loads the signed-in user's provider plug-in state (which providers are on,
// which have keys, and which is the default gateway). Owns all mutations so the
// model picker and the settings panel share one source of truth.
//
// Server-authoritative: no optimistic state. A mutation returns a success
// boolean so callers can avoid discarding input on failure. Reloads when the
// account changes and drops stale responses.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  setEnabled: (provider: ProviderId, enabled: boolean) => Promise<boolean>;
  setKey: (provider: ProviderId, apiKey: string) => Promise<boolean>;
  removeKey: (provider: ProviderId) => Promise<boolean>;
  setDefault: (provider: ProviderId) => Promise<boolean>;
}

const OPENCODE: ProviderId = 'opencode';

export function useProviderPlugins(userId?: string | null): ProviderPlugins {
  const [payload, setPayload] = useState<ProviderSettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const seqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyPayload = useCallback((next: ProviderSettingsPayload) => {
    setPayload(next);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const next = await fetchProviderSettings();
      if (seq !== seqRef.current || !mountedRef.current) return;
      applyPayload(next);
    } catch (err) {
      if (seq !== seqRef.current || !mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'provider_settings_failed');
    } finally {
      if (seq === seqRef.current && mountedRef.current) setLoading(false);
    }
  }, [applyPayload]);

  // Reload when the account changes; clear state so the previous account's key
  // metadata is never shown for the next one.
  useEffect(() => {
    setPayload(null);
    void refresh();
  }, [refresh, userId]);

  const mutate = useCallback(
    async (fn: () => Promise<ProviderSettingsPayload>): Promise<boolean> => {
      const seq = ++seqRef.current;
      try {
        const next = await fn();
        if (seq !== seqRef.current || !mountedRef.current) return true;
        applyPayload(next);
        return true;
      } catch (err) {
        if (seq === seqRef.current && mountedRef.current) {
          setError(err instanceof Error ? err.message : 'provider_settings_failed');
        }
        return false;
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
