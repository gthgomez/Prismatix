// provider-settings — per-user provider plug-in state and BYOK key management.
//
// SECURITY: validates the caller's own JWT (never trusts a client-supplied
// subject id), encrypts keys with AES-256-GCM before storage, and returns
// metadata only (never plaintext or ciphertext). All DB writes go through
// service_role-only RPCs (see migration 20261010000000_px12).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ByokConfigError, encryptKey } from '../_shared/byok_crypto.ts';
import { serverHasProviderKey } from '../_shared/provider_credentials.ts';
import {
  PROVIDER_PLUGIN_ORDER,
  PROVIDER_PLUGINS,
  isDefaultProviderChoice,
  isProviderId,
  resolveDefaultProvider,
  resolveEnabledProviderIds,
  type ProviderId,
} from '../_shared/provider_registry.ts';

const _ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || 'http://localhost:3000';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': _ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
};

const MAX_KEY_LENGTH = 512;
const MIN_KEY_LENGTH = 8;
// Visible ASCII only: rejects whitespace/control characters that would produce
// opaque upstream failures.
const KEY_CHARSET = /^[\x21-\x7E]+$/;

export interface ProviderSettingsUser {
  id: string;
}

export interface ProviderSettingsClient {
  auth: {
    getUser(token: string): PromiseLike<{
      data: { user: ProviderSettingsUser | null };
      error: { message?: string } | null;
    }>;
  };
  rpc(
    functionName: string,
    params?: Record<string, unknown>,
  ): PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
}

export interface ProviderSettingsDeps {
  getEnv?: (key: string) => string | undefined;
  createClient?: (url: string, serviceRoleKey: string) => ProviderSettingsClient;
}

interface RawUserConfig {
  default_provider?: unknown;
  providers?: unknown;
}

interface RawProviderRow {
  provider?: unknown;
  enabled?: unknown;
  has_key?: unknown;
  key_last4?: unknown;
}

export interface ProviderStatePayload {
  providers: Array<{
    id: ProviderId;
    label: string;
    enabled: boolean;
    hasKey: boolean;
    keyLast4: string | null;
    offeredByDefault: boolean;
    defaultProvider: boolean;
  }>;
  defaultProvider: ProviderId;
}

function createServiceRoleClient(url: string, serviceRoleKey: string): ProviderSettingsClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: 'public' },
  }) as unknown as ProviderSettingsClient;
}

function parseBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/**
 * Resolves per-provider plug-in state for the client. OpenCode is always
 * offered; every other provider is on only when its row is enabled.
 */
export function buildProviderStates(
  config: RawUserConfig | null,
  getEnv: (key: string) => string | undefined,
): ProviderStatePayload {
  const rows = new Map<ProviderId, RawProviderRow>();
  if (Array.isArray(config?.providers)) {
    for (const raw of config.providers as RawProviderRow[]) {
      if (isProviderId(raw?.provider)) rows.set(raw.provider, raw);
    }
  }

  const defaultProvider = resolveDefaultProvider(config);
  const enabledSet = resolveEnabledProviderIds(config);

  const providers = PROVIDER_PLUGIN_ORDER.map((id) => {
    const plugin = PROVIDER_PLUGINS[id];
    const row = rows.get(id);
    const serverKey = serverHasProviderKey(id, getEnv);

    return {
      id,
      label: plugin.label,
      enabled: enabledSet.has(id),
      hasKey: row?.has_key === true || serverKey,
      keyLast4: typeof row?.key_last4 === 'string' ? row.key_last4 : null,
      offeredByDefault: plugin.offeredByDefault,
      defaultProvider: defaultProvider === id,
    };
  });

  return { providers, defaultProvider };
}

async function loadUserConfig(
  supabase: ProviderSettingsClient,
  subjectId: string,
): Promise<RawUserConfig | null> {
  const { data, error } = await supabase.rpc('get_user_provider_config', {
    p_subject_id: subjectId,
  });
  if (error) throw new Error(error.message ?? 'provider_config_lookup_failed');
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as RawUserConfig;
  }
  return null;
}

