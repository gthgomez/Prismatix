import { MODEL_TARIFF, MODEL_TARIFF_VERSION, isPriceExpired, isLegacyPriceStale } from './model_tariff.ts';
import type { ProviderModelMetadata } from './models_dev_metadata.ts';
import { servingRouteId, type ProviderInventory, type ServingRoute } from './serving_routes.ts';
import type { ProviderId } from './provider_registry.ts';
import { checkOpenCodeGoAllowance } from './opencode_allowance.ts';

const OFFICIAL: Partial<Record<ProviderId, { base: string; path: string; protocol: ServingRoute['protocol']; docs: string }>> = {
  openai: { base: 'https://api.openai.com', path: '/v1/models', protocol: 'responses', docs: 'https://platform.openai.com/docs/api-reference/models/list' },
  openrouter: { base: 'https://openrouter.ai/api', path: '/v1/models/user', protocol: 'chat_completions', docs: 'https://openrouter.ai/docs/api/api-reference/models/list-models-for-user' },
  anthropic: { base: 'https://api.anthropic.com', path: '/v1/models', protocol: 'anthropic_messages', docs: 'https://platform.claude.com/docs/en/api/models/list' },
  google: { base: 'https://generativelanguage.googleapis.com', path: '/v1beta/models', protocol: 'google_generate_content', docs: 'https://ai.google.dev/api/models' },
  deepinfra: { base: 'https://api.deepinfra.com', path: '/v1/models', protocol: 'chat_completions', docs: 'https://deepinfra.com/docs' },
  commandcode: { base: 'https://api.commandcode.ai', path: '/provider/v1/models', protocol: 'chat_completions', docs: 'https://commandcode.ai/docs' },
  opencode_go: { base: 'https://opencode.ai', path: '/inference/go/v1/models', protocol: 'chat_completions', docs: 'https://opencode.ai/docs/go/' },
  opencode: { base: 'https://opencode.ai', path: '/inference/v1/models', protocol: 'chat_completions', docs: 'https://opencode.ai/docs/zen/' },
  nvidia: { base: 'https://integrate.api.nvidia.com', path: '/v1/models', protocol: 'chat_completions', docs: 'https://build.nvidia.com/docs' },
};

