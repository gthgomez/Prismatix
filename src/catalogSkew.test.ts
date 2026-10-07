import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_TARIFF_VERSION,
  getServerTariffVersion,
  isCatalogSkewed,
  noteServerTariffVersion,
  subscribeCatalogSkew,
} from './catalogSkew';

describe('catalogSkew (PX02 tariff-version skew detection)', () => {
  beforeEach(() => {
    noteServerTariffVersion(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is not skewed before any server response', () => {
    expect(isCatalogSkewed()).toBe(false);
    expect(getServerTariffVersion()).toBeNull();
  });

  it('matching version is not skewed', () => {
    noteServerTariffVersion(CLIENT_TARIFF_VERSION);
    expect(isCatalogSkewed()).toBe(false);
  });

  it('different version is skewed and notifies subscribers exactly on change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCatalogSkew(listener);
    noteServerTariffVersion('1999-01-01-v0');
    expect(isCatalogSkewed()).toBe(true);
    expect(getServerTariffVersion()).toBe('1999-01-01-v0');
    expect(listener).toHaveBeenCalledTimes(1);

    // Same value again: no duplicate notification.
    noteServerTariffVersion('1999-01-01-v0');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    noteServerTariffVersion(CLIENT_TARIFF_VERSION);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(isCatalogSkewed()).toBe(false);
  });

  it('missing/empty header clears the observed version', () => {
    noteServerTariffVersion('1999-01-01-v0');
    noteServerTariffVersion(undefined);
    expect(getServerTariffVersion()).toBeNull();
    expect(isCatalogSkewed()).toBe(false);
  });
});
