// provider-settings — per-user provider plug-in state and BYOK key management.
//
// SECURITY: validates the caller's own JWT (never trusts a client-supplied
// subject id), encrypts keys with AES-256-GCM before storage, and returns
// metadata only (never plaintext or ciphertext). All DB writes go through
// service_role-only RPCs (see migration 20261010000000_px12).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ByokConfigError, decryptKey, encryptKey } from '../_shared/byok_crypto.ts';
import { discoverProviderInventory } from '../_shared/provider_discovery.ts';
import { loadModelsDevMetadata } from '../_shared/models_dev_metadata.ts';
import { isCurrentInventory, isCurrentRouteTariff, type ProviderInventory, type ServingRoute } from '../_shared/serving_routes.ts';
import { inferenceProviderEnabled, qualificationProviderBase } from '../_shared/provider_endpoint.ts';
import type { InferenceProviderId } from '../_shared/serving_routes.ts';
import {
  PROVIDER_PLUGIN_ORDER,
  PROVIDER_PLUGINS,
  isDefaultProviderChoice,
  isProviderId,
  resolveDefaultProvider,
  resolveEnabledProviderIds,
  type ProviderId,
} from '../_shared/provider_registry.ts';

const denoRuntime = (globalThis as unknown as { Deno?: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void } }).Deno;
const _ALLOWED_ORIGIN = denoRuntime?.env.get('ALLOWED_ORIGIN') || 'http://localhost:3000';

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
const activeRefreshes = new Map<string, Promise<'saved' | 'changed' | 'missing'>>();

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
  | 'restricted'
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
  credential_revision?: unknown;
  inventory?: unknown;
}

export interface ProviderStatePayload {
  providers: Array<{
    id: ProviderId;
    label: string;
    enabled: boolean;
    userEnabled: boolean;
    hasKey: boolean;
    keyLast4: string | null;
    offeredByDefault: boolean;
    defaultProvider: boolean;
    status: ProviderKeyStatus;
    statusMessage?: string;
    inventoryStatus: string;
    lastSuccessfulRefresh: string | null;
    availableModelCount: number;
    qualifiedModelCount: number;
  }>;
  defaultProvider: ProviderId | null;
  routes: ServingRoute[];
}

/**
 * Validates a provider API key using safe metadata checks without paid inference.
 * Rejects with invalid_revoked on 401/403, unavailable on 5xx or network errors,
 * and enabled only on successful metadata retrieval.
 */