const arrayAt = (obj: unknown, keys: string[]): unknown[] => {
  let value = obj;
  for (const key of keys) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
  return Array.isArray(value) ? value : [];
};
const str = (obj: unknown, key: string): string | undefined => {
  const value = obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' && value ? value : undefined;
};
const num = (obj: unknown, ...keys: string[]): number | undefined => {
  for (const key of keys) {
    const value = obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
};

const OFFICIAL_OPENAI_MODELS: Record<string, { input: number; output: number; context: number; maxOutput: number; source: string; tools: boolean; images: boolean }> = {
  'gpt-6.2-astra': { input: 8, output: 40, context: 1_050_000, maxOutput: 128_000, source: 'https://platform.openai.com/docs/models/gpt-6.2-astra', tools: true, images: true },
  'gpt-6.2-sol': { input: 2, output: 10, context: 1_050_000, maxOutput: 128_000, source: 'https://platform.openai.com/docs/models/gpt-6.2-sol', tools: true, images: true },
};

function record(raw: unknown): Record<string, unknown> | undefined {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
}

function rate(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?(?:e-?\d+)?$/i.test(value))) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function tariffFor(id: string, provider: ProviderId, raw: Record<string, unknown>, metadata?: Record<string, unknown>): ServingRoute['tariff'] | undefined {
  if (provider === 'openrouter') {
    const prices = record(raw.pricing);
    const input = rate(prices?.prompt);
    const output = rate(prices?.completion);
    if (input === undefined || output === undefined) return undefined;
    const cacheRead = rate(prices?.input_cache_read);
    const cacheWrite = rate(prices?.input_cache_write);
    const requestUsd = rate(prices?.request) ?? 0;
    const reasoning = rate(prices?.internal_reasoning);
    return {
      version: `openrouter:${input}/${output}/${cacheRead ?? '-'}/${cacheWrite ?? '-'}/${reasoning ?? '-'}/${requestUsd}`,
      source: OFFICIAL.openrouter!.docs, billing: 'prepaid_credits',
      inputPerMillion: input * 1e6, outputPerMillion: output * 1e6,
      ...(cacheRead !== undefined ? { cachedReadPerMillion: cacheRead * 1e6 } : {}),
      ...(cacheWrite !== undefined ? { cachedWritePerMillion: cacheWrite * 1e6 } : {}),
      ...(reasoning ? { reasoningPerMillion: reasoning * 1e6 } : {}), requestUsd,
    };
  }
  if (provider === 'opencode' || provider === 'opencode_go') {
    const cost = record(raw.cost);
    const text = record(cost?.text);
    const input = record(text?.input);
    const output = record(text?.output);
    if (Array.isArray(cost?.multipliers) && cost.multipliers.length) return undefined;
    const inputRate = rate(input?.price);
    const outputRate = rate(output?.price);
    if (inputRate === undefined || outputRate === undefined) return undefined;
    const cachedReadPerMillion = rate(record(input?.cache)?.read);
    const cachedWritePerMillion = rate(record(input?.cache)?.write);
    return {
      version: `opencode:${inputRate}/${outputRate}/${cachedReadPerMillion ?? '-'}/${cachedWritePerMillion ?? '-'}`,
      source: provider === 'opencode_go' ? 'https://opencode.ai/docs/go/#pricing' : 'https://opencode.ai/docs/zen/#pricing',
      billing: provider === 'opencode_go' ? 'subscription_allowance' : 'prepaid_credits',
      inputPerMillion: inputRate, outputPerMillion: outputRate, cachedReadPerMillion, cachedWritePerMillion,
    };
  }
  const direct = provider === 'openai' && Object.prototype.hasOwnProperty.call(OFFICIAL_OPENAI_MODELS, id) ? OFFICIAL_OPENAI_MODELS[id] : undefined;
  if (direct) return {
    version: 'openai:2026-11-26', source: direct.source, billing: 'pay_as_you_go',
    inputPerMillion: direct.input, outputPerMillion: direct.output,
  };
  const known = Object.prototype.hasOwnProperty.call(MODEL_TARIFF, id) ? MODEL_TARIFF[id] : undefined;
  const sourceRef = typeof known?.sourceRef === 'string' ? known.sourceRef : '';
  const ownsPublishedTariff = provider === 'openai' ? /openai\.com|openai-pricing/.test(sourceRef)
    : provider === 'anthropic' ? /anthropic\.com|anthropic-pricing/.test(sourceRef)
    : provider === 'google' ? /googleapis\.com|google-pricing/.test(sourceRef)
    : sourceRef === `${provider}-pricing`;
  if (known && ownsPublishedTariff && known.isEstimated === false && !isPriceExpired(known) && !isLegacyPriceStale(known)) {
    const input = rate(known.inputRatePer1M);
    const output = rate(known.outputRatePer1M);
    if (input !== undefined && output !== undefined && !known.longContextThreshold) {
      const expiry = known.effectiveTo ? Date.parse(known.effectiveTo) + 24 * 60 * 60 * 1000 : null;
      return {
        version: MODEL_TARIFF_VERSION, source: sourceRef,
        expiresAt: expiry && Number.isFinite(expiry) ? new Date(expiry).toISOString() : undefined,
        billing: 'pay_as_you_go', inputPerMillion: input, outputPerMillion: output,
        cachedReadPerMillion: rate(known.cachedReadRatePer1M), cachedWritePerMillion: rate(known.cachedWriteRatePer1M),
        reasoningPerMillion: rate(known.reasoningRatePer1M),
      };
    }
  }
  const price = record(metadata?.cost);
  const input = rate(price?.input);
  const output = rate(price?.output);
  // Public metadata enriches the authenticated inventory. A provider- or
  // model-specific pricing tier requires an explicit compatible tariff.
  if (!price || input === undefined || output === undefined ||
      Object.keys(price).some((key) => !['input', 'output', 'cache_read', 'cache_write'].includes(key))) return undefined;
  if (provider === 'nvidia' && input === 0 && output === 0) return undefined; // public free plans do not prove this account's billing arrangement
  const cachedReadPerMillion = rate(price.cache_read);
  const cachedWritePerMillion = rate(price.cache_write);
  return {
    source: 'https://models.dev/api.json', billing: 'pay_as_you_go',
    version: `models.dev:${str(metadata, 'last_updated') ?? 'unknown'}/${input}/${output}/${cachedReadPerMillion ?? '-'}/${cachedWritePerMillion ?? '-'}`,
    inputPerMillion: input, outputPerMillion: output, cachedReadPerMillion, cachedWritePerMillion,
  };
}

