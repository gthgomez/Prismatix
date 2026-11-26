// src/services/providerSettings.ts
// Client for the provider-settings edge function (per-user provider plug-in
// state and BYOK key management). The server never returns plaintext keys —
// only `keyLast4` for display.

import { supabase } from '../lib/supabase';
import { CONFIG } from '../config';
import type { ProviderSettingsPayload } from '../types';
import type { ProviderId } from '../providerRegistry';

async function authedToken(expectedUserId: string): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(`provider_settings_auth_failed: ${error.message}`);
  const session = data.session;
  if (!expectedUserId || session?.user.id !== expectedUserId) {
    throw new Error('provider_settings_account_changed: signed-in account no longer matches this action');
  }
  const token = session?.access_token;
  if (!token) throw new Error('provider_settings_auth_failed: no session');
  return token;
}

function endpoint(): string {
  if (!CONFIG.PROVIDER_SETTINGS_ENDPOINT) {
    throw new Error('provider_settings_unavailable: missing endpoint');
  }
  return CONFIG.PROVIDER_SETTINGS_ENDPOINT;
}

async function request(
  method: 'GET' | 'POST',
  expectedUserId: string,
  body?: Record<string, unknown>,
): Promise<ProviderSettingsPayload> {
  const token = await authedToken(expectedUserId);
  const response = await fetch(endpoint(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(CONFIG.SUPABASE_ANON_KEY ? { apikey: CONFIG.SUPABASE_ANON_KEY } : {}),
    },
    signal: AbortSignal.timeout(15_000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    let message = `provider_settings_failed: ${response.status}`;
    try {
      const parsed = (await response.json()) as { error?: unknown };
      if (typeof parsed?.error === 'string') message = parsed.error;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { routes?: unknown }).routes)) {
    throw new Error('provider_settings_invalid_response: routes are required');
  }
  return payload as ProviderSettingsPayload;
}

export function fetchProviderSettings(expectedUserId: string): Promise<ProviderSettingsPayload> {
  return request('GET', expectedUserId);
}

export function setProviderKey(provider: ProviderId, apiKey: string, expectedUserId: string): Promise<ProviderSettingsPayload> {
  return request('POST', expectedUserId, { action: 'set_key', provider, apiKey });
}

export function setProviderEnabled(
  provider: ProviderId,
  enabled: boolean,
  expectedUserId: string,
): Promise<ProviderSettingsPayload> {
  return request('POST', expectedUserId, { action: 'set_enabled', provider, enabled });
}

export function refreshProviderInventory(provider: ProviderId, expectedUserId: string): Promise<ProviderSettingsPayload> {
  return request('POST', expectedUserId, { action: 'refresh_inventory', provider });
}

export function deleteProviderKey(provider: ProviderId, expectedUserId: string): Promise<ProviderSettingsPayload> {
  return request('POST', expectedUserId, { action: 'delete_key', provider });
}

export function setDefaultProvider(provider: ProviderId, expectedUserId: string): Promise<ProviderSettingsPayload> {
  return request('POST', expectedUserId, { action: 'set_default', provider });
}

export interface ProviderValidationResult {
  provider: ProviderId;
  status: import('../types').ProviderKeyStatus;
  message?: string;
  /** Client-only marker: this response belongs to a previous signed-in account. */
  stale?: boolean;
  /** Client-only scope captured by useProviderPlugins when validation starts. */
  clientAccountGeneration?: number;
}

export async function validateProviderKey(
  expectedUserId: string,
  provider: ProviderId,
  apiKey?: string,
): Promise<ProviderValidationResult> {
  const token = await authedToken(expectedUserId);
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(CONFIG.SUPABASE_ANON_KEY ? { apikey: CONFIG.SUPABASE_ANON_KEY } : {}),
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ action: 'validate_key', provider, apiKey }),
  });

  if (!response.ok) {
    let message = `validate_key_failed: ${response.status}`;
    try {
      const parsed = (await response.json()) as { error?: unknown };
      if (typeof parsed?.error === 'string') message = parsed.error;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }

  return (await response.json()) as ProviderValidationResult;
}
