import type { RouterModel } from '../types';
import { supabase } from '../lib/supabase';
import { CONFIG } from '../config';

const STORAGE_KEY = 'prismatix_finance_v1';

export interface FinanceEntry {
  date: string;
  model: RouterModel;
  cost: number;
  pricingVersion?: string;
  provider?: string;
  conversationId?: string;
  costStatus?: 'settled' | 'estimated' | 'pending' | 'unknown';
  promptTokens?: number;
  completionTokens?: number;
  executionId?: string;
}

export interface FinanceStore {
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
  provider?: string;
  conversationId?: string;
  costStatus?: 'settled' | 'estimated' | 'pending' | 'unknown';
  promptTokens?: number;
  completionTokens?: number;
  executionId?: string;
}): FinanceStore {
  const store = getFinanceStore();

  // Idempotency guard: prevent duplicate recording if executionId already exists
  if (entry.executionId && store.history.some((h) => h.executionId === entry.executionId)) {
    return store;
  }

  const nextHistory = [
    ...store.history,
    {
      date: entry.date || currentDate(),
      model: entry.model,
      cost: roundUsd(Math.max(0, entry.cost)),
      pricingVersion: entry.pricingVersion,
      provider: entry.provider,
      conversationId: entry.conversationId,
      costStatus: entry.costStatus,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
      executionId: entry.executionId,
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

export function exportSpendToCsv(history: FinanceEntry[]): string {
  const headers = [
    'Date',
    'Conversation ID',
    'Model',
    'Provider',
    'Cost Status',
    'Prompt Tokens',
    'Completion Tokens',
    'Cost (USD)',
  ];

  const escapeCsv = (val: string): string => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const rows = history.map((e) => [
    e.date,
    escapeCsv(e.conversationId || 'N/A'),
    escapeCsv(e.model),
    escapeCsv(e.provider || 'default'),
    escapeCsv(e.costStatus || 'settled'),
    e.promptTokens !== undefined ? String(e.promptTokens) : '',
    e.completionTokens !== undefined ? String(e.completionTokens) : '',
    e.cost.toFixed(4),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export type DateRangeFilter = 'all' | 'today' | '7d' | '30d';
export type GroupByFilter = 'model' | 'provider' | 'conversation';

export interface GroupedSpendResult {
  groupKey: string;
  count: number;
  totalCost: number;
  settledCost: number;
  estimatedCost: number;
  promptTokens: number;
  completionTokens: number;
}

export function filterAndGroupSpend(
  history: FinanceEntry[],
  dateRange: DateRangeFilter = 'all',
  groupBy: GroupByFilter = 'model',
): GroupedSpendResult[] {
  const now = Date.now();
  const todayStr = new Date().toISOString().slice(0, 10);

  const filtered = history.filter((entry) => {
    if (dateRange === 'all') return true;
    if (dateRange === 'today') return entry.date.startsWith(todayStr);

    const entryTime = new Date(entry.date).getTime();
    if (Number.isNaN(entryTime)) return true;

    if (dateRange === '7d') {
      return now - entryTime <= 7 * 86400000;
    }
    if (dateRange === '30d') {
      return now - entryTime <= 30 * 86400000;
    }
    return true;
  });

  const map = new Map<string, GroupedSpendResult>();

  for (const entry of filtered) {
    let key = 'Default';
    if (groupBy === 'model') {
      key = entry.model;
    } else if (groupBy === 'provider') {
      key = entry.provider || 'default';
    } else if (groupBy === 'conversation') {
      key = entry.conversationId ? entry.conversationId.slice(0, 8) : 'unassigned';
    }

    const current = map.get(key) || {
      groupKey: key,
      count: 0,
      totalCost: 0,
      settledCost: 0,
      estimatedCost: 0,
      promptTokens: 0,
      completionTokens: 0,
    };

    current.count += 1;
    current.totalCost = roundUsd(current.totalCost + entry.cost);
    if (entry.costStatus === 'settled' || !entry.costStatus) {
      current.settledCost = roundUsd(current.settledCost + entry.cost);
    } else {
      current.estimatedCost = roundUsd(current.estimatedCost + entry.cost);
    }
    current.promptTokens += entry.promptTokens || 0;
    current.completionTokens += entry.completionTokens || 0;

    map.set(key, current);
  }

  return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost);
}

export function downloadSpendCsv(history: FinanceEntry[]): void {
  if (typeof window === 'undefined') return;

  const csv = exportSpendToCsv(history);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `prismatix_spend_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