export function normalizeProviderModels(provider: ProviderId, payload: unknown, publicMetadata?: ProviderModelMetadata): ServingRoute[] {
  const spec = OFFICIAL[provider];
  if (!spec || provider === 'brave') return [];
  const rows = provider === 'google' ? arrayAt(payload, ['models']) : arrayAt(payload, ['data']);
  const routes = new Map<string, ServingRoute>();
  for (const item of rows) {
    const raw = record(item);
    if (!raw) continue;
    const upstreamId = provider === 'google' ? str(raw, 'name')?.replace(/^models\//, '') : str(raw, 'id');
    if (!upstreamId || !/^[A-Za-z0-9._:/-]{1,160}$/.test(upstreamId)) continue;
    if (provider === 'google' && !arrayAt(raw, ['supportedGenerationMethods']).includes('generateContent')) continue;
    if (provider === 'commandcode') continue; // The public list does not assert account access or tariffs.
    const metadata = publicMetadata?.get(upstreamId);
    const tariff = tariffFor(upstreamId, provider, raw, metadata);
    if (!tariff) continue;
    const openAI = provider === 'openai' && Object.prototype.hasOwnProperty.call(OFFICIAL_OPENAI_MODELS, upstreamId) ? OFFICIAL_OPENAI_MODELS[upstreamId] : undefined;
    const canonicalId = str(raw, 'canonical_slug') ?? str(raw, 'canonical_id') ?? str(metadata, 'canonical_model_id') ?? upstreamId;
    const modality = record(raw.modalities) ?? record(metadata?.modalities);
    const inputList = arrayAt(raw, ['architecture', 'input_modalities']);
    const outputList = arrayAt(raw, ['architecture', 'output_modalities']);
    const inputs = inputList.length ? inputList : arrayAt(modality, ['input']);
    const outputs = outputList.length ? outputList : arrayAt(modality, ['output']);
    if ((inputs.length && !inputs.includes('text')) || (outputs.length && (outputs.length !== 1 || outputs[0] !== 'text'))) continue;
    if (provider === 'opencode_go' && record(raw.go)?.training !== false) continue;
    let protocol = spec.protocol;
    if (provider === 'opencode' || provider === 'opencode_go') {
      const recommended = str(raw, 'recommended_api');
      if (recommended === 'responses') protocol = 'responses';
      else if (recommended === 'messages') protocol = 'anthropic_messages';
      else if (recommended === 'generate-content') protocol = 'google_generate_content';
      else if (recommended !== 'chat-completions') continue;
      if (raw.type !== undefined && raw.type !== 'chat') continue;
    }
    if (provider === 'openai' && !openAI && (!metadata || !inputs.includes('text') || !outputs.includes('text'))) continue;
    const limit = record(raw.limit) ?? record(metadata?.limit);
    const context = num(raw, 'context_length', 'context_window', 'inputTokenLimit') ?? num(limit, 'context') ?? openAI?.context ?? 0;
    const output = num(raw, 'max_completion_tokens', 'max_output_tokens', 'outputTokenLimit') ?? num(record(raw.top_provider), 'max_completion_tokens') ?? num(limit, 'output') ?? openAI?.maxOutput ?? 0;
    if (!Number.isSafeInteger(context) || !Number.isSafeInteger(output) || context < 128 || output < 64) continue;
    const capabilities = record(raw.capabilities);
    const chatOnlyInputs = inputs.some((value) => value === 'image' || (typeof value === 'string' && value.startsWith('image/')));
    const imagePrice = rate(record(raw.pricing)?.image);
    const id = servingRouteId(provider, upstreamId);
    const developer = canonicalId.includes('/') ? canonicalId.split('/')[0]! : str(raw, 'developer') ?? provider;
    routes.set(id, {
      id, provider, upstreamId, canonicalId, developer,
      name: str(raw, 'displayName') ?? str(raw, 'name') ?? str(metadata, 'name') ?? (openAI ? `GPT-6.2 ${upstreamId.endsWith('sol') ? 'Sol' : 'Astra'}` : upstreamId),
      protocol, contextWindow: context, maxOutputTokens: output,
      // Model APIs may publish a separate image rate. Those routes still serve
      // text, but do not admit images without a compatible image tariff.
      supportsImages: Boolean(openAI?.images || (chatOnlyInputs && provider === 'openrouter' && imagePrice === 0)),
      supportsTools: Boolean(openAI?.tools || metadata?.tool_call === true || record(capabilities?.tools)?.supported === true || arrayAt(raw, ['supported_parameters']).includes('tools')),
      supportsReasoning: Boolean(openAI || metadata?.reasoning === true || record(capabilities?.reasoning)?.supported === true || arrayAt(raw, ['supported_parameters']).includes('reasoning')),
      tariff,
    });
  }
  return [...routes.values()];
}

export async function discoverProviderInventory(provider: ProviderId, apiKey: string, options: { fetchFn?: typeof fetch; now?: Date; baseOverride?: string; publicMetadata?: ProviderModelMetadata | Promise<ProviderModelMetadata | undefined> } = {}): Promise<ProviderInventory> {
  const spec = OFFICIAL[provider];
  const now = (options.now ?? new Date()).toISOString();
  if (!spec) return { status: 'unverified', discoveredAt: null, checkedAt: now, modelCount: 0, routes: [] };
  try {
    if (provider === 'opencode_go') {
      const status = await checkOpenCodeGoAllowance(apiKey, options.fetchFn ?? fetch, options.baseOverride);
      if (status !== 'verified') return { status, discoveredAt: null, checkedAt: now, modelCount: 0, routes: [] };
    }
    if (provider === 'openrouter') {
      const authUrl = options.baseOverride ? `${options.baseOverride}/auth/key` : `${spec.base}/v1/auth/key`;
      const authCheck = await (options.fetchFn ?? fetch)(authUrl, {
        headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(8000),
      });
      if (authCheck.status === 401) return { status: 'invalid_revoked', discoveredAt: null, checkedAt: now, modelCount: 0, routes: [] };
      if (authCheck.status === 403 || authCheck.status === 402) return { status: 'restricted', discoveredAt: null, checkedAt: now, modelCount: 0, routes: [] };
      if (!authCheck.ok) return { status: authCheck.status >= 500 || authCheck.status === 429 ? 'unavailable' : 'unverified', discoveredAt: null, checkedAt: now, modelCount: 0, routes: [] };
      await authCheck.body?.cancel();
    }
    const endpoint = options.baseOverride ? `${options.baseOverride}/models` : `${spec.base}${spec.path}`;
    const response = await (options.fetchFn ?? fetch)(endpoint, {
      headers: provider === 'anthropic' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : provider === 'google' ? { 'x-goog-api-key': apiKey } : { Authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401) return { status: 'invalid_revoked', discoveredAt: null, checkedAt: now, modelCount: 0, routes: [] };
    if (response.status === 403 || response.status === 402) return { status: 'restricted', discoveredAt: null, checkedAt: now, modelCount: 0, routes: [] };
    if (response.status === 429) return { status: 'unavailable', discoveredAt: null, checkedAt: now, modelCount: 0, routes: [] };
    if (!response.ok) return { status: response.status >= 500 ? 'unavailable' : 'unverified', discoveredAt: null, checkedAt: now, modelCount: 0, routes: [] };
    const payload = await response.json();
    const modelRows = provider === 'google' ? arrayAt(payload, ['models']) : arrayAt(payload, ['data']);
    if (modelRows.length === 0 || modelRows.some((row) => !(provider === 'google' ? str(row, 'name') : str(row, 'id')))) {
      return { status: 'unverified', discoveredAt: null, checkedAt: now, modelCount: 0, routes: [] };
    }
    let routes = normalizeProviderModels(provider, payload, await options.publicMetadata);
    if (provider === 'opencode_go' && routes.length) {
      // Extra Usage can draw on a workspace's Console balance. Use the exact
      // Console model's published rate to conservatively bound possible cash.
      const consoleUrl = options.baseOverride
        ? `${options.baseOverride.replace('/opencode_go/v1', '/opencode/v1')}/public-models`
        : 'https://opencode.ai/inference/v1/models';
      const quote = await (options.fetchFn ?? fetch)(consoleUrl, { redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!quote.ok) return { status: 'unavailable', discoveredAt: null, checkedAt: now, modelCount: modelRows.length, routes: [] };
      const consoleRates = new Map(normalizeProviderModels('opencode', await quote.json()).map((route) => [route.upstreamId, route]));
      routes = routes.flatMap((route) => {
        const console = consoleRates.get(route.upstreamId);
        if (!console || console.canonicalId !== route.canonicalId) return [];
        return [{ ...route, tariff: {
          ...route.tariff, version: `${route.tariff.version}+${console.tariff.version}`,
          inputPerMillion: Math.max(route.tariff.inputPerMillion, console.tariff.inputPerMillion),
          outputPerMillion: Math.max(route.tariff.outputPerMillion, console.tariff.outputPerMillion),
          cachedReadPerMillion: Math.max(route.tariff.cachedReadPerMillion ?? route.tariff.inputPerMillion,
            console.tariff.cachedReadPerMillion ?? console.tariff.inputPerMillion),
          cachedWritePerMillion: Math.max(route.tariff.cachedWritePerMillion ?? route.tariff.inputPerMillion,
            console.tariff.cachedWritePerMillion ?? console.tariff.inputPerMillion),
        } }];
      });
    }
    const listedCount = modelRows.length;
    return provider === 'commandcode'
      ? { status: 'unverified', discoveredAt: null, checkedAt: now, modelCount: listedCount, routes: [] }
      : { status: 'verified', discoveredAt: now, checkedAt: now, modelCount: listedCount, routes };
  } catch {
    return { status: 'unavailable', discoveredAt: null, checkedAt: now, modelCount: 0, routes: [] };
  }
}
