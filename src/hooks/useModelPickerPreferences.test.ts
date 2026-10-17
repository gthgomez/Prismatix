import { describe, it, expect, beforeEach } from 'vitest';
import {
  readPreferences,
  writePreferences,
  getStorageKey,
  DEFAULT_FAVORITES,
  type ModelPickerPreferences,
} from './useModelPickerPreferences';

describe('useModelPickerPreferences storage helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('generates storage keys scoped by user', () => {
    expect(getStorageKey('user-123')).toBe('prismatix.modelPrefs.user-123');
    expect(getStorageKey(null)).toBe('prismatix.modelPrefs.anon');
    expect(getStorageKey(undefined)).toBe('prismatix.modelPrefs.anon');
  });

  it('reads default preferences when localStorage is empty', () => {
    const prefs = readPreferences('user-123');
    expect(prefs.favoriteModels).toEqual(DEFAULT_FAVORITES);
    expect(prefs.hiddenModels).toEqual([]);
    expect(prefs.activeProviderFilter).toBe('all');
  });

  it('writes and reads persisted preferences per user', () => {
    const user1Prefs: ModelPickerPreferences = {
      favoriteModels: ['claude-haiku-5-5', 'gemini-3.8-flash'],
      hiddenModels: ['deepseek-v4-flash'],
      activeProviderFilter: 'anthropic',
    };

    writePreferences('user-1', user1Prefs);

    expect(readPreferences('user-1')).toEqual(user1Prefs);

    // Another user still gets defaults
    expect(readPreferences('user-2')).toEqual({
      favoriteModels: DEFAULT_FAVORITES,
      hiddenModels: [],
      activeProviderFilter: 'all',
    });
  });

  it('ignores invalid or corrupt JSON and falls back to defaults', () => {
    localStorage.setItem(getStorageKey('corrupt-user'), 'not-json{{{');
    const prefs = readPreferences('corrupt-user');
    expect(prefs.favoriteModels).toEqual(DEFAULT_FAVORITES);
    expect(prefs.hiddenModels).toEqual([]);
    expect(prefs.activeProviderFilter).toBe('all');
  });

  it('preserves empty favoriteModels array when user unpins all favorites', () => {
    const emptyFavoritesPrefs: ModelPickerPreferences = {
      favoriteModels: [],
      hiddenModels: [],
      activeProviderFilter: 'all',
    };
    writePreferences('user-unpinned', emptyFavoritesPrefs);
    const prefs = readPreferences('user-unpinned');
    expect(prefs.favoriteModels).toEqual([]);
  });
});