export async function validateProviderKeyMetadata(
  provider: ProviderId,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  baseOverride?: string,
): Promise<{ status: ProviderKeyStatus; message?: string }> {
  try {
    if (provider === 'openrouter') {
      const res = await fetchFn(baseOverride ? `${baseOverride}/auth/key` : 'https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: 'error',
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        return { status: 'enabled', message: 'OpenRouter key verified' };
      }
      if (res.status === 401) {
        return { status: 'invalid_revoked', message: 'OpenRouter returned 401: Key invalid or revoked' };
      }
      if (res.status === 403 || res.status === 402) return { status: 'restricted', message: 'OpenRouter account or model access is restricted' };
      if (res.status >= 500) {
        return { status: 'unavailable', message: `OpenRouter metadata service unavailable (${res.status})` };
      }
      return { status: 'unknown', message: `OpenRouter response: HTTP ${res.status}` };
    }

    if (provider === 'openai') {
      const res = await fetchFn(baseOverride ? `${baseOverride}/models` : 'https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: 'error',
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        return { status: 'enabled', message: 'OpenAI key verified' };
      }
      if (res.status === 401) {
        return { status: 'invalid_revoked', message: 'OpenAI returned 401: Key invalid or revoked' };
      }
      if (res.status === 403 || res.status === 402) return { status: 'restricted', message: 'OpenAI account or model access is restricted' };
      if (res.status >= 500) {
        return { status: 'unavailable', message: `OpenAI metadata service unavailable (${res.status})` };
      }
      return { status: 'unknown', message: `OpenAI response: HTTP ${res.status}` };
    }

    if (provider === 'anthropic') {
      const res = await fetchFn(baseOverride ? `${baseOverride}/models` : 'https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        return { status: 'enabled', message: 'Anthropic key verified' };
      }
      if (res.status === 401) {
        return { status: 'invalid_revoked', message: 'Anthropic returned 401: Key invalid or revoked' };
      }
      if (res.status === 403 || res.status === 402) return { status: 'restricted', message: 'Anthropic account or model access is restricted' };
      if (res.status >= 500) {
        return { status: 'unavailable', message: `Anthropic metadata service unavailable (${res.status})` };
      }
      return { status: 'unknown', message: `Anthropic response: HTTP ${res.status}` };
    }

    if (provider === 'google') {
      const res = await fetchFn(baseOverride ? `${baseOverride}/models` : 'https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': apiKey },
        redirect: 'error',
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        return { status: 'enabled', message: 'Google Gemini key verified' };
      }
      if (res.status === 400 || res.status === 401) {
        return { status: 'invalid_revoked', message: 'Google returned error: Key invalid or revoked' };
      }
      if (res.status === 403 || res.status === 402) return { status: 'restricted', message: 'Google account or model access is restricted' };
      if (res.status >= 500) {
        return { status: 'unavailable', message: `Google metadata service unavailable (${res.status})` };
      }
      return { status: 'unknown', message: `Google response: HTTP ${res.status}` };
    }

    if (provider === 'deepinfra') {
      const res = await fetchFn(baseOverride ? `${baseOverride}/models` : 'https://api.deepinfra.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: 'error',
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) return { status: 'enabled', message: 'DeepInfra key verified' };
      if (res.status === 401) return { status: 'invalid_revoked', message: 'DeepInfra key invalid' };
      if (res.status === 403 || res.status === 402) return { status: 'restricted', message: 'DeepInfra account or model access is restricted' };
      if (res.status >= 500) return { status: 'unavailable', message: `DeepInfra service unavailable (${res.status})` };
      return { status: 'unknown', message: `DeepInfra response: HTTP ${res.status}` };
    }

    if (provider === 'brave') {
      const res = await fetchFn('https://api.search.brave.com/res/v1/web/search?q=test&count=1', {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) return { status: 'enabled', message: 'Brave Search key verified' };
      if (res.status === 401) return { status: 'invalid_revoked', message: 'Brave Search key invalid' };
      if (res.status === 403 || res.status === 402) return { status: 'restricted', message: 'Brave Search account or plan is restricted' };
      if (res.status >= 500) return { status: 'unavailable', message: `Brave Search service unavailable (${res.status})` };
      return { status: 'unknown', message: `Brave Search response: HTTP ${res.status}` };
    }

    // A provider without a dedicated metadata endpoint cannot be reported as
    // verified merely because the key was saved.
    return {
      status: 'unknown',
      message: 'A metadata verification check is not available in Prismatix for this provider.',
    };
  } catch (err: unknown) {
    const errorName = err instanceof Error ? err.name.toLowerCase() : '';
    const errorMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (errorName === 'timeouterror' || errorName === 'aborterror'
      || /timeout|timed out|abort|network|fetch/.test(errorMsg)) {
      return { status: 'unavailable', message: 'Provider metadata check unreachable' };
    }
    return { status: 'unknown', message: 'Provider metadata check failed unexpectedly' };
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

function retainLastSuccessfulInventory(previous: unknown, next: ProviderInventory): ProviderInventory {
  if (next.status === 'verified' || !previous || typeof previous !== 'object') return next;
  const old = previous as ProviderInventory;
  return old.discoveredAt && Array.isArray(old.routes)
    ? { ...next, discoveredAt: old.discoveredAt, modelCount: old.modelCount, routes: old.routes }
    : next;
}

/**
 * Keeps the user's setting and the set of routes ready for dispatch distinct.
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
  const now = Date.now();
  const usable = (row: RawProviderRow | undefined): row is RawProviderRow & { inventory: ProviderInventory } =>
    Boolean(row && row.enabled === true && row.has_key === true && isCurrentInventory(row.inventory as ProviderInventory | undefined, now));
  const routes = PROVIDER_PLUGIN_ORDER.flatMap((id) => {
    const row = rows.get(id);
    if (id === 'brave' || !usable(row) || !inferenceProviderEnabled(id, getEnv)) return [];
    const restricted = row.inventory.restrictedRouteIds ?? [];
    return row.inventory.routes.filter((route) => !restricted.includes(route.id) && isCurrentRouteTariff(route.tariff, now));
  });
  const selectedDefault = defaultProvider && routes.some((route) => route.provider === defaultProvider) ? defaultProvider : null;

  const providers = PROVIDER_PLUGIN_ORDER.map((id) => {
    const plugin = PROVIDER_PLUGINS[id];
    const row = rows.get(id);
    const hasKey = row?.has_key === true;
    const userEnabled = enabledSet.has(id) && row?.enabled === true && hasKey;
    const enabled = id === 'brave'
      ? userEnabled
      : routes.some((route) => route.provider === id);
    const inventory = row?.inventory && typeof row.inventory === 'object' ? row.inventory as ProviderInventory : null;
    let status: ProviderKeyStatus = 'not_configured';
    if (!hasKey) {
      status = 'not_configured';
    } else if (inventory?.status === 'invalid_revoked') {
      status = 'invalid_revoked';
    } else if (inventory?.status === 'unavailable') {
      status = 'unavailable';
    } else if (enabled) {
      status = 'enabled';
    } else {
      status = row?.enabled === true ? 'unknown' : 'disabled';
    }

    return {
      id,
      label: plugin.label,
      enabled,
      userEnabled,
      // Server secrets are never credentials in BYOK-only mode. Only the
      // caller's encrypted provider row can make a provider key-present.
      hasKey,
      keyLast4: typeof row?.key_last4 === 'string' ? row.key_last4 : null,
      offeredByDefault: plugin.offeredByDefault,
      defaultProvider: selectedDefault === id,
      status,
      inventoryStatus: !hasKey ? 'not_configured' : typeof inventory?.status === 'string' ? inventory.status : 'unverified',
      lastSuccessfulRefresh: typeof inventory?.discoveredAt === 'string' ? inventory.discoveredAt : null,
      availableModelCount: typeof inventory?.modelCount === 'number' ? inventory.modelCount : 0,
      qualifiedModelCount: routes.filter((route) => route.provider === id).length,
    };
  });

  return { providers, defaultProvider: selectedDefault, routes };
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
  const getEnv = deps.getEnv ?? ((key: string): string | undefined => denoRuntime?.env.get(key));
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

  const subjectId = user.id;
  function refreshSavedRow(provider: InferenceProviderId, row: RawProviderRow): Promise<'saved' | 'changed' | 'missing'> {
    const revision = row.credential_revision;
    if (typeof revision !== 'string') return Promise.resolve('missing');
    const scope = `${subjectId}:${provider}:${revision}`;
    const pending = activeRefreshes.get(scope);
    if (pending) return pending;
    const refresh = (async (): Promise<'saved' | 'changed' | 'missing'> => {
      const { data: ciphertext, error } = await supabase.rpc('get_user_provider_key_material', {
        p_subject_id: subjectId, p_provider: provider,
      });
      if (error || typeof ciphertext !== 'string' || !ciphertext) return 'missing';
      const key = await decryptKey(ciphertext);
      const baseOverride = qualificationProviderBase(provider, getEnv);
      const freshInventory = await discoverProviderInventory(provider, key, {
        fetchFn: deps.fetchFn ?? fetch, baseOverride,
        publicMetadata: !baseOverride && !deps.fetchFn ? loadModelsDevMetadata(provider, supabase) : undefined,
      });
      const inventory = retainLastSuccessfulInventory(row.inventory, freshInventory);
      const { data: saved, error: saveError } = await supabase.rpc('save_user_provider_inventory', {
        p_subject_id: subjectId, p_provider: provider, p_credential_revision: revision,
        p_expected_ciphertext: ciphertext, p_inventory: inventory,
      });
      if (saveError) throw new Error('save_inventory_failed');
      return saved === true ? 'saved' : 'changed';
    })().finally(() => { activeRefreshes.delete(scope); });
    activeRefreshes.set(scope, refresh);
    return refresh;
  }

  try {
    if (req.method === 'GET') {
      const config = await loadUserConfig(supabase, user.id);
      const rows = Array.isArray(config?.providers) ? config.providers as RawProviderRow[] : [];
      // Only active saved connections are eligible for opportunistic refresh.
      // Bound outbound work even when several inventories expired together.
      const stale = rows.filter((row) => {
        const id = row.provider;
        if (!isProviderId(id) || id === 'brave' || !inferenceProviderEnabled(id, getEnv) ||
            row.enabled !== true || row.has_key !== true || typeof row.credential_revision !== 'string') return false;
        const inventory = row.inventory as ProviderInventory | undefined;
        const lastAttempt = inventory?.checkedAt ? Date.parse(inventory.checkedAt) : 0;
        if (inventory?.status === 'invalid_revoked' || inventory?.status === 'restricted' || isCurrentInventory(inventory)) return false;
        return Date.now() - lastAttempt > 30 * 60_000;
      }).slice(0, 2);
      if (!stale.length) return jsonResponse(buildProviderStates(config, getEnv), 200);
      await Promise.allSettled(stale.map((row) => refreshSavedRow(row.provider as InferenceProviderId, row)));
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
        if (!isProviderId(provider)) {
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
        if (provider === 'brave') return await respondWithState();
        const baseOverride = qualificationProviderBase(provider, getEnv);
        const current = await loadUserConfig(supabase, user.id);
        const row = Array.isArray(current?.providers) ? (current.providers as RawProviderRow[]).find((r) => r.provider === provider) : undefined;
        const freshInventory = await discoverProviderInventory(provider, apiKey, { fetchFn: deps.fetchFn ?? fetch, baseOverride, publicMetadata: !baseOverride && !deps.fetchFn ? loadModelsDevMetadata(provider, supabase) : undefined });
        const inventory = retainLastSuccessfulInventory(row?.inventory, freshInventory);
        if (row && typeof row.credential_revision === 'string') {
          const { data: saved, error: saveError } = await supabase.rpc('save_user_provider_inventory', {
            p_subject_id: user.id, p_provider: provider, p_credential_revision: row.credential_revision,
            p_expected_ciphertext: encrypted.ciphertext, p_inventory: inventory,
          });
          if (saveError) throw new Error(saveError.message ?? 'save_inventory_failed');
          if (saved !== true) return jsonResponse({ error: 'credential_changed_during_refresh' }, 409);
        }
        return await respondWithState();
      }

      case 'refresh_inventory': {
        const provider = body.provider;
        if (!isProviderId(provider) || provider === 'brave') return jsonResponse({ error: 'invalid_provider' }, 400);
        const config = await loadUserConfig(supabase, user.id);
        const row = Array.isArray(config?.providers) ? (config.providers as RawProviderRow[]).find((r) => r.provider === provider) : undefined;
        if (!row || typeof row.credential_revision !== 'string') return jsonResponse({ error: 'not_configured' }, 409);
        const previousInventory = row.inventory as ProviderInventory | undefined;
        const lastCheckAge = previousInventory?.checkedAt ? Date.now() - Date.parse(previousInventory.checkedAt) : Number.POSITIVE_INFINITY;
        if (lastCheckAge >= 0 && lastCheckAge < 30_000) {
          return jsonResponse({ error: 'refresh_throttled', retryAfterSeconds: Math.ceil((30_000 - lastCheckAge) / 1000) }, 429);
        }
        const refreshed = await refreshSavedRow(provider, row);
        if (refreshed === 'missing') return jsonResponse({ error: 'not_configured' }, 409);
        if (refreshed === 'changed') return jsonResponse({ error: 'credential_changed_during_refresh' }, 409);
        return await respondWithState();
      }

      case 'set_enabled': {
        const provider = body.provider;
        if (!isProviderId(provider)) {
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
        if (!isProviderId(provider)) {
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
        if (!isProviderId(provider)) {
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
          provider === 'brave' ? undefined : qualificationProviderBase(provider as InferenceProviderId, getEnv),
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
  } catch {
    console.error('[provider-settings] request failed');
    return jsonResponse({ error: 'provider_settings_failed' }, 500);
  }
}

denoRuntime?.serve((req: Request): Promise<Response> => handleProviderSettings(req));
