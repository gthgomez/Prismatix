// src/services/providerSettings.ts
// Client for the provider-settings edge function (per-user provider plug-in
// state and BYOK key management). The server never returns plaintext keys —
// only `keyLast4` for display.

import { supabase } from '../lib/supabase';
import { CONFIG } from '../config';
import type { ProviderSettingsPayload } from '../types';
import type { ProviderId } from '../providerRegistry';

async function authedToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(`provider_settings_auth_failed: ${error.message}`);
  const token = data.session?.access_token;
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
  body?: Record<string, unknown>,
): Promise<ProviderSettingsPayload> {
  const token = await authedToken();
  const response = await fetch(endpoint(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(CONFIG.SUPABASE_ANON_KEY ? { apikey: CONFIG.SUPABASE_ANON_KEY } : {}),
    },
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

  return (await response.json()) as ProviderSettingsPayload;
}

export function fetchProviderSettings(): Promise<ProviderSettingsPayload> {
  return request('GET');
}

export function setProviderKey(provider: ProviderId, apiKey: string): Promise<ProviderSettingsPayload> {
  return request('POST', { action: 'set_key', provider, apiKey });
}

export function setProviderEnabled(
  provider: ProviderId,
  enabled: boolean,
): Promise<ProviderSettingsPayload> {
  return request('POST', { action: 'set_enabled', provider, enabled });
}

export function deleteProviderKey(provider: ProviderId): Promise<ProviderSettingsPayload> {
  return request('POST', { action: 'delete_key', provider });
}

export function setDefaultProvider(provider: ProviderId): Promise<ProviderSettingsPayload> {
  return request('POST', { action: 'set_default', provider });
}
