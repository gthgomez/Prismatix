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
import type { Provider } from './router_logic.ts';
import { isCurrentInventory, isCurrentRouteTariff, servingRouteId, type ProviderInventory, type ServingRoute } from '../_shared/serving_routes.ts';
import { supportsInferenceProtocol } from '../_shared/provider_endpoint.ts';

export interface ProviderResolverConfig {
  /** Operator kill-switch (ENABLE_* env flags). */
  globalEnabled(provider: Provider): boolean;
  /** Production dispatch must revalidate the selected snapshot at the final credential read. */
  fetchRouteKey?(provider: Provider, revision: string, routeId: string): Promise<string | null>;
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
  resolveKey(provider: Provider, route?: ServingRoute): Promise<string>;
  eligibleRoutes(): ServingRoute[];
  routeForTier(modelTier: string, provider?: Provider): ServingRoute | undefined;
  revisionFor(provider: Provider): string | undefined;
}

const ALL_PROVIDERS = PROVIDER_PLUGIN_ORDER.filter((id): id is Provider => id !== 'brave');

type UserInventoryRow = RawUserProviderRow & { inventory?: ProviderInventory; credential_revision?: string };

function hasSafeRouteMetadata(route: ServingRoute, provider: Provider): boolean {
  if (!route || route.provider !== provider || typeof route.upstreamId !== 'string' ||
      !/^[A-Za-z0-9._:/-]{1,250}$/.test(route.upstreamId) ||
      route.id !== servingRouteId(provider, route.upstreamId) ||
      !supportsInferenceProtocol(provider, route.protocol) ||
      typeof route.canonicalId !== 'string' || route.canonicalId.length < 1 || route.canonicalId.length > 250 ||
      !Number.isSafeInteger(route.contextWindow) || route.contextWindow <= 64 ||
      !Number.isSafeInteger(route.maxOutputTokens) || route.maxOutputTokens < 64) return false;
  const tariff = route.tariff;
  return Boolean(tariff && isCurrentRouteTariff(tariff) &&
    ['pay_as_you_go', 'prepaid_credits', 'subscription_allowance'].includes(tariff.billing) &&
    [tariff.inputPerMillion, tariff.outputPerMillion, tariff.cachedReadPerMillion ?? 0,
      tariff.cachedWritePerMillion ?? 0, tariff.reasoningPerMillion ?? 0, tariff.requestUsd ?? 0]
      .every((rate) => typeof rate === 'number' && Number.isFinite(rate) && rate >= 0));
}

export function createProviderResolver(
  config: RawUserProviderConfig | null | undefined,
  deps: ProviderResolverConfig,
): ProviderResolver {
  const userEnabled = resolveEnabledProviderIds(config);

  const userKeyed = new Set<Provider>();
  const inventoryRows = new Map<Provider, UserInventoryRow>();
  if (Array.isArray(config?.providers)) {
    for (const raw of config.providers as UserInventoryRow[]) {
      if (isProviderId(raw?.provider) && raw.provider !== 'brave' && raw.has_key === true) {
        userKeyed.add(raw.provider);
        inventoryRows.set(raw.provider, raw);
      }
    }
  }

  const hasCredentials = (provider: Provider): boolean => userKeyed.has(provider);

  const isEnabled = (provider: Provider): boolean =>
    deps.globalEnabled(provider) && userEnabled.has(provider as ProviderId);

  const eligibleRoutes = (): ServingRoute[] => ALL_PROVIDERS.flatMap((provider) => {
    const row = inventoryRows.get(provider);
    if (!isEnabled(provider) || !row?.credential_revision || !isCurrentInventory(row.inventory) ||
        !Array.isArray(row.inventory.routes)) return [];
    const restricted = new Set(row.inventory.restrictedRouteIds ?? []);
    return row.inventory.routes.filter((route) => hasSafeRouteMetadata(route, provider) && !restricted.has(route.id));
  });

  const routeForTier = (modelTier: string, provider?: Provider): ServingRoute | undefined => {
    const candidates = eligibleRoutes().filter((route) =>
      route.canonicalId === modelTier && (!provider || provider === route.provider)
    );
    return candidates.sort((a, b) =>
      a.tariff.inputPerMillion - b.tariff.inputPerMillion ||
      a.tariff.outputPerMillion - b.tariff.outputPerMillion || a.id.localeCompare(b.id)
    )[0];
  };

  const isReady = (provider: Provider): boolean => eligibleRoutes().some((route) => route.provider === provider);

  const readyForModelTier = (modelTier: string): boolean => Boolean(routeForTier(modelTier));

  const anyReady = (): boolean => eligibleRoutes().length > 0;

  const resolveKey = async (provider: Provider, route?: ServingRoute): Promise<string> => {
    // Enforce enablement/kill-switch at the credential boundary so no call path
    // can spend a key for a provider this account has not enabled.
    if (!isEnabled(provider)) throw new ProviderCredentialError(provider);
    if (!userKeyed.has(provider)) throw new ProviderCredentialError(provider);
    const row = inventoryRows.get(provider);
    if (!deps.fetchRouteKey || !route || route.provider !== provider || !row?.credential_revision ||
        !eligibleRoutes().some((candidate) => candidate.id === route.id)) {
      throw new ProviderCredentialError(provider);
    }
    let userKey: string | null;
    try {
      userKey = await deps.fetchRouteKey(provider, row.credential_revision, route.id);
    } catch {
      // Never turn an unavailable/revoked/decryption-failed key into another
      // credential path. In particular, no deployment key is consulted.
      throw new ProviderKeyUnavailableError(provider);
    }
    if (typeof userKey === 'string' && userKey.trim() !== '') return userKey;
    throw new ProviderCredentialError(provider);
  };

  return {
    isEnabled, hasCredentials, isReady, readyForModelTier, anyReady, resolveKey, eligibleRoutes, routeForTier,
    revisionFor: (provider) => inventoryRows.get(provider)?.credential_revision,
  };
}
