// src/hooks/useModelPickerPreferences.ts
// Persisted user preferences for model favorites, custom hidden models per provider,
// and last-selected provider filter in model pickers. Scoped per authenticated account.

import { useCallback, useEffect, useState } from 'react';
import type { RouterModel } from '../types';
import type { ProviderId } from '../providerRegistry';
import { MODEL_HIGHLIGHTS, isKnownModel } from '../modelCatalog';

export interface ModelPickerPreferences {
  favoriteModels: RouterModel[];
  hiddenModels: RouterModel[];
  activeProviderFilter: ProviderId | 'all';
}

const PREF_KEY_PREFIX = 'prismatix.modelPrefs.';

export function getStorageKey(userId?: string | null): string {
  return `${PREF_KEY_PREFIX}${userId ?? 'anon'}`;
}

export const DEFAULT_FAVORITES: RouterModel[] = [...MODEL_HIGHLIGHTS];

export function readPreferences(userId?: string | null): ModelPickerPreferences {
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) {
      return {
        favoriteModels: DEFAULT_FAVORITES,
        hiddenModels: [],
        activeProviderFilter: 'all',
      };
    }
    const parsed = JSON.parse(raw) as Partial<ModelPickerPreferences>;
    const favoriteModels = Array.isArray(parsed.favoriteModels)
      ? parsed.favoriteModels.filter(isKnownModel)
      : DEFAULT_FAVORITES;
    const hiddenModels = Array.isArray(parsed.hiddenModels)
      ? parsed.hiddenModels.filter(isKnownModel)
      : [];
    const activeProviderFilter =
      typeof parsed.activeProviderFilter === 'string'
        ? parsed.activeProviderFilter
        : 'all';

    return {
      favoriteModels,
      hiddenModels,
      activeProviderFilter: activeProviderFilter as ProviderId | 'all',
    };
  } catch {
    return {
      favoriteModels: DEFAULT_FAVORITES,
      hiddenModels: [],
      activeProviderFilter: 'all',
    };
  }
}

export function writePreferences(userId: string | null | undefined, prefs: ModelPickerPreferences): void {
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(prefs));
  } catch {
    // LocalStorage quota or access error in private mode
  }
}

export type ModelPickerPreferencesHook = ReturnType<typeof useModelPickerPreferences>;

export function useModelPickerPreferences(userId?: string | null) {
  const [preferences, setPreferences] = useState<ModelPickerPreferences>(() =>
    readPreferences(userId),
  );

  // Re-read when the authenticated user identity changes
  useEffect(() => {
    setPreferences(readPreferences(userId));
  }, [userId]);

  // Sync across tabs/windows
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === getStorageKey(userId)) {
        setPreferences(readPreferences(userId));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [userId]);

  const updatePreferences = useCallback(
    (updater: (prev: ModelPickerPreferences) => ModelPickerPreferences) => {
      setPreferences((prev) => {
        const next = updater(prev);
        writePreferences(userId, next);
        return next;
      });
    },
    [userId],
  );

  const toggleFavorite = useCallback(
    (model: RouterModel) => {
      updatePreferences((prev) => {
        const isFav = prev.favoriteModels.includes(model);
        const nextFavorites = isFav
          ? prev.favoriteModels.filter((m) => m !== model)
          : [...prev.favoriteModels, model];
        return {
          ...prev,
          favoriteModels: nextFavorites,
        };
      });
    },
    [updatePreferences],
  );

  const toggleModelVisibility = useCallback(
    (model: RouterModel) => {
      updatePreferences((prev) => {
        const isHidden = prev.hiddenModels.includes(model);
        const nextHidden = isHidden
          ? prev.hiddenModels.filter((m) => m !== model)
          : [...prev.hiddenModels, model];
        return {
          ...prev,
          hiddenModels: nextHidden,
        };
      });
    },
    [updatePreferences],
  );

  const setModelVisible = useCallback(
    (model: RouterModel, visible: boolean) => {
      updatePreferences((prev) => {
        const nextHidden = visible
          ? prev.hiddenModels.filter((m) => m !== model)
          : prev.hiddenModels.includes(model)
          ? prev.hiddenModels
          : [...prev.hiddenModels, model];
        return {
          ...prev,
          hiddenModels: nextHidden,
        };
      });
    },
    [updatePreferences],
  );

  const setProviderFilter = useCallback(
    (filter: ProviderId | 'all') => {
      updatePreferences((prev) => ({
        ...prev,
        activeProviderFilter: filter,
      }));
    },
    [updatePreferences],
  );

  const isFavorite = useCallback(
    (model: RouterModel) => preferences.favoriteModels.includes(model),
    [preferences.favoriteModels],
  );

  const isModelHidden = useCallback(
    (model: RouterModel) => preferences.hiddenModels.includes(model),
    [preferences.hiddenModels],
  );

  return {
    favoriteModels: preferences.favoriteModels,
    hiddenModels: preferences.hiddenModels,
    activeProviderFilter: preferences.activeProviderFilter,
    toggleFavorite,
    toggleModelVisibility,
    setModelVisible,
    setProviderFilter,
    isFavorite,
    isModelHidden,
  };
}
