// provider_resolver.ts — per-request provider readiness and credential
// resolution. Merges deployment-wide secrets (server keys + operator
// kill-switches) with the requesting user's provider plug-in state so that:
//
//   * auto-routing can only ever target a provider the user has enabled, and
//   * a connected user key (BYOK) is used instead of the shared server key.
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
  /** Deployment-wide secret for the provider, if configured. */
  serverKey(provider: Provider): string | undefined;
  /** Operator kill-switch (ENABLE_* env flags). */
  globalEnabled(provider: Provider): boolean;
  /** Resolves and decrypts the user's key for the provider, or null. */
  fetchUserKey(provider: Provider): Promise<string | null>;
}

export class ProviderCredentialError extends Error {
  readonly provider: Provider;

  constructor(provider: Provider) {
    super(`No usable credentials for provider '${provider}'.`);
    this.name = 'ProviderCredentialError';
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
  // Missing/empty state resolves to the default first-class gateway only
  // (opencode), so a lookup failure can never enable server-keyed providers the
  // account has not opted into. Strict per-user enablement applies always.
  const userEnabled = resolveEnabledProviderIds(config);

  const userKeyed = new Set<Provider>();
  if (Array.isArray(config?.providers)) {
    for (const raw of config.providers as RawUserProviderRow[]) {
      if (isProviderId(raw?.provider) && raw?.has_key === true) {
        userKeyed.add(raw.provider as Provider);
      }
    }
  }

  const hasCredentials = (provider: Provider): boolean =>
    userKeyed.has(provider) || !!deps.serverKey(provider);

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
    if (userKeyed.has(provider)) {
      const userKey = await deps.fetchUserKey(provider);
      if (userKey && userKey.trim() !== '') return userKey;
    }
    const serverKey = deps.serverKey(provider);
    if (serverKey && serverKey.trim() !== '') return serverKey;
    throw new ProviderCredentialError(provider);
  };

  return { isEnabled, hasCredentials, isReady, readyForModelTier, anyReady, resolveKey };
}
