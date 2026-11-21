// src/hooks/useProviderPlugins.ts
// Loads the signed-in user's provider plug-in state (which providers are on,
// which have keys, and which is the default gateway). Owns all mutations so the
// model picker and the settings panel share one source of truth.
//
// Server-authoritative: no optimistic state. A mutation returns a success
// boolean so callers can avoid discarding input on failure. Reloads when the
// account changes and drops stale responses.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

export interface ProviderPlugins {
  providers: ProviderState[];
  defaultProvider: ProviderId | null;
  enabledProviders: ReadonlySet<ProviderId>;
  isConfigured: boolean;
  isVerified: boolean;
  verifiedProviders?: ReadonlySet<ProviderId>;
  verificationStatus: 'unverified' | 'verified' | 'unavailable' | 'invalid';
  verificationLoading: boolean;
  verifyEnabledProviders: (provider?: ProviderId) => Promise<boolean>;
  invalidateVerification: () => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setEnabled: (provider: ProviderId, enabled: boolean) => Promise<boolean>;
  setKey: (provider: ProviderId, apiKey: string, validation?: { status: ProviderKeyStatus; message?: string; stale?: boolean; clientAccountGeneration?: number }) => Promise<boolean>;
  removeKey: (provider: ProviderId) => Promise<boolean>;
  setDefault: (provider: ProviderId) => Promise<boolean>;
  validateKey: (provider: ProviderId, apiKey?: string) => Promise<ProviderValidationResult>;
}

