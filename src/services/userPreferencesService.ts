// src/services/userPreferencesService.ts
// F20: Cross-device user preference synchronization.
// Persists non-sensitive interface, routing, and model preferences on the server
// with strict account scoping, conflict resolution, graceful offline fallback, and storage isolation.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RoutingProfile } from '../types';

export interface UserPreferences {
  favoriteModels: string[];
  hiddenModels: string[];
  routingProfile: RoutingProfile;
  defaultProjectId: string | null;
  theme: 'dark' | 'light' | 'system';
  webSearchEnabled: boolean;
  maxSpendCap: number | null;
  updatedAt?: string;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  favoriteModels: ['gemini-3.8-flash', 'gpt-6-sol'],
  hiddenModels: [],
  routingProfile: 'balanced',
  defaultProjectId: null,
  theme: 'dark',
  webSearchEnabled: false,
  maxSpendCap: null,
};

export function getScopedStorageKey(userId?: string | null): string {
  return userId ? `prismatix_synced_user_preferences_${userId}` : 'prismatix_synced_user_preferences_anon';
}

/**
 * Loads cached preferences from localStorage scoped by account ID.
 */
export function getLocalPreferences(userId?: string | null): UserPreferences {
  try {
    const key = getScopedStorageKey(userId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return DEFAULT_PREFERENCES;
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Saves preferences to localStorage scoped by account ID.
 */
export function setLocalPreferences(prefs: UserPreferences, userId?: string | null): void {
  try {
    const key = getScopedStorageKey(userId);
    window.localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // Ignore storage write issues
  }
}

/**
 * Clears cached preferences for a user on sign-out to prevent cross-account leakage.
 */
export function clearLocalPreferences(userId?: string | null): void {
  try {
    const key = getScopedStorageKey(userId);
    window.localStorage.removeItem(key);
    // Also clean up any legacy un-scoped key
    window.localStorage.removeItem('prismatix_synced_user_preferences');
  } catch {
    // Ignore storage removal issues
  }
}

/**
 * Fetches preferences from the server for the authenticated user, resolving conflicts
 * by comparing server and client update timestamps.
 */
export async function fetchServerPreferences(
  client: SupabaseClient,
): Promise<UserPreferences | null> {
  try {
    if (typeof client?.auth?.getUser !== 'function') {
      return getLocalPreferences(null);
    }
    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user) return null;

    const local = getLocalPreferences(user.id);

    const { data, error } = await client
      .from('user_preferences')
      .select('preferences, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error || !data) {
      return local;
    }

    const remotePrefs = (data.preferences || {}) as Partial<UserPreferences>;
    const remoteUpdatedAt = data.updated_at ? new Date(data.updated_at).getTime() : 0;
    const localUpdatedAt = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;

    // If local has newer un-synced edits, keep local and schedule sync
    if (localUpdatedAt > remoteUpdatedAt && Object.keys(local).length > 0) {
      return local;
    }

    const merged: UserPreferences = {
      ...DEFAULT_PREFERENCES,
      ...remotePrefs,
      updatedAt: data.updated_at,
    };

    setLocalPreferences(merged, user.id);
    return merged;
  } catch (err) {
    console.warn('[userPreferencesService] Fetch server preferences exception:', err);
    return null;
  }
}

/**
 * Durably saves updated preferences to the server for the current user.
 */
export async function saveServerPreferences(
  client: SupabaseClient,
  updated: Partial<UserPreferences>,
): Promise<{ success: boolean; preferences?: UserPreferences }> {
  try {
    if (typeof client?.auth?.getUser !== 'function') {
      return { success: false };
    }
    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user) return { success: false };

    const current = getLocalPreferences(user.id);
    const merged: UserPreferences = {
      ...current,
      ...updated,
      updatedAt: new Date().toISOString(),
    };

    // Update local cache immediately with account scoping
    setLocalPreferences(merged, user.id);

    const { error } = await client.from('user_preferences').upsert({
      user_id: user.id,
      preferences: merged,
      updated_at: merged.updatedAt,
    });

    if (error) {
      console.warn('[userPreferencesService] Upsert preferences error:', error.message);
      return { success: false, preferences: merged };
    }

    return { success: true, preferences: merged };
  } catch (err) {
    console.warn('[userPreferencesService] Save preferences exception:', err);
    return { success: false };
  }
}

/**
 * Initializes and synchronizes preferences on startup.
 */
export async function syncPreferences(client: SupabaseClient): Promise<UserPreferences> {
  const remote = await fetchServerPreferences(client);
  if (remote) return remote;

  if (typeof client?.auth?.getUser === 'function') {
    const { data: { user } } = await client.auth.getUser();
    return getLocalPreferences(user?.id);
  }
  return getLocalPreferences(null);
}
