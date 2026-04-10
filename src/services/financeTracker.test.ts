import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Prevent supabase client from throwing due to missing env vars in tests.
vi.mock('../lib/supabase', () => ({ supabase: {} }));

import {
  getDailyTotal,
  getFinanceStore,
  getSpendStats,
  recordCost,
} from './financeTracker';

const STORAGE_KEY = 'prismatix_finance_v1';

function clearStore() {
  localStorage.removeItem(STORAGE_KEY);
}

beforeEach(clearStore);
afterEach(clearStore);

describe('getFinanceStore', () => {
  it('returns empty store when localStorage is empty', () => {
    const store = getFinanceStore();
    expect(store.history).toEqual([]);
    expect(store.totals).toEqual({ week: 0, month: 0 });
  });

  it('returns empty store when localStorage contains invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json');
    const store = getFinanceStore();
    expect(store.history).toEqual([]);
  });

  it('returns empty store when parsed object is missing history array', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ totals: { week: 0, month: 0 } }));
    const store = getFinanceStore();
    expect(store.history).toEqual([]);
  });
});

describe('recordCost', () => {
  it('appends an entry with today\'s date when no date is provided', () => {
    const today = new Date().toISOString().slice(0, 10);
    const store = recordCost({ model: 'haiku-4.5', cost: 0.001 });
    expect(store.history).toHaveLength(1);
    expect(store.history[0].date).toBe(today);
    expect(store.history[0].model).toBe('haiku-4.5');
    expect(store.history[0].cost).toBe(0.001);
  });

  it('accepts a custom date', () => {
    const store = recordCost({ model: 'sonnet-4.6', cost: 0.005, date: '2025-01-15' });
    expect(store.history[0].date).toBe('2025-01-15');
  });

  it('clamps negative costs to zero', () => {
    const store = recordCost({ model: 'haiku-4.5', cost: -5 });
    expect(store.history[0].cost).toBe(0);
  });

  it('accumulates multiple entries', () => {
    recordCost({ model: 'haiku-4.5', cost: 0.001 });
    recordCost({ model: 'sonnet-4.6', cost: 0.002 });
    const store = recordCost({ model: 'opus-4.6', cost: 0.003 });
    expect(store.history).toHaveLength(3);
  });

  it('caps history at 500 entries', () => {
    for (let i = 0; i < 505; i++) {
      recordCost({ model: 'haiku-4.5', cost: 0.0001 });
    }
    const store = getFinanceStore();
    expect(store.history).toHaveLength(500);
  });

  it('stores pricingVersion when provided', () => {
    const store = recordCost({ model: 'haiku-4.5', cost: 0.001, pricingVersion: '2026-01-01' });
    expect(store.history[0].pricingVersion).toBe('2026-01-01');
  });
});

describe('getDailyTotal', () => {
  it('returns 0 when no entries exist', () => {
    expect(getDailyTotal()).toBe(0);
  });

  it('sums only entries matching today', () => {
    const today = new Date().toISOString().slice(0, 10);
    recordCost({ model: 'haiku-4.5', cost: 0.001, date: today });
    recordCost({ model: 'haiku-4.5', cost: 0.002, date: today });
    recordCost({ model: 'haiku-4.5', cost: 0.999, date: '2020-01-01' });
    expect(getDailyTotal()).toBeCloseTo(0.003);
  });

  it('accepts an explicit date argument', () => {
    recordCost({ model: 'haiku-4.5', cost: 0.05, date: '2025-06-01' });
    recordCost({ model: 'haiku-4.5', cost: 0.10, date: '2025-06-01' });
    expect(getDailyTotal('2025-06-01')).toBeCloseTo(0.15);
    expect(getDailyTotal('2025-06-02')).toBe(0);
  });
});

describe('getSpendStats', () => {
  it('returns all-zero stats on empty store', () => {
    const stats = getSpendStats();
    expect(stats.today).toBe(0);
    expect(stats.thisWeek).toBe(0);
    expect(stats.thisMonth).toBe(0);
    expect(stats.allTime).toBe(0);
    expect(stats.lastMessageCost).toBe(0);
    expect(stats.messageCount).toBe(0);
  });

  it('counts total messages', () => {
    recordCost({ model: 'haiku-4.5', cost: 0.001 });
    recordCost({ model: 'haiku-4.5', cost: 0.002 });
    expect(getSpendStats().messageCount).toBe(2);
  });

  it('returns the cost of the last message', () => {
    recordCost({ model: 'haiku-4.5', cost: 0.001 });
    recordCost({ model: 'haiku-4.5', cost: 0.007 });
    expect(getSpendStats().lastMessageCost).toBe(0.007);
  });

  it('includes today\'s entries in thisWeek and thisMonth', () => {
    const today = new Date().toISOString().slice(0, 10);
    recordCost({ model: 'haiku-4.5', cost: 0.01, date: today });
    const stats = getSpendStats();
    expect(stats.today).toBeCloseTo(0.01);
    expect(stats.thisWeek).toBeGreaterThanOrEqual(stats.today);
    expect(stats.thisMonth).toBeGreaterThanOrEqual(stats.thisWeek);
  });

  it('excludes entries older than 30 days from thisMonth', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 40);
    recordCost({ model: 'haiku-4.5', cost: 99, date: oldDate.toISOString().slice(0, 10) });
    const stats = getSpendStats();
    expect(stats.thisMonth).toBe(0);
    expect(stats.allTime).toBe(99);
  });

  it('excludes entries older than 7 days from thisWeek', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    recordCost({ model: 'haiku-4.5', cost: 5, date: oldDate.toISOString().slice(0, 10) });
    const stats = getSpendStats();
    expect(stats.thisWeek).toBe(0);
    expect(stats.thisMonth).toBe(5);
  });
});
