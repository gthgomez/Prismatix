import type { InferenceProviderId } from './serving_routes.ts';

const REGISTRY_URL = 'https://models.dev/api.json';
const CACHE_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const MAX_BYTES = 12 * 1024 * 1024;

export type RegistryModelMetadata = Record<string, unknown>;
export type ProviderModelMetadata = ReadonlyMap<string, RegistryModelMetadata>;
const ENRICHED_PROVIDERS = ['openai', 'anthropic', 'google', 'deepinfra', 'nvidia'] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function parseModelsDevCatalog(payload: unknown): Map<string, ProviderModelMetadata> | undefined {
  const root = record(payload);
  if (!root) return undefined;
  const catalog = new Map<string, ProviderModelMetadata>();
  for (const provider of ENRICHED_PROVIDERS) {
    const entries = record(record(root[provider])?.models);
    if (!entries) return undefined;
    const models = new Map<string, RegistryModelMetadata>();
    for (const [id, value] of Object.entries(entries)) {
      const model = record(value);
      if (model?.id !== id || !/^[A-Za-z0-9._:/-]{1,160}$/.test(id)) continue;
      if (model.status === 'deprecated' || model.status === 'retired') continue;
      models.set(id, model);
    }
    // An empty section is not a replacement for a previously valid catalog.
    if (!models.size) return undefined;
    catalog.set(provider, models);
  }
  return catalog;
}

export interface CatalogStore {
  rpc(functionName: string, params?: Record<string, unknown>): PromiseLike<{ data?: unknown; error?: unknown }>;
}

let snapshot: { catalog: Map<string, ProviderModelMetadata>; loadedAt: number } | undefined;
let nextAttempt = 0;
let inFlight: Promise<void> | undefined;

function persistableCatalog(catalog: Map<string, ProviderModelMetadata>) {
  const fields = ['id', 'name', 'status', 'last_updated', 'canonical_model_id', 'limit', 'modalities', 'cost', 'tool_call', 'reasoning'];
  return Object.fromEntries([...catalog].map(([provider, models]) => [provider, {
    models: Object.fromEntries([...models].map(([id, model]) => [id,
      Object.fromEntries(fields.filter((field) => model[field] !== undefined).map((field) => [field, model[field]])),
    ])),
  }]));
}

async function reconcile(store: CatalogStore): Promise<void> {
  try {
    const { data } = await store.rpc('get_provider_catalog_snapshot');
    const row = record(data);
    const storedAt = typeof row?.fetched_at === 'string' ? Date.parse(row.fetched_at) : 0;
    if ((!snapshot || storedAt > snapshot.loadedAt) && storedAt <= Date.now()) {
      const catalog = parseModelsDevCatalog(row?.models);
      if (catalog) snapshot = { catalog, loadedAt: storedAt };
    }
    if (snapshot && Date.now() - snapshot.loadedAt < CACHE_MS) return;
    const response = await fetch(REGISTRY_URL, { redirect: 'error', signal: AbortSignal.timeout(7000) });
    if (!response.ok || !response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let json = '';
    try {
      for (;;) {
        const page = await reader.read();
        if (page.done) break;
        size += page.value.byteLength;
        if (size > MAX_BYTES) return;
        json += decoder.decode(page.value, { stream: true });
      }
      const catalog = parseModelsDevCatalog(JSON.parse(json + decoder.decode()));
      if (!catalog) return;
      const models = persistableCatalog(catalog);
      const bytes = new TextEncoder().encode(JSON.stringify(models));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const version = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const { error } = await store.rpc('save_provider_catalog_snapshot', { p_version: version, p_models: models });
      if (!error) snapshot = { catalog, loadedAt: Date.now() };
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  } catch {
    // An unavailable source leaves the last valid version in place.
  }
}

/** Best-effort exact-ID enrichment for providers whose authenticated list omits metadata. */
export async function loadModelsDevMetadata(provider: InferenceProviderId, store: CatalogStore): Promise<ProviderModelMetadata | undefined> {
  if (!ENRICHED_PROVIDERS.some((supported) => supported === provider)) return undefined;
  const now = Date.now();
  if ((!snapshot || now - snapshot.loadedAt >= CACHE_MS) && now >= nextAttempt) {
    nextAttempt = now + RETRY_MS;
    inFlight ??= reconcile(store).finally(() => { inFlight = undefined; });
  }
  await inFlight;
  return snapshot && now - snapshot.loadedAt < CACHE_MS * 4 ? snapshot.catalog.get(provider) : undefined;
}
