import { createClient } from 'npm:@supabase/supabase-js@2';

// SECURITY: Lock CORS to the configured frontend origin.
// Set ALLOWED_ORIGIN in Supabase project secrets (e.g. https://your-app.vercel.app).
const _ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || 'http://localhost:3000';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': _ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
};
const QUALIFIED_SPEND_RPC_TIMEOUT_MS = 1_000;

interface ParsedSpendStatsRow {
  today: number;
  thisWeek: number;
  thisMonth: number;
  allTime: number;
  lastMessageCost: number;
  messageCount: number;
}

function parseBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

type QualifiedSpendWindow = {
  settled: number;
  pending: number;
  estimatedLegacy: number;
};

type QualifiedSpendStats = {
  today: QualifiedSpendWindow;
  thisWeek: QualifiedSpendWindow;
  thisMonth: QualifiedSpendWindow;
  allTime: QualifiedSpendWindow;
};

function asNonNegativeAmount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseSpendStatsRow(value: unknown): ParsedSpendStatsRow | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const today = asNonNegativeAmount(row.today);
  const thisWeek = asNonNegativeAmount(row.this_week);
  const thisMonth = asNonNegativeAmount(row.this_month);
  const allTime = asNonNegativeAmount(row.all_time);
  const lastMessageCost = asNonNegativeAmount(row.last_message_cost);
  const messageCount = asNonNegativeAmount(row.message_count);
  if (
    today === null || thisWeek === null || thisMonth === null || allTime === null
    || lastMessageCost === null || messageCount === null
    || !Number.isSafeInteger(messageCount)
  ) return null;
  return { today, thisWeek, thisMonth, allTime, lastMessageCost, messageCount };
}

function parseQualifiedSpendStats(value: unknown): QualifiedSpendStats | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const windows = ['today', 'thisWeek', 'thisMonth', 'allTime'] as const;
  const result = {} as QualifiedSpendStats;
  for (const window of windows) {
    const rawWindow = input[window];
    if (typeof rawWindow !== 'object' || rawWindow === null || Array.isArray(rawWindow)) return null;
    const raw = rawWindow as Record<string, unknown>;
    const settled = asNonNegativeAmount(raw.settled);
    const pending = asNonNegativeAmount(raw.pending);
    const estimatedLegacy = asNonNegativeAmount(raw.estimatedLegacy);
    if (settled === null || pending === null || estimatedLegacy === null) return null;
    result[window] = { settled, pending, estimatedLegacy };
  }
  return result;
}

// PX02: minimal exported testable seam. handleSpendStats contains the full
// handler logic; Deno.serve below simply delegates to it, so behaviour is
// byte-for-byte unchanged. This function validates the Bearer token manually
// (supabase.auth.getUser), so authentication never depends on the gateway
// verify_jwt setting — the deployed spend_stats gateway runs with
// verify_jwt = false while the repo config.toml declares true (a known
// divergence recorded in the deployment manifest). Either way: missing or
// invalid tokens are rejected here.

export interface SpendStatsUser {
  id: string;
}

// Structural interface for the injected supabase-js client (same posture as
// _shared/access_policy.ts): keeps tests free of the real SDK.
export interface SpendStatsClient {
  auth: {
    getUser(token: string): PromiseLike<{
      data: { user: SpendStatsUser | null };
      error: { message?: string } | null;
    }>;
  };
  rpc(
    functionName: string,
    params?: Record<string, unknown>,
  ): PromiseLike<{ data?: unknown; error?: unknown }>;
}

export interface SpendStatsDeps {
  getEnv?: (key: string) => string | undefined;
  createClient?: (url: string, serviceRoleKey: string) => SpendStatsClient;
}

function createServiceRoleClient(url: string, serviceRoleKey: string): SpendStatsClient {
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: { schema: 'public' },
  }) as unknown as SpendStatsClient;
}

export async function handleSpendStats(
  req: Request,
  deps: SpendStatsDeps = {},
): Promise<Response> {
  const getEnv = deps.getEnv ?? ((key: string): string | undefined => Deno.env.get(key));
  const makeClient = deps.createClient ?? createServiceRoleClient;

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseServiceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: missing Supabase env vars' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const token = parseBearerToken(req.headers.get('Authorization'));
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Missing or invalid Authorization header' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const supabase = makeClient(supabaseUrl, supabaseServiceRoleKey);

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Invalid or expired token' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const { data, error } = await supabase.rpc('get_spend_stats', {
    p_user_id: user.id,
  });

  if (error) {
    console.error('[spend_stats] RPC failed:', error);
    return new Response(JSON.stringify({ error: 'Failed to load spend stats' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const row = parseSpendStatsRow(data);
  if (!row) {
    return new Response(JSON.stringify({ error: 'Failed to load spend stats' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // PX12 qualified totals are additive during rollout: older databases may
  // not have the new RPC yet, in which case preserve the legacy response.
  let qualified: QualifiedSpendStats | null = null;
  let qualifiedTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const qualifiedResponse = await Promise.race([
      supabase.rpc('get_spend_stats_qualified', { p_user_id: user.id }),
      new Promise<never>((_resolve, reject) => {
        qualifiedTimeout = setTimeout(
          () => reject(new Error('qualified spend stats timed out')),
          QUALIFIED_SPEND_RPC_TIMEOUT_MS,
        );
      }),
    ]);
    if (!qualifiedResponse.error) {
      qualified = parseQualifiedSpendStats(qualifiedResponse.data);
    }
  } catch {
    // Keep the existing stats endpoint available while the additive RPC rolls out.
  } finally {
    if (qualifiedTimeout !== undefined) clearTimeout(qualifiedTimeout);
  }

  return new Response(
    JSON.stringify({
      today: row.today,
      thisWeek: row.thisWeek,
      thisMonth: row.thisMonth,
      allTime: row.allTime,
      lastMessageCost: row.lastMessageCost,
      messageCount: row.messageCount,
      ...(qualified ? { qualified } : {}),
    }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    },
  );
}

Deno.serve((req: Request): Promise<Response> => handleSpendStats(req));
