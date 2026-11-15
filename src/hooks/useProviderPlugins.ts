// src/hooks/useProviderPlugins.ts
// Loads the signed-in user's provider plug-in state (which providers are on,
// which have keys, and which is the default gateway). Owns all mutations so the
// model picker and the settings panel share one source of truth.
//
// Server-authoritative: no optimistic state. A mutation returns a success
// boolean so callers can avoid discarding input on failure. Reloads when the
// account changes and drops stale responses.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderKeyStatus, ProviderSettingsPayload, ProviderState } from '../types';
import type { ProviderId } from '../providerRegistry';
import {
  deleteProviderKey,
  fetchProviderSettings,
  setDefaultProvider,
  setProviderEnabled,
  setProviderKey,
  validateProviderKey,
  type ProviderValidationResult,
} from '../services/providerSettings';

export type ProviderVerificationState = 'checking' | 'rejected' | 'unverified' | 'verified';

export interface ProviderVerification {
  state: ProviderVerificationState;
  message?: string;
}

export interface ProviderSetupOutcome {
  provider: ProviderId;
  state: 'verified' | 'saved_unverified';
  message: string;
}

export interface ProviderPlugins {
  providers: ProviderState[];
  defaultProvider: ProviderId | null;
  enabledProviders: ReadonlySet<ProviderId>;
  isConfigured: boolean;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  verifications: Record<string, ProviderVerification>;
  setupOutcome: ProviderSetupOutcome | null;
  refresh: () => Promise<void>;
  setEnabled: (provider: ProviderId, enabled: boolean) => Promise<boolean>;
  setKey: (provider: ProviderId, apiKey: string) => Promise<boolean>;
  removeKey: (provider: ProviderId) => Promise<boolean>;
  setDefault: (provider: ProviderId) => Promise<boolean>;
  validateKey: (provider: ProviderId, apiKey?: string) => Promise<ProviderValidationResult>;
  recordVerification: (provider: ProviderId, verification: ProviderVerification) => void;
  reportSetupOutcome: (outcome: ProviderSetupOutcome) => void;
  dismissSetupOutcome: () => void;
}

function verificationForStatus(status: ProviderKeyStatus): ProviderVerificationState {
  if (status === 'enabled') return 'verified';
  if (status === 'invalid_revoked') return 'rejected';
  return 'unverified';
}

export function useProviderPlugins(userId?: string | null): ProviderPlugins {
  const [payload, setPayload] = useState<ProviderSettingsPayload | null>(null);
  const [statuses, setStatuses] = useState<Record<string, { status: ProviderKeyStatus; message?: string }>>({});
  const [verifications, setVerifications] = useState<Record<string, ProviderVerification>>({});
  const [setupOutcome, setSetupOutcome] = useState<ProviderSetupOutcome | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
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
    setLoaded(true);
    setVerifications((prev) => {
      let changed = false;
      const updated = { ...prev };
      for (const provider of next.providers) {
        if (!provider.hasKey && updated[provider.id]) {
          delete updated[provider.id];
          changed = true;
        }
      }
      return changed ? updated : prev;
    });
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchProviderSettings();
      if (seq !== seqRef.current || !mountedRef.current) return;
      applyPayload(next);
    } catch (err) {
      if (seq !== seqRef.current || !mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'provider_settings_failed');
    } finally {
      if (seq === seqRef.current && mountedRef.current) {
        setLoading(false);
        setLoaded(true);
      }
    }
  }, [applyPayload]);

  // Reload when the account changes; clear state so the previous account's key
  // metadata is never shown for the next one.
  useEffect(() => {
    setPayload(null);
    setLoaded(false);
    setVerifications({});
    setSetupOutcome(null);
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

  const recordVerification = useCallback(
    (provider: ProviderId, verification: ProviderVerification) => {
      setVerifications((prev) => ({ ...prev, [provider]: verification }));
    },
    [],
  );

  const setEnabled = useCallback(
    (provider: ProviderId, enabled: boolean) => mutate(() => setProviderEnabled(provider, enabled)),
    [mutate],
  );

  // Saving is not verification. Clear any earlier verification so the panel
  // never keeps a stale "verified" label after a key is replaced.
  const setKey = useCallback(
    async (provider: ProviderId, apiKey: string): Promise<boolean> => {
      const ok = await mutate(() => setProviderKey(provider, apiKey));
      if (ok && mountedRef.current) {
        setVerifications((prev) => ({
          ...prev,
          [provider]: {
            state: 'unverified',
            message: 'Saved. Run Test to verify this key.',
          },
        }));
      }
      return ok;
    },
    [mutate],
  );

  const removeKey = useCallback(
    async (provider: ProviderId): Promise<boolean> => {
      const ok = await mutate(() => deleteProviderKey(provider));
      if (ok && mountedRef.current) {
        setVerifications((prev) => {
          if (!prev[provider]) return prev;
          const updated = { ...prev };
          delete updated[provider];
          return updated;
        });
      }
      return ok;
    },
    [mutate],
  );

  const providers = useMemo(() => {
    const raw = payload?.providers ?? [];
    return raw.map((p) => {
      const override = statuses[p.id];
      if (!override) return p;
      return {
        ...p,
        status: override.status,
        statusMessage: override.message,
      };
    });
  }, [payload, statuses]);

  // Fail safe: until state loads, expose no provider and make no paid call.
  const enabledProviders = useMemo<ReadonlySet<ProviderId>>(() => {
    if (!payload) return new Set<ProviderId>();
    return new Set(
      providers
        .filter((p) => p.enabled && p.status !== 'invalid_revoked')
        .map((p) => p.id),
    );
  }, [payload, providers]);

  const isConfigured = useMemo(() => {
    return providers.some((p) => p.hasKey && p.enabled && p.status !== 'invalid_revoked');
  }, [providers]);

  const validateKeyHandler = useCallback(
    async (provider: ProviderId, apiKey?: string): Promise<ProviderValidationResult> => {
      if (mountedRef.current) {
        setVerifications((prev) => ({
          ...prev,
          [provider]: { state: 'checking', message: 'Checking key with the provider…' },
        }));
      }
      try {
        const result = await validateProviderKey(provider, apiKey);
        if (mountedRef.current) {
          setStatuses((prev) => ({
            ...prev,
            [provider]: { status: result.status, message: result.message },
          }));
          setVerifications((prev) => ({
            ...prev,
            [provider]: {
              state: verificationForStatus(result.status),
              message: result.message,
            },
          }));
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Validation failed';
        const fallback: ProviderValidationResult = {
          provider,
          status: 'unavailable',
          message,
        };
        if (mountedRef.current) {
          setStatuses((prev) => ({
            ...prev,
            [provider]: { status: 'unavailable', message },
          }));
          setVerifications((prev) => ({
            ...prev,
            [provider]: { state: 'unverified', message },
          }));
        }
        return fallback;
      }
    },
    [],
  );

  return {
    providers,
    defaultProvider: payload?.defaultProvider ?? null,
    enabledProviders,
    isConfigured,
    loading,
    loaded,
    error,
    verifications,
    setupOutcome,
    refresh,
    setEnabled,
    setKey,
    removeKey,
    setDefault: (provider) => mutate(() => setDefaultProvider(provider)),
    validateKey: validateKeyHandler,
    recordVerification,
    reportSetupOutcome: setSetupOutcome,
    dismissSetupOutcome: () => setSetupOutcome(null),
  };
}
