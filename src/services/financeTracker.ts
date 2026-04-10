import type { RouterModel } from '../types';
import { supabase } from '../lib/supabase';
import { CONFIG } from '../config';

const STORAGE_KEY = 'prismatix_finance_v1';

interface FinanceEntry {
  date: string;
  model: RouterModel;
  cost: number;
  pricingVersion?: string;
}

interface FinanceStore {
  history: FinanceEntry[];
  totals: {
    week: number;
    month: number;
  };
}

export interface SpendStats {
  today: number;
  thisWeek: number;
  thisMonth: number;
  allTime: number;
  lastMessageCost: number;
  messageCount: number;
}

const EMPTY_STORE: FinanceStore = {
  history: [],
  totals: { week: 0, month: 0 },
};

function roundUsd(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function safeParse(input: string | null): FinanceStore {
  if (!input) return EMPTY_STORE;

  try {
    const parsed = JSON.parse(input) as FinanceStore;
    if (!Array.isArray(parsed.history) || !parsed.totals) return EMPTY_STORE;
    return parsed;
  } catch {
    return EMPTY_STORE;
  }
}

function computeTotals(history: FinanceEntry[]): { week: number; month: number } {
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  const monthAgo = new Date(now);
  monthAgo.setDate(now.getDate() - 30);

  let week = 0;
  let month = 0;

  for (const entry of history) {
    const at = new Date(entry.date);
    if (at >= weekAgo) week += entry.cost;
    if (at >= monthAgo) month += entry.cost;
  }

  return { week: roundUsd(week), month: roundUsd(month) };
}

export function getFinanceStore(): FinanceStore {
  return safeParse(localStorage.getItem(STORAGE_KEY));
}

export function getDailyTotal(date = currentDate()): number {
  const store = getFinanceStore();
  return roundUsd(store.history.filter((item) => item.date === date).reduce((sum, item) => sum + item.cost, 0));
}

export function recordCost(entry: {
  model: RouterModel;
  cost: number;
  pricingVersion?: string;
  date?: string;
}): FinanceStore {
  const store = getFinanceStore();
  const nextHistory = [
    ...store.history,
    {
      date: entry.date || currentDate(),
      model: entry.model,
      cost: roundUsd(Math.max(0, entry.cost)),
      pricingVersion: entry.pricingVersion,
    },
  ];

  const nextStore: FinanceStore = {
    history: nextHistory.slice(-500),
    totals: computeTotals(nextHistory),
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStore));
  return nextStore;
}

export function getSpendStats(date = currentDate()): SpendStats {
  const store = getFinanceStore();
  const history = store.history;

  const today = roundUsd(
    history
      .filter((entry) => entry.date === date)
      .reduce((sum, entry) => sum + entry.cost, 0),
  );

  const thisWeek = roundUsd(store.totals.week);
  const thisMonth = roundUsd(store.totals.month);
  const allTime = roundUsd(history.reduce((sum, entry) => sum + entry.cost, 0));
  const lastEntry = history[history.length - 1];

  return {
    today,
    thisWeek,
    thisMonth,
    allTime,
    lastMessageCost: roundUsd(lastEntry?.cost || 0),
    messageCount: history.length,
  };
}

/**
 * Fetches today's spend total from the server (Supabase cost_logs via spend_stats edge function).
 * Falls back to the localStorage total if the server is unreachable.
 *
 * Use this for budget enforcement — localStorage can be cleared or bypassed across tabs/devices.
 */
export async function fetchServerDailyTotal(): Promise<number> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session?.access_token || !CONFIG.SUPABASE_URL) {
      return getDailyTotal();
    }

    const endpoint = `${String(CONFIG.SUPABASE_URL).replace(/\/$/, '')}/functions/v1/spend_stats`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(CONFIG.SUPABASE_ANON_KEY ? { apikey: CONFIG.SUPABASE_ANON_KEY } : {}),
      },
    });

    if (!response.ok) return getDailyTotal();

    const data = await response.json() as { today?: unknown };
    const serverTotal = Number(data.today);
    return Number.isFinite(serverTotal) ? roundUsd(serverTotal) : getDailyTotal();
  } catch {
    return getDailyTotal();
  }
}