export async function handleProviderSettings(
  req: Request,
  deps: ProviderSettingsDeps = {},
): Promise<Response> {
  const getEnv = deps.getEnv ?? ((key: string): string | undefined => Deno.env.get(key));
  const makeClient = deps.createClient ?? createServiceRoleClient;

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseServiceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse({ error: 'Server misconfigured: missing Supabase env vars' }, 500);
  }

  const token = parseBearerToken(req.headers.get('Authorization'));
  if (!token) {
    return jsonResponse({ error: 'Unauthorized: Missing or invalid Authorization header' }, 401);
  }

  const supabase = makeClient(supabaseUrl, supabaseServiceRoleKey);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return jsonResponse({ error: 'Unauthorized: Invalid or expired token' }, 401);
  }

  const respondWithState = async (): Promise<Response> => {
    const config = await loadUserConfig(supabase, user.id);
    return jsonResponse(buildProviderStates(config, getEnv), 200);
  };

  try {
    if (req.method === 'GET') {
      return await respondWithState();
    }

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'Bad Request: Invalid JSON' }, 400);
    }

    const action = typeof body.action === 'string' ? body.action : '';

    switch (action) {
      case 'set_key': {
        const provider = body.provider;
        if (!isProviderId(provider) || provider === 'opencode') {
          return jsonResponse({ error: 'invalid_provider' }, 400);
        }
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
        if (
          apiKey.length < MIN_KEY_LENGTH ||
          apiKey.length > MAX_KEY_LENGTH ||
          !KEY_CHARSET.test(apiKey)
        ) {
          return jsonResponse({ error: 'invalid_api_key' }, 400);
        }

        let encrypted;
        try {
          encrypted = await encryptKey(apiKey);
        } catch (err) {
          if (err instanceof ByokConfigError) {
            return jsonResponse({ error: 'byok_unavailable' }, 500);
          }
          throw err;
        }

        const { error } = await supabase.rpc('set_user_provider_key', {
          p_subject_id: user.id,
          p_provider: provider,
          p_ciphertext: encrypted.ciphertext,
          p_last4: encrypted.last4,
          p_fingerprint: encrypted.fingerprint,
          p_enabled: true,
        });
        if (error) throw new Error(error.message ?? 'set_key_failed');
        return await respondWithState();
      }

      case 'set_enabled': {
        const provider = body.provider;
        if (!isProviderId(provider) || provider === 'opencode') {
          return jsonResponse({ error: 'invalid_provider' }, 400);
        }
        const enabled = body.enabled === true;
        const { error } = await supabase.rpc('set_user_provider_enabled', {
          p_subject_id: user.id,
          p_provider: provider,
          p_enabled: enabled,
        });
        if (error) throw new Error(error.message ?? 'set_enabled_failed');
        return await respondWithState();
      }

      case 'delete_key': {
        const provider = body.provider;
        if (!isProviderId(provider) || provider === 'opencode') {
          return jsonResponse({ error: 'invalid_provider' }, 400);
        }
        const { error } = await supabase.rpc('delete_user_provider_key', {
          p_subject_id: user.id,
          p_provider: provider,
        });
        if (error) throw new Error(error.message ?? 'delete_key_failed');
        return await respondWithState();
      }

      case 'set_default': {
        const provider = body.provider;
        if (!isDefaultProviderChoice(provider)) {
          return jsonResponse({ error: 'invalid_default_provider' }, 400);
        }
        const { error } = await supabase.rpc('set_user_default_provider', {
          p_subject_id: user.id,
          p_provider: provider,
        });
        if (error) throw new Error(error.message ?? 'set_default_failed');
        return await respondWithState();
      }

      default:
        return jsonResponse({ error: 'unknown_action' }, 400);
    }
  } catch (err) {
    console.error('[provider-settings] request failed:', err);
    return jsonResponse({ error: 'provider_settings_failed' }, 500);
  }
}

Deno.serve((req: Request): Promise<Response> => handleProviderSettings(req));
