// provider_registry.ts — SINGLE SOURCE for provider plug-in metadata across
// client and router. src/providerRegistry.ts re-exports this module (same
// pattern as model_tariff.ts / pricingRegistry.ts).
//
// Provider products and user-owned connection metadata. The legacy static
// OpenRouter mappings below are used by historical and offline catalog tools.
// Account inventories are the authority for executable routes.
//
// SECURITY: this module carries NO secrets and no Deno APIs so it can be
// imported by both Supabase Edge Functions and the Node/vitest client.

export type ProviderId =
  | 'opencode'
  | 'opencode_go'
  | 'commandcode'
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'nvidia'
  | 'deepinfra'
  | 'brave';

export type ProviderKeyKind = 'server' | 'byok';

export interface ProviderPlugin {
  id: ProviderId;
  label: string;
  /** Human label for the credential input, e.g. "DeepInfra API key". */
  keyLabel: string;
  /** Input placeholder shown when no key is stored. */
  keyPlaceholder: string;
  /** Optional hint surfaced next to the credential input. */
  docsHint?: string;
  /**
   * True when users may pick this provider as their default gateway.
   */
  offeredByDefault: boolean;
  /** `server` = deployment-wide secret; `byok` = per-user encrypted key. */
  keyKind: ProviderKeyKind;
}

export const PROVIDER_PLUGINS: Record<ProviderId, ProviderPlugin> = {
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    keyLabel: 'OpenCode Zen API key',
    keyPlaceholder: 'sk-...',
    keyKind: 'byok',
    offeredByDefault: true,
    docsHint: 'OpenCode Zen API key for Console models.',
  },
  opencode_go: { id: 'opencode_go', label: 'OpenCode Go', keyLabel: 'OpenCode Go API key', keyPlaceholder: 'sk-...', keyKind: 'byok', offeredByDefault: true },
  commandcode: { id: 'commandcode', label: 'Command Code', keyLabel: 'Command Code API key', keyPlaceholder: '...', keyKind: 'byok', offeredByDefault: true },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    keyLabel: 'OpenRouter API key',
    keyPlaceholder: 'sk-or-...',
    keyKind: 'byok',
    offeredByDefault: true,
    docsHint: 'One key unlocks routed access to many upstream models.',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    keyLabel: 'Anthropic API key',
    keyPlaceholder: 'sk-ant-...',
    keyKind: 'byok',
    offeredByDefault: true,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keyLabel: 'OpenAI API key',
    keyPlaceholder: 'sk-...',
    keyKind: 'byok',
    offeredByDefault: true,
  },
  google: {
    id: 'google',
    label: 'Google',
    keyLabel: 'Google API key',
    keyPlaceholder: 'AIza...',
    keyKind: 'byok',
    offeredByDefault: true,
  },
  nvidia: {
    id: 'nvidia',
    label: 'NVIDIA',
    keyLabel: 'NVIDIA API key',
    keyPlaceholder: 'nvapi-...',
    keyKind: 'byok',
    offeredByDefault: true,
  },
  deepinfra: {
    id: 'deepinfra',
    label: 'DeepInfra',
    keyLabel: 'DeepInfra API key',
    keyPlaceholder: 'di-...',
    keyKind: 'byok',
    offeredByDefault: true,
  },
  brave: {
    id: 'brave',
    label: 'Brave Search',
    keyLabel: 'Brave Search API key',
    keyPlaceholder: 'BSA...',
    keyKind: 'byok',
    offeredByDefault: false,
    docsHint: 'BYOK search key for web search citation grounding.',
  },
};

/** Stable display order for provider groups and settings cards. */
export const PROVIDER_PLUGIN_ORDER: ProviderId[] = [
  'opencode',
  'opencode_go',
  'commandcode',
  'openrouter',
  'anthropic',
  'openai',
  'google',
  'nvidia',
  'deepinfra',
  'brave',
];

/** The providers a user may choose as their default gateway. */
export const DEFAULT_PROVIDER_CHOICES: ProviderId[] = PROVIDER_PLUGIN_ORDER.filter((provider) => provider !== 'brave');

/** The provider a fresh user starts on when they have no stored preference. */
export const FALLBACK_DEFAULT_PROVIDER = null;

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROVIDER_PLUGINS, value);
}

