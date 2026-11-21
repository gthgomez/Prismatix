import type { RouterModel } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { CONFIG } from '../config';

const STORAGE_KEY = 'prismatix_finance_v1';

function financeKey(userId?: string): string {
  return userId ? `${STORAGE_KEY}.${userId}` : STORAGE_KEY;
}

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

export function getFinanceStore(userId?: string): FinanceStore {
  try {
    return safeParse(localStorage.getItem(financeKey(userId)));
  } catch {
    return EMPTY_STORE;
  }
}

export function getDailyTotal(date = currentDate(), userId?: string): number {
  const store = getFinanceStore(userId);
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
}, userId?: string): FinanceStore {
  const store = getFinanceStore(userId);

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

  try {
    localStorage.setItem(financeKey(userId), JSON.stringify(nextStore));
  } catch {
    // The advisory cache must not change the outcome of a generated response.
  }
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
 * Fetches today's server-reported spend. The local total is an advisory cache
 * only; server admission and budget enforcement remain owned by the router.
 */
export async function fetchServerDailyTotal(userId?: string): Promise<number> {
  const advisoryTotal = () => getDailyTotal(undefined, userId);
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session?.access_token || !CONFIG.SUPABASE_URL || (userId && session.user?.id !== userId)) {
      return advisoryTotal();
    }

    const endpoint = `${String(CONFIG.SUPABASE_URL).replace(/\/$/, '')}/functions/v1/spend_stats`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(CONFIG.SUPABASE_ANON_KEY ? { apikey: CONFIG.SUPABASE_ANON_KEY } : {}),
      },
    });

    if (!response.ok) return advisoryTotal();

    const data = await response.json() as { today?: unknown };
    return typeof data.today === 'number' && Number.isFinite(data.today) && data.today >= 0
      ? roundUsd(data.today)
      : advisoryTotal();
  } catch {
    return advisoryTotal();
  }
}

/**
 * Queries the server `cost_logs` ledger under RLS policy `cost_logs_select_own`.
 * Fail explicitly so callers cannot mistake the incomplete browser cache for
 * the authoritative ledger.
 */
export async function fetchAuthoritativeCostLogs(
  client: SupabaseClient,
  options: { limit?: number; since?: string } = {},
): Promise<FinanceEntry[]> {
  try {
    let query = client
      .from('cost_logs')
      .select('id, created_at, conversation_id, model, provider, total_cost, cost_status, input_tokens, output_tokens, pricing_version')
      .order('created_at', { ascending: false });

    if (options.limit) {
      query = query.limit(options.limit);
    }
    if (options.since) {
      query = query.gte('created_at', options.since);
    }

    const { data, error } = await query;
    if (error || !Array.isArray(data)) {
      throw new Error(error?.message || 'Could not load server cost records.');
    }

    return data.map((row) => ({
      date: String(row.created_at || currentDate()),
      model: row.model as RouterModel,
      cost: roundUsd(Number(row.total_cost || 0)),
      pricingVersion: row.pricing_version ? String(row.pricing_version) : undefined,
      provider: row.provider ? String(row.provider) : undefined,
      conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
      costStatus: (row.cost_status as FinanceEntry['costStatus']) || 'settled',
      promptTokens: row.input_tokens !== null && row.input_tokens !== undefined ? Number(row.input_tokens) : undefined,
      completionTokens: row.output_tokens !== null && row.output_tokens !== undefined ? Number(row.output_tokens) : undefined,
      executionId: row.id ? String(row.id) : undefined,
    }));
  } catch (err) {
    throw err instanceof Error ? err : new Error('Could not load server cost records.');
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
