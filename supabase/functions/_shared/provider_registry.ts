// provider_registry.ts — SINGLE SOURCE for provider plug-in metadata across
// client and router. src/providerRegistry.ts re-exports this module (same
// pattern as model_tariff.ts / pricingRegistry.ts).
//
// Provider model: every provider is a plug-in. `opencode` and `openrouter` are
// the two first-class gateways a user may choose as their default; every other
// provider is opt-in BYOK (the user connects a key and turns it on). A model
// owned by an opt-in provider also becomes available when OpenRouter is enabled,
// provided the model has an OpenRouter route (see OPENROUTER_MODEL_MAP).
//
// SECURITY: this module carries NO secrets and no Deno APIs so it can be
// imported by both Supabase Edge Functions and the Node/vitest client.

export type ProviderId =
  | 'opencode'
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'nvidia'
  | 'deepinfra';

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
   * True for the two first-class gateways (opencode, openrouter) a user may
   * pick as their default. False for opt-in BYOK providers.
   */
  offeredByDefault: boolean;
  /** `server` = deployment-wide secret; `byok` = per-user encrypted key. */
  keyKind: ProviderKeyKind;
}

export const PROVIDER_PLUGINS: Record<ProviderId, ProviderPlugin> = {
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    keyLabel: 'OpenCode API key',
    keyPlaceholder: 'Configured on the server',
    keyKind: 'server',
    offeredByDefault: true,
    docsHint: 'Provided by this deployment — no key needed.',
  },
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
    offeredByDefault: false,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keyLabel: 'OpenAI API key',
    keyPlaceholder: 'sk-...',
    keyKind: 'byok',
    offeredByDefault: false,
  },
  google: {
    id: 'google',
    label: 'Google',
    keyLabel: 'Google API key',
    keyPlaceholder: 'AIza...',
    keyKind: 'byok',
    offeredByDefault: false,
  },
  nvidia: {
    id: 'nvidia',
    label: 'NVIDIA',
    keyLabel: 'NVIDIA API key',
    keyPlaceholder: 'nvapi-...',
    keyKind: 'byok',
    offeredByDefault: false,
  },
  deepinfra: {
    id: 'deepinfra',
    label: 'DeepInfra',
    keyLabel: 'DeepInfra API key',
    keyPlaceholder: 'di-...',
    keyKind: 'byok',
    offeredByDefault: false,
  },
};

/** Stable display order for provider groups and settings cards. */
export const PROVIDER_PLUGIN_ORDER: ProviderId[] = [
  'opencode',
  'openrouter',
  'anthropic',
  'openai',
  'google',
  'nvidia',
  'deepinfra',
];

/** The providers a user may choose as their default gateway. */
export const DEFAULT_PROVIDER_CHOICES: ProviderId[] = ['opencode', 'openrouter'];

/** The provider a fresh user starts on when they have no stored preference. */
export const FALLBACK_DEFAULT_PROVIDER: ProviderId = 'opencode';

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
}

export interface RawUserProviderConfig {
  default_provider?: unknown;
  providers?: unknown;
}

export function resolveDefaultProvider(config: RawUserProviderConfig | null | undefined): ProviderId {
  const raw = config?.default_provider;
  return isDefaultProviderChoice(raw) ? raw : FALLBACK_DEFAULT_PROVIDER;
}

function readUserRows(config: RawUserProviderConfig | null | undefined): Map<ProviderId, boolean> {
  const rows = new Map<ProviderId, boolean>();
  if (Array.isArray(config?.providers)) {
    for (const raw of config.providers as RawUserProviderRow[]) {
      if (isProviderId(raw?.provider)) {
        rows.set(raw.provider, raw.enabled === true);
      }
    }
  }
  return rows;
}

/**
 * The set of provider plug-ins currently ON for a user.
 *
 * - Opt-in BYOK providers are on only when their row is explicitly enabled.
 * - The two first-class gateways (opencode, openrouter) are on when their row
 *   is enabled, or — when no row exists yet — when they are the chosen default.
 */
export function resolveEnabledProviderIds(
  config: RawUserProviderConfig | null | undefined,
): Set<ProviderId> {
  const rows = readUserRows(config);
  const fallbackDefault = resolveDefaultProvider(config);
  const enabled = new Set<ProviderId>();

  for (const id of PROVIDER_PLUGIN_ORDER) {
    const plugin = PROVIDER_PLUGINS[id];
    if (!plugin.offeredByDefault) {
      if (rows.get(id) === true) enabled.add(id);
      continue;
    }
    const on = rows.has(id) ? rows.get(id) === true : id === fallbackDefault;
    if (on) enabled.add(id);
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
