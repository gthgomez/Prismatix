// src/hooks/useModelCatalogFilter.ts
// Unified model catalog filtering and provider grouping logic.
// Shared between the header ModelSelectorDropdown and ComposerModelPicker.

import { useMemo } from 'react';
import type { RouterModel } from '../types';
import {
  MODEL_ORDER,
  MODEL_HIGHLIGHTS,
  getCatalogEntry,
} from '../modelCatalog';
import {
  PROVIDER_PLUGIN_ORDER,
  PROVIDER_PLUGINS,
  filterVisibleModels,
  hasOpenRouterRoute,
  providerForModel,
  type ProviderId,
} from '../providerRegistry';
import { isHistoricModel } from '../../supabase/functions/_shared/model_lifecycle';

export interface UseModelCatalogFilterOptions {
  enabledProviders: ReadonlySet<ProviderId>;
  hiddenModels?: RouterModel[];
  favoriteModels?: RouterModel[];
  searchQuery?: string;
  providerFilter?: ProviderId | 'all';
  showHistoric?: boolean;
}

export interface ModelGroup {
  provider: ProviderId;
  label: string;
  models: RouterModel[];
}

export function useModelCatalogFilter({
  enabledProviders,
  hiddenModels = [],
  favoriteModels = [],
  searchQuery = '',
  providerFilter = 'all',
  showHistoric = false,
}: UseModelCatalogFilterOptions) {
  const hiddenSet = useMemo(() => new Set(hiddenModels), [hiddenModels]);
  const favoriteSet = useMemo(() => new Set(favoriteModels), [favoriteModels]);

  // Models whose provider is enabled, excluding historic unless requested
  const visibleOrder = useMemo(
    () =>
      filterVisibleModels(MODEL_ORDER, { enabledProviders }).filter(
        (id) => !isHistoricModel(id),
      ),
    [enabledProviders],
  );

  const visibleHighlights = useMemo(
    () => filterVisibleModels(MODEL_HIGHLIGHTS, { enabledProviders }),
    [enabledProviders],
  );

  const historicModels = useMemo(
    () => filterVisibleModels(MODEL_ORDER, { enabledProviders }).filter(isHistoricModel),
    [enabledProviders],
  );

  // Filter based on search query, providerFilter, and hiddenModels
  const filteredModels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return visibleOrder.filter((id) => {
      // If user hid this model, only show it if searching directly for it
      if (!query && hiddenSet.has(id)) {
        return false;
      }

      // Check provider tab filter
      if (providerFilter !== 'all') {
        const owner = providerForModel(id);
        const isOpenRouterBridge =
          providerFilter === 'openrouter' &&
          enabledProviders.has('openrouter') &&
          hasOpenRouterRoute(id);
        if (owner !== providerFilter && !isOpenRouterBridge) {
          return false;
        }
      }

      if (!query) return true;

      const model = getCatalogEntry(id);
      const providerId = providerForModel(id);
      const providerLabel = providerId === 'other' ? '' : PROVIDER_PLUGINS[providerId].label;
      const haystack = `${model.shortName} ${model.name} ${model.description} ${providerLabel} ${id}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [visibleOrder, hiddenSet, providerFilter, searchQuery, enabledProviders]);

  // Pinned/favorite models that are enabled and not hidden
  const pinnedModels = useMemo(() => {
    return visibleOrder.filter(
      (id) => favoriteSet.has(id) && (!hiddenSet.has(id) || searchQuery.trim().length > 0),
    );
  }, [visibleOrder, favoriteSet, hiddenSet, searchQuery]);

  // Filtered historic models for search
  const filteredHistoricModels = useMemo(() => {
    if (!showHistoric && !searchQuery.trim()) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return historicModels;
    return historicModels.filter((id) => {
      const model = getCatalogEntry(id);
      return `${model.shortName} ${model.description} ${id}`.toLowerCase().includes(query);
    });
  }, [historicModels, showHistoric, searchQuery]);

  // Grouped models by provider for grouped view
  const groupedModels = useMemo<ModelGroup[]>(() => {
    const keySet = new Set(filteredModels);
    return PROVIDER_PLUGIN_ORDER.map((provider) => ({
      provider,
      label: PROVIDER_PLUGINS[provider].label,
      models: visibleOrder.filter(
        (id) => keySet.has(id) && providerForModel(id) === provider,
      ),
    })).filter((group) => group.models.length > 0);
  }, [filteredModels, visibleOrder]);

  return {
    visibleOrder,
    visibleHighlights,
    filteredModels,
    pinnedModels,
    historicModels,
    filteredHistoricModels,
    groupedModels,
  };
}
