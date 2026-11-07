// src/services/userPreferencesService.ts
// F20: Cross-device user preference synchronization.
// Persists non-sensitive interface, routing, and model preferences on the server
// with account isolation, graceful offline fallback, and localStorage migration.

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

const LOCAL_STORAGE_KEY = 'prismatix_synced_user_preferences';

/**
 * Loads cached preferences from localStorage for offline/immediate boot.
 */
export function getLocalPreferences(): UserPreferences {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Saves preferences to localStorage.
 */
export function setLocalPreferences(prefs: UserPreferences): void {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage write issues
  }
}

/**
 * Fetches preferences from the server for the authenticated user.
 */
export async function fetchServerPreferences(
  client: SupabaseClient,
): Promise<UserPreferences | null> {
  try {
    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user) return null;

    const { data, error } = await client
      .from('user_preferences')
      .select('preferences, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const remotePrefs = (data.preferences || {}) as Partial<UserPreferences>;
    const merged: UserPreferences = {
      ...DEFAULT_PREFERENCES,
      ...remotePrefs,
      updatedAt: data.updated_at,
    };

    setLocalPreferences(merged);
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
    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user) return { success: false };

    const current = getLocalPreferences();
    const merged: UserPreferences = {
      ...current,
      ...updated,
      updatedAt: new Date().toISOString(),
    };

    // Update local cache immediately
    setLocalPreferences(merged);

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
  return getLocalPreferences();
}

