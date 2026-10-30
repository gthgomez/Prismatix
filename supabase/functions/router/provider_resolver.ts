// provider_resolver.ts — per-request provider readiness and credential
// resolution. Merges operator kill-switches with the requesting user's
// provider plug-in state so that:
//
//   * auto-routing can only ever target a provider the user has enabled, and
//   * only a connected user key (BYOK) can authorize a provider call.
//
// A resolver instance is built once per request and must never be shared
// across requests (it is bound to one subject's provider state).

import {
  PROVIDER_PLUGIN_ORDER,
  isProviderId,
  resolveEnabledProviderIds,
  type ProviderId,
  type RawUserProviderConfig,
  type RawUserProviderRow,
} from '../_shared/provider_registry.ts';
import { MODEL_REGISTRY, type Provider } from './router_logic.ts';

export interface ProviderResolverConfig {
  /** Operator kill-switch (ENABLE_* env flags). */
  globalEnabled(provider: Provider): boolean;
  /** Resolves and decrypts the user's key for the provider, or null. */
  fetchUserKey(provider: Provider): Promise<string | null>;
}

export class ProviderCredentialError extends Error {
  readonly provider: Provider;
  readonly code = 'provider_key_required';

  constructor(provider: Provider) {
    super(`No usable credentials for provider '${provider}'.`);
    this.name = 'ProviderCredentialError';
    this.provider = provider;
  }
}

/** The user has a saved key, but the backend could not safely retrieve it. */
export class ProviderKeyUnavailableError extends Error {
  readonly provider: Provider;
  readonly code = 'provider_key_unavailable';

  constructor(provider: Provider) {
    super(`Unable to retrieve the saved key for provider '${provider}'.`);
    this.name = 'ProviderKeyUnavailableError';
    this.provider = provider;
  }
}

export interface ProviderResolver {
  isEnabled(provider: Provider): boolean;
  hasCredentials(provider: Provider): boolean;
  isReady(provider: Provider): boolean;
  readyForModelTier(modelTier: string): boolean;
  anyReady(): boolean;
  resolveKey(provider: Provider): Promise<string>;
}

const ALL_PROVIDERS = PROVIDER_PLUGIN_ORDER as readonly Provider[];

export function createProviderResolver(
  config: RawUserProviderConfig | null | undefined,
  deps: ProviderResolverConfig,
): ProviderResolver {
  // Missing/empty state resolves to OpenRouter BYOK by default. A provider is
  // only credential-ready when this user's encrypted key metadata exists.
  const userEnabled = resolveEnabledProviderIds(config);

  const userKeyed = new Set<Provider>();
  if (Array.isArray(config?.providers)) {
    for (const raw of config.providers as RawUserProviderRow[]) {
      if (isProviderId(raw?.provider) && raw?.has_key === true) {
        userKeyed.add(raw.provider as Provider);
      }
    }
  }

  const hasCredentials = (provider: Provider): boolean => userKeyed.has(provider);

  const isEnabled = (provider: Provider): boolean =>
    deps.globalEnabled(provider) && userEnabled.has(provider as ProviderId);

  const isReady = (provider: Provider): boolean =>
    isEnabled(provider) && hasCredentials(provider);

  const readyForModelTier = (modelTier: string): boolean => {
    const model = MODEL_REGISTRY[modelTier];
    return model ? isReady(model.provider) : false;
  };

  const anyReady = (): boolean => ALL_PROVIDERS.some((provider) => isReady(provider));

  const resolveKey = async (provider: Provider): Promise<string> => {
    // Enforce enablement/kill-switch at the credential boundary so no call path
    // can spend a key for a provider this account has not enabled.
    if (!isEnabled(provider)) throw new ProviderCredentialError(provider);
    if (!userKeyed.has(provider)) throw new ProviderCredentialError(provider);
    let userKey: string | null;
    try {
      userKey = await deps.fetchUserKey(provider);
    } catch {
      // Never turn an unavailable/revoked/decryption-failed key into another
      // credential path. In particular, no deployment key is consulted.
      throw new ProviderKeyUnavailableError(provider);
    }
    if (typeof userKey === 'string' && userKey.trim() !== '') return userKey;
    throw new ProviderCredentialError(provider);
  };

  return { isEnabled, hasCredentials, isReady, readyForModelTier, anyReady, resolveKey };
}
