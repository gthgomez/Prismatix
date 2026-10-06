import { createClient } from 'npm:@supabase/supabase-js@2';

// SECURITY: Lock CORS to the configured frontend origin.
// Set ALLOWED_ORIGIN in Supabase project secrets (e.g. https://your-app.vercel.app).
const _ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || 'http://localhost:3000';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': _ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
};

interface SpendStatsRow {
  today: number | string | null;
  this_week: number | string | null;
  this_month: number | string | null;
  all_time: number | string | null;
  last_message_cost: number | string | null;
  message_count: number | string | null;
}

function parseBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

  const row = ((Array.isArray(data) ? data[0] : data) || {}) as SpendStatsRow;

  return new Response(
    JSON.stringify({
      today: toNumber(row.today),
      thisWeek: toNumber(row.this_week),
      thisMonth: toNumber(row.this_month),
      allTime: toNumber(row.all_time),
      lastMessageCost: toNumber(row.last_message_cost),
      messageCount: toNumber(row.message_count),
    }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    },
  );
}

Deno.serve((req: Request): Promise<Response> => handleSpendStats(req));
