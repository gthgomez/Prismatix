// providerRegistry.ts — client mirror of the provider plug-in registry.
// Single source of truth lives in supabase/functions/_shared/provider_registry.ts;
// this module re-exports it typed for the client and adds visibility helpers.

import { getCatalogEntry } from './modelCatalog';
import type { RouterModel, RouterProvider } from './types';
import {
  DEFAULT_PROVIDER_CHOICES,
  FALLBACK_DEFAULT_PROVIDER,
  PROVIDER_PLUGIN_ORDER,
  PROVIDER_PLUGINS,
  getProviderPlugin,
  hasOpenRouterRoute,
  isDefaultProviderChoice,
  isProviderId,
  openRouterModelId,
  resolveDefaultProvider,
  resolveEnabledProviderIds,
  type ProviderId,
  type ProviderPlugin,
  type RawUserProviderConfig,
} from '../supabase/functions/_shared/provider_registry';

export {
  DEFAULT_PROVIDER_CHOICES,
  FALLBACK_DEFAULT_PROVIDER,
  PROVIDER_PLUGIN_ORDER,
  PROVIDER_PLUGINS,
  getProviderPlugin,
  hasOpenRouterRoute,
  isDefaultProviderChoice,
  isProviderId,
  openRouterModelId,
  resolveDefaultProvider,
  resolveEnabledProviderIds,
};
export type { ProviderId, ProviderPlugin, RawUserProviderConfig };

/**
 * The provider that owns a catalog model. Catalog entries only ever carry a
 * `RouterProvider`; `other` (unknown models) has no plug-in and is never
 * surfaced by the picker because it is absent from MODEL_ORDER.
 */
export function providerForModel(modelId: string): ProviderId | 'other' {
  const provider = getCatalogEntry(modelId).provider as RouterProvider;
  return isProviderId(provider) ? provider : 'other';
}

export interface ModelVisibilityInput {
  /** Providers currently enabled for the user (OpenCode default + any toggled on). */
  enabledProviders: ReadonlySet<ProviderId>;
}

/**
 * A model is visible when its owning provider is enabled, or when OpenRouter is
 * enabled and the model has an OpenRouter route.
 */
export function isModelVisible(modelId: string, input: ModelVisibilityInput): boolean {
  const provider = providerForModel(modelId);
  if (provider !== 'other' && input.enabledProviders.has(provider)) {
    return true;
  }
  return input.enabledProviders.has('openrouter') && hasOpenRouterRoute(modelId);
}

/** Filters an ordered model list down to the models visible to the user. */
export function filterVisibleModels(
  models: ReadonlyArray<RouterModel>,
  input: ModelVisibilityInput,
): RouterModel[] {
  return models.filter((modelId) => isModelVisible(modelId, input));
}