export function isDefaultProviderChoice(value: unknown): value is ProviderId {
  return isProviderId(value) && PROVIDER_PLUGINS[value].offeredByDefault;
}

export function getProviderPlugin(id: ProviderId): ProviderPlugin {
  return PROVIDER_PLUGINS[id];
}

/** Raw per-user rows as returned by public.get_user_provider_config. */
export interface RawUserProviderRow {
  provider?: unknown;
  enabled?: unknown;
  has_key?: unknown;
  key_last4?: unknown;
  inventory?: unknown;
  credential_revision?: unknown;
}

export interface RawUserProviderConfig {
  default_provider?: unknown;
  providers?: unknown;
}

export function resolveDefaultProvider(config: RawUserProviderConfig | null | undefined): ProviderId | null {
  const raw = config?.default_provider;
  return isDefaultProviderChoice(raw) ? raw : null;
}

/** Enabled inference requires explicit enablement, a key and current qualified inventory. */
export function resolveEnabledProviderIds(config: RawUserProviderConfig | null | undefined): Set<ProviderId> {
  const enabled = new Set<ProviderId>();
  if (!Array.isArray(config?.providers)) return enabled;
  for (const row of config.providers as RawUserProviderRow[]) {
    const id = row?.provider;
    if (!isProviderId(id) || row.enabled !== true || row.has_key !== true) continue;
    if (id === 'brave') {
      enabled.add(id);
      continue;
    }
    const inventory = row.inventory as { status?: unknown; discoveredAt?: unknown; routes?: unknown; restrictedRouteIds?: unknown } | null;
    if (inventory?.status !== 'verified' || typeof inventory.discoveredAt !== 'string' || !Array.isArray(inventory.routes)) continue;
    const age = Date.now() - Date.parse(inventory.discoveredAt);
    if (!(age >= 0 && age <= 24 * 60 * 60 * 1000)) continue;
    const restricted = new Set(Array.isArray(inventory.restrictedRouteIds) ? inventory.restrictedRouteIds : []);
    if (inventory.routes.some((route) => route && typeof route.id === 'string' && !restricted.has(route.id))) enabled.add(id);
  }
  return enabled;
}

/** True when the user stored an encrypted key for the provider. */
export function userHasStoredKey(
  config: RawUserProviderConfig | null | undefined,
  id: ProviderId,
): boolean {
  if (!Array.isArray(config?.providers)) return false;
  return (config.providers as RawUserProviderRow[]).some(
    (raw) => raw?.provider === id && raw?.has_key === true,
  );
}

/**
 * Models owned by an opt-in provider that can also be served through the
 * OpenRouter aggregator, keyed by the native catalog model id and mapping to
 * the OpenRouter namespaced model id. Enabling OpenRouter unlocks exactly these
 * models when their native provider is not connected.
 */
export const OPENROUTER_MODEL_MAP: Record<string, string> = {
  'gpt-6-astra': 'openai/gpt-6-astra',
  'gpt-6-sol': 'openai/gpt-6-sol',
  'gpt-6-luna': 'openai/gpt-6-luna',
  'gpt-6.1-sol': 'openai/gpt-6.1-sol',
  'claude-haiku-5-5': 'anthropic/claude-haiku-5.5',
  'claude-sonnet-5-5': 'anthropic/claude-sonnet-5.5',
  'claude-opus-5-5': 'anthropic/claude-opus-5.5',
  'gemini-3.8-flash': 'google/gemini-3.8-flash',
  'opus-4.6': 'anthropic/claude-opus-4.6',
  'sonnet-4.6': 'anthropic/claude-sonnet-4.6',
  'haiku-4.5': 'anthropic/claude-haiku-4.5',
  'gemini-3-flash': 'google/gemini-3-flash-preview',
  'gemini-2.5-flash': 'google/gemini-2.5-flash',
  'gemini-3.1-pro': 'google/gemini-3.1-pro-preview',
};

export function hasOpenRouterRoute(modelId: string): boolean {
  return Object.prototype.hasOwnProperty.call(OPENROUTER_MODEL_MAP, modelId);
}

export function openRouterModelId(modelId: string): string | undefined {
  return OPENROUTER_MODEL_MAP[modelId];
}
