// provider-settings — per-user provider plug-in state and BYOK key management.
//
// SECURITY: validates the caller's own JWT (never trusts a client-supplied
// subject id), encrypts keys with AES-256-GCM before storage, and returns
// metadata only (never plaintext or ciphertext). All DB writes go through
// service_role-only RPCs (see migration 20261010000000_px12).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ByokConfigError, decryptKey, encryptKey } from '../_shared/byok_crypto.ts';
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

export type ProviderKeyStatus =
  | 'not_configured'
  | 'enabled'
  | 'disabled'
  | 'invalid_revoked'
  | 'unavailable'
  | 'unknown';

export interface ProviderSettingsDeps {
  getEnv?: (key: string) => string | undefined;
  createClient?: (url: string, serviceRoleKey: string) => ProviderSettingsClient;
  fetchFn?: typeof fetch;
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
    status: ProviderKeyStatus;
    statusMessage?: string;
  }>;
  defaultProvider: ProviderId;
}

/**
 * Validates a provider API key using safe metadata checks without paid inference.
 * Rejects with invalid_revoked on 401/403, unavailable on 5xx or network errors,
 * and enabled on successful metadata retrieval.
 */
export async function validateProviderKeyMetadata(
  provider: ProviderId,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ status: ProviderKeyStatus; message?: string }> {
  try {
    if (provider === 'openrouter') {
      const res = await fetchFn('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        return { status: 'enabled', message: 'OpenRouter key verified' };
      }
      if (res.status === 401 || res.status === 403) {
        return { status: 'invalid_revoked', message: 'OpenRouter returned 401/403: Key invalid or revoked' };
      }
      if (res.status >= 500) {
        return { status: 'unavailable', message: `OpenRouter metadata service unavailable (${res.status})` };
      }
      return { status: 'unknown', message: `OpenRouter response: HTTP ${res.status}` };
    }

    if (provider === 'openai') {
      const res = await fetchFn('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        return { status: 'enabled', message: 'OpenAI key verified' };
      }
      if (res.status === 401 || res.status === 403) {
        return { status: 'invalid_revoked', message: 'OpenAI returned 401/403: Key invalid or revoked' };
      }
      if (res.status >= 500) {
        return { status: 'unavailable', message: `OpenAI metadata service unavailable (${res.status})` };
      }
      return { status: 'unknown', message: `OpenAI response: HTTP ${res.status}` };
    }

    if (provider === 'anthropic') {
      const res = await fetchFn('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        return { status: 'enabled', message: 'Anthropic key verified' };
      }
      if (res.status === 401 || res.status === 403) {
        return { status: 'invalid_revoked', message: 'Anthropic returned 401/403: Key invalid or revoked' };
      }
      if (res.status >= 500) {
        return { status: 'unavailable', message: `Anthropic metadata service unavailable (${res.status})` };
      }
      return { status: 'unknown', message: `Anthropic response: HTTP ${res.status}` };
    }

    if (provider === 'google') {
      const res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        return { status: 'enabled', message: 'Google Gemini key verified' };
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { status: 'invalid_revoked', message: 'Google returned error: Key invalid or revoked' };
      }
      if (res.status >= 500) {
        return { status: 'unavailable', message: `Google metadata service unavailable (${res.status})` };
      }
      return { status: 'unknown', message: `Google response: HTTP ${res.status}` };
    }

    if (provider === 'deepinfra') {
      const res = await fetchFn('https://api.deepinfra.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) return { status: 'enabled', message: 'DeepInfra key verified' };
      if (res.status === 401 || res.status === 403) return { status: 'invalid_revoked', message: 'DeepInfra key invalid' };
      if (res.status >= 500) return { status: 'unavailable', message: `DeepInfra service unavailable (${res.status})` };
      return { status: 'unknown', message: `DeepInfra response: HTTP ${res.status}` };
    }

    if (provider === 'brave') {
      const res = await fetchFn('https://api.search.brave.com/res/v1/web/search?q=test&count=1', {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) return { status: 'enabled', message: 'Brave Search key verified' };
      if (res.status === 401 || res.status === 403) return { status: 'invalid_revoked', message: 'Brave Search key invalid' };
      if (res.status >= 500) return { status: 'unavailable', message: `Brave Search service unavailable (${res.status})` };
      return { status: 'unknown', message: `Brave Search response: HTTP ${res.status}` };
    }

    // Default for direct providers without a dedicated safe metadata endpoint
    return { status: 'enabled', message: 'Key saved' };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('timeout') || errorMsg.includes('abort') || errorMsg.includes('network') || errorMsg.includes('fetch')) {
      return { status: 'unavailable', message: 'Provider metadata check unreachable' };
    }
    return { status: 'unknown', message: errorMsg };
  }
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
 * Resolves per-provider plug-in state for the client. Providers are enabled
 * only when selected in the user's config; OpenCode is disabled in BYOK-only
 * mode because it has no per-user BYOK key path.
 */
export function buildProviderStates(
  config: RawUserConfig | null,
  _getEnv: (key: string) => string | undefined,
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
    const hasKey = id !== 'opencode' && row?.has_key === true;
    const enabled = enabledSet.has(id);
    let status: ProviderKeyStatus = 'not_configured';
    if (!hasKey) {
      status = 'not_configured';
    } else if (!enabled) {
      status = 'disabled';
    } else {
      status = 'enabled';
    }

    return {
      id,
      label: plugin.label,
      enabled,
      // Server secrets are never credentials in BYOK-only mode. Only the
      // caller's encrypted provider row can make a provider key-present.
      hasKey,
      keyLast4: typeof row?.key_last4 === 'string' ? row.key_last4 : null,
      offeredByDefault: plugin.offeredByDefault,
      defaultProvider: defaultProvider === id,
      status,
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

      case 'validate_key': {
        const provider = body.provider;
        if (!isProviderId(provider) || provider === 'opencode') {
          return jsonResponse({ error: 'invalid_provider' }, 400);
        }

        let keyToValidate: string | null = null;
        if (typeof body.apiKey === 'string' && body.apiKey.trim().length >= MIN_KEY_LENGTH) {
          keyToValidate = body.apiKey.trim();
        } else {
          const { data, error } = await supabase.rpc('get_user_provider_key_material', {
            p_subject_id: user.id,
            p_provider: provider,
          });
          if (error || typeof data !== 'string' || !data) {
            return jsonResponse({ provider, status: 'not_configured', message: 'No key configured' }, 200);
          }
          try {
            keyToValidate = await decryptKey(data);
          } catch {
            return jsonResponse({ provider, status: 'invalid_revoked', message: 'Failed to decrypt key' }, 200);
          }
        }

        const validation = await validateProviderKeyMetadata(
          provider,
          keyToValidate,
          deps.fetchFn ?? fetch,
        );

        return jsonResponse({
          provider,
          status: validation.status,
          message: validation.message,
        }, 200);
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