export function useProviderPlugins(userId?: string | null): ProviderPlugins {
  const [payload, setPayload] = useState<ProviderSettingsPayload | null>(null);
  const [statuses, setStatuses] = useState<Record<string, { status: ProviderKeyStatus; message?: string }>>({});
  const [loading, setLoading] = useState(true);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const seqRef = useRef(0);
  const accountGenerationRef = useRef(0);
  const currentUserIdRef = useRef(userId);
  const validationSequenceRef = useRef<Record<string, number>>({});
  const verificationRequestRef = useRef(0);

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
    if (!userId) {
      seqRef.current += 1;
      setPayload(null);
      setStatuses({});
      setError(null);
      setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    const accountGeneration = accountGenerationRef.current;
    validationSequenceRef.current = {};
    verificationRequestRef.current += 1;
    setVerificationLoading(false);
    setLoading(true);
    try {
      const next = await fetchProviderSettings(userId);
      if (seq !== seqRef.current || accountGeneration !== accountGenerationRef.current || !mountedRef.current) return;
      setStatuses({});
      applyPayload(next);
    } catch (err) {
      if (seq !== seqRef.current || accountGeneration !== accountGenerationRef.current || !mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'provider_settings_failed');
    } finally {
      if (seq === seqRef.current && accountGeneration === accountGenerationRef.current && mountedRef.current) setLoading(false);
    }
  }, [applyPayload, userId]);

  // Reload when the account changes; clear state so the previous account's key
  // metadata is never shown for the next one.
  useLayoutEffect(() => {
    if (currentUserIdRef.current !== userId) {
      currentUserIdRef.current = userId;
      accountGenerationRef.current += 1;
      seqRef.current += 1;
      validationSequenceRef.current = {};
      verificationRequestRef.current += 1;
      setPayload(null);
      setStatuses({});
      setError(null);
      setVerificationLoading(false);
      setLoading(true);
    }
    void refresh();
  }, [refresh, userId]);

  const mutate = useCallback(
    async (fn: () => Promise<ProviderSettingsPayload>): Promise<boolean> => {
      const seq = ++seqRef.current;
      const accountGeneration = accountGenerationRef.current;
      try {
        const next = await fn();
        if (seq !== seqRef.current || accountGeneration !== accountGenerationRef.current || !mountedRef.current) return false;
        applyPayload(next);
        return true;
      } catch (err) {
        if (seq === seqRef.current && accountGeneration === accountGenerationRef.current && mountedRef.current) {
          setError(err instanceof Error ? err.message : 'provider_settings_failed');
        }
        return false;
      }
    },
    [applyPayload],
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

  const enabledKeyProviders = useMemo(
    () => providers.filter((provider) => provider.hasKey && provider.enabled),
    [providers],
  );
  const isVerified = enabledKeyProviders.length > 0
    && enabledKeyProviders.every((provider) => statuses[provider.id]?.status === 'enabled');
  const verificationStatus: ProviderPlugins['verificationStatus'] = isVerified
    ? 'verified'
    : enabledKeyProviders.some((provider) => statuses[provider.id]?.status === 'invalid_revoked')
      ? 'invalid'
      : enabledKeyProviders.some((provider) => statuses[provider.id]?.status === 'unavailable')
        ? 'unavailable'
        : 'unverified';

  const validateKeyHandler = useCallback(
    async (provider: ProviderId, apiKey?: string): Promise<ProviderValidationResult> => {
      const accountGeneration = accountGenerationRef.current;
      const validationSequence = (validationSequenceRef.current[provider] ?? 0) + 1;
      validationSequenceRef.current[provider] = validationSequence;
      const isCurrentRequest = () => mountedRef.current
        && accountGeneration === accountGenerationRef.current
        && validationSequenceRef.current[provider] === validationSequence;
      const staleResult = (): ProviderValidationResult => ({
        provider,
        status: 'unavailable',
        message: accountGeneration !== accountGenerationRef.current
          ? 'The signed-in account changed while the provider check was running. Verify again for this account.'
          : 'A newer provider check replaced this result. Verify again before sending.',
        stale: true,
      });
      try {
        if (!userId) return staleResult();
        const response = await validateProviderKey(userId, provider, apiKey);
        // Older Edge versions used this saved-only result for providers with no
        // metadata check. It is not evidence that a credential was verified.
        const result: ProviderValidationResult = response.status === 'enabled' && response.message === 'Key saved'
          ? { ...response, status: 'unknown' }
          : response;
        if (!isCurrentRequest()) return staleResult();
        if (!apiKey && mountedRef.current) {
          setStatuses((prev) => ({
            ...prev,
            [provider]: { status: result.status, message: result.message },
          }));
        }
        return { ...result, clientAccountGeneration: accountGeneration };
      } catch (err) {
        if (!isCurrentRequest()) return staleResult();
        const fallback: ProviderValidationResult = {
          provider,
          status: 'unavailable',
          message: err instanceof Error ? err.message : 'Validation failed',
        };
        if (!apiKey && mountedRef.current) {
          setStatuses((prev) => ({
            ...prev,
            [provider]: { status: 'unavailable', message: fallback.message },
          }));
        }
        return { ...fallback, clientAccountGeneration: accountGeneration };
      }
    },
    [userId],
  );

  const verifyEnabledProviders = useCallback(async (provider?: ProviderId): Promise<boolean> => {
    const accountGeneration = accountGenerationRef.current;
    const verificationRequest = ++verificationRequestRef.current;
    const targets = providers.filter((candidate) => candidate.hasKey && candidate.enabled
      && (!provider || candidate.id === provider));
    if (targets.length === 0) return false;
    setVerificationLoading(true);
    try {
      const results = await Promise.all(targets.map((provider) => validateKeyHandler(provider.id)));
      if (accountGeneration !== accountGenerationRef.current || verificationRequest !== verificationRequestRef.current || !mountedRef.current) return false;
      return results.length > 0 && results.every((result) => result.status === 'enabled');
    } finally {
      if (accountGeneration === accountGenerationRef.current && verificationRequest === verificationRequestRef.current && mountedRef.current) setVerificationLoading(false);
    }
  }, [providers, validateKeyHandler]);

  const invalidateVerification = useCallback(() => {
    validationSequenceRef.current = {};
    verificationRequestRef.current += 1;
    setVerificationLoading(false);
    setStatuses({});
  }, []);

  const clearProviderVerification = useCallback((provider: ProviderId) => {
    validationSequenceRef.current[provider] = (validationSequenceRef.current[provider] ?? 0) + 1;
    setStatuses((prev) => {
      const next = { ...prev };
      delete next[provider];
      return next;
    });
  }, []);

  const setKeyHandler = useCallback(async (
    provider: ProviderId,
    apiKey: string,
    validation?: { status: ProviderKeyStatus; message?: string; stale?: boolean; clientAccountGeneration?: number },
  ): Promise<boolean> => {
    if (validation && (validation.stale
      || validation.clientAccountGeneration !== accountGenerationRef.current)) return false;
    const accountGeneration = accountGenerationRef.current;
    if (!userId) return false;
    const saved = await mutate(() => setProviderKey(provider, apiKey, userId));
    if (!saved || accountGeneration !== accountGenerationRef.current) return false;
    validationSequenceRef.current[provider] = (validationSequenceRef.current[provider] ?? 0) + 1;
    setStatuses((prev) => ({
      ...prev,
      [provider]: validation ? { status: validation.status, message: validation.message } : { status: 'unknown' },
    }));
    return true;
  }, [mutate, userId]);

  const setEnabledHandler = useCallback(async (provider: ProviderId, enabled: boolean): Promise<boolean> => {
    if (!userId) return false;
    const accountGeneration = accountGenerationRef.current;
    const saved = await mutate(() => setProviderEnabled(provider, enabled, userId));
    if (saved && accountGeneration === accountGenerationRef.current) clearProviderVerification(provider);
    return saved;
  }, [clearProviderVerification, mutate, userId]);

  const removeKeyHandler = useCallback(async (provider: ProviderId): Promise<boolean> => {
    if (!userId) return false;
    const accountGeneration = accountGenerationRef.current;
    const removed = await mutate(() => deleteProviderKey(provider, userId));
    if (removed && accountGeneration === accountGenerationRef.current) clearProviderVerification(provider);
    return removed;
  }, [clearProviderVerification, mutate, userId]);

  return {
    providers,
    defaultProvider: payload?.defaultProvider ?? null,
    enabledProviders,
    isConfigured,
    isVerified,
    verifiedProviders: new Set(enabledKeyProviders
      .filter((provider) => statuses[provider.id]?.status === 'enabled')
      .map((provider) => provider.id)),
    verificationStatus,
    verificationLoading,
    verifyEnabledProviders,
    invalidateVerification,
    loading,
    error,
    refresh,
    setEnabled: setEnabledHandler,
    setKey: setKeyHandler,
    removeKey: removeKeyHandler,
    setDefault: (provider) => userId ? mutate(() => setDefaultProvider(provider, userId)) : Promise.resolve(false),
    validateKey: validateKeyHandler,
  };
}
