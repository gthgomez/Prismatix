// index.ts - Multi-provider Router Edge Function (Anthropic + OpenAI + Google)

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  countTokens,
  determineRoute,
  type ImageAttachment,
  type Message,
  MODEL_REGISTRY,
  normalizeModelOverride,
  type Provider,
  type RouteDecision,
  type RouterModel,
  type RouterParams,
} from './router_logic.ts';
import { calculateCostBreakdown, calculatePreFlightCost } from './cost_engine.ts';
import {
  DEFAULT_DEBATE_THRESHOLD,
  getDebatePlan,
  type DebateProfile,
  type DebateTrigger,
} from './debate_profiles.ts';
import {
  buildChallengerPrompt,
  buildSynthesisPrompt,
  type ChallengerOutput,
} from './debate_prompts.ts';
import { createNormalizedProxyStream } from './sse_normalizer.ts';
import {
  type GeminiFlashThinkingLevel,
  buildAnthropicStreamPayload,
  buildGoogleJsonPayload,
  buildGoogleStreamPayload,
  buildOpenAILegacyStreamPayload,
  buildOpenAIStreamPayload,
} from './provider_payloads.ts';
import {
  buildDebateHeaders,
  buildFallbackSequence,
  computeDebateEligibility,
  runDebateStageWithTimeout,
  selectDebateWorkerMaxTokens,
  serializeMessagesForCost,
} from './debate_runtime.ts';
import {
  countHighCriticalIssues,
  SKEPTIC_GEMINI_SCHEMA,
  SYNTH_DECISION_GEMINI_SCHEMA,
  type SkepticOutput,
  type SynthDecision,
  validateHighCriticalSurvival,
  validateSkepticOutput,
  validateSynthDecision,
} from './smd_schemas.ts';
import {
  buildSmdDraftPrompt,
  buildSmdFormatterPrompt,
  buildSmdSkepticPrompt,
  buildSmdSynthDecisionPrompt,
} from './smd_prompts.ts';
import {
  type CostLogRecord,
  computeUserTokenCount,
  estimateVideoPromptTokens,
  persistCostLog,
  persistMessageAsync,
  validateConversation,
} from './db_helpers.ts';
import {
  fetchRelevantMemories,
  maybeSummarizeConversationAsync,
  type MemoryRetrievalResult,
} from './memory_helpers.ts';
import {
  buildVideoContextBlock,
  buildVideoUiNotesJson,
  validateReadyVideoAssets,
} from './video_helpers.ts';

// ============================================================================
// LOCAL TYPE DEFINITIONS
// ============================================================================

interface UpstreamCallResult {
  response: Response;
  extractDeltas: (payload: unknown) => string[];
  effectiveModelId: string;
  effectiveGeminiFlashThinkingLevel?: GeminiFlashThinkingLevel;
}

interface GoogleModelRecord {
  name: string;
  supportedGenerationMethods: string[];
}

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

// SECURITY: Lock CORS to the configured frontend origin.
// Set ALLOWED_ORIGIN in Supabase project secrets (e.g. https://your-app.vercel.app).
// Defaults to localhost for local development only.
const _ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || 'http://localhost:3000';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': _ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
  'Access-Control-Expose-Headers':
    'X-Router-Model, X-Router-Model-Id, X-Provider, X-Model-Override, X-Router-Rationale, X-Complexity-Score, X-Gemini-Thinking-Level, X-Memory-Hits, X-Memory-Tokens, X-Cost-Estimate-USD, X-Cost-Pricing-Version, X-Debate-Mode, X-Debate-Profile, X-Debate-Trigger, X-Debate-Model, X-Debate-Cost-Note, X-SMD-Mode, X-SMD-Issue-Count, X-SMD-High-Critical-Count, X-SMD-Unresolved-Risk-Count, X-SMD-Parse-Status, X-SMD-Fast-Path',
};

const FUNCTION_TIMEOUT_MS = 55000;
const MAX_QUERY_LENGTH = 50000;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const VIDEO_CONTEXT_MAX_CHARS = 5000;
const DEV_MODE = Deno.env.get('DEV_MODE') === 'true';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY') || '';
const NVIDIA_API_KEY = Deno.env.get('NVIDIA_API_KEY') || '';
const DEEPINFRA_API_KEY = Deno.env.get('DEEPINFRA_API_KEY') || '';

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = Deno.env.get(name);
  if (raw === null || raw === undefined || raw.trim() === '') return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return defaultValue;
}

const ENABLE_ANTHROPIC = envFlag('ENABLE_ANTHROPIC', true);
const ENABLE_OPENAI = envFlag('ENABLE_OPENAI', true);
const ENABLE_GOOGLE = envFlag('ENABLE_GOOGLE', true);
const ENABLE_NVIDIA = envFlag('ENABLE_NVIDIA', true);
const ENABLE_DEEPINFRA = envFlag('ENABLE_DEEPINFRA', true);
const ENABLE_VIDEO_PIPELINE = envFlag('ENABLE_VIDEO_PIPELINE', false);

// Debate Mode flags (router "tool" toggle)
const ENABLE_DEBATE_MODE = envFlag('ENABLE_DEBATE_MODE', false);
const ENABLE_DEBATE_AUTO = envFlag('ENABLE_DEBATE_AUTO', false);
const DEBATE_COMPLEXITY_THRESHOLD = Number(Deno.env.get('DEBATE_COMPLEXITY_THRESHOLD') || '') ||
  DEFAULT_DEBATE_THRESHOLD;
// Per-challenger token budget caps — prevents cost runaway regardless of text truncation.
const DEBATE_WORKER_MAX_TOKENS_GENERAL = Number(Deno.env.get('DEBATE_WORKER_MAX_TOKENS_GENERAL') || '') || 400;
const DEBATE_WORKER_MAX_TOKENS_CODE = Number(Deno.env.get('DEBATE_WORKER_MAX_TOKENS_CODE') || '') || 700;
const DEBATE_WORKER_MAX_TOKENS_VIDEO_UI = Number(Deno.env.get('DEBATE_WORKER_MAX_TOKENS_VIDEO_UI') || '') || 420;
const DEBATE_VIDEO_UI_SYNTHESIS_MAX_TOKENS = Number(Deno.env.get('DEBATE_VIDEO_UI_SYNTHESIS_MAX_TOKENS') || '') || 900;
const DEBATE_VIDEO_UI_STAGE_TIMEOUT_MS = Number(Deno.env.get('DEBATE_VIDEO_UI_STAGE_TIMEOUT_MS') || '') || 18000;
const DEBATE_VIDEO_UI_NOTES_MAX_CHARS = Number(Deno.env.get('DEBATE_VIDEO_UI_NOTES_MAX_CHARS') || '') || 8000;

// ── SMD v1.1 Light flags ──────────────────────────────────────────────────────
// Master switch — off by default; turn on only for controlled experiments.
const ENABLE_SMD_LIGHT = envFlag('ENABLE_SMD_LIGHT', false);
// Fast-path guard thresholds (tune without redeploying via env vars).
const SMD_FAST_PATH_MIN_TOKENS = Number(Deno.env.get('SMD_FAST_PATH_MIN_TOKENS') || '') || 25;
// SMD is locked to Gemini Flash for the experiment (cost control + single-model rule).
const SMD_MODEL_TIER: RouterModel = 'gemini-2.5-flash';
// Stage timeout for the non-streaming JSON stages (ms).
const SMD_JSON_STAGE_TIMEOUT_MS = Number(Deno.env.get('SMD_JSON_STAGE_TIMEOUT_MS') || '') || 15000;
// Draft output cap fed to later stages (chars, not tokens — cheap truncation guard).
const SMD_DRAFT_MAX_CHARS = Number(Deno.env.get('SMD_DRAFT_MAX_CHARS') || '') || 6000;
// Token budget caps per stage.
const SMD_DRAFT_BUDGET = Number(Deno.env.get('SMD_DRAFT_BUDGET') || '') || 1500;
const SMD_SKEPTIC_BUDGET = Number(Deno.env.get('SMD_SKEPTIC_BUDGET') || '') || 1024;
const SMD_SYNTH_BUDGET = Number(Deno.env.get('SMD_SYNTH_BUDGET') || '') || 1024;
const SMD_FORMATTER_BUDGET = MODEL_REGISTRY[SMD_MODEL_TIER].budgetCap;

const GOOGLE_MODELS_CACHE_TTL_MS = 10 * 60 * 1000;
let googleModelsCache: { fetchedAt: number; models: GoogleModelRecord[] } | null = null;


// ============================================================================
// PROVIDER HELPERS
// ============================================================================

function isProviderEnabled(provider: Provider): boolean {
  switch (provider) {
    case 'anthropic':
      return ENABLE_ANTHROPIC;
    case 'openai':
      return ENABLE_OPENAI;
    case 'google':
      return ENABLE_GOOGLE;
    case 'nvidia':
      return ENABLE_NVIDIA;
    case 'deepinfra':
      return ENABLE_DEEPINFRA;
  }
}

function hasProviderCredentials(provider: Provider): boolean {
  switch (provider) {
    case 'anthropic':
      return !!ANTHROPIC_API_KEY;
    case 'openai':
      return !!OPENAI_API_KEY;
    case 'google':
      return !!GOOGLE_API_KEY;
    case 'nvidia':
      return !!NVIDIA_API_KEY;
    case 'deepinfra':
      return !!DEEPINFRA_API_KEY;
  }
}

function isProviderReady(provider: Provider): boolean {
  return isProviderEnabled(provider) && hasProviderCredentials(provider);
}

function hasAtLeastOneProviderConfigured(): boolean {
  return isProviderReady('anthropic') || isProviderReady('openai') || isProviderReady('google') || isProviderReady('nvidia') || isProviderReady('deepinfra');
}

function fallbackModel(): RouterModel | undefined {
  if (isProviderReady('google')) return 'gemini-2.5-flash';
  if (isProviderReady('openai')) return 'gpt-5.4-mini';
  if (isProviderReady('anthropic')) return 'sonnet-4.6';
  return undefined;
}

function normalizeGeminiFlashThinkingLevel(input?: string): GeminiFlashThinkingLevel {
  const normalized = String(input || '').trim().toLowerCase();
  if (normalized === 'low') return 'low';
  return 'high';
}

function decisionFromModel(
  modelTier: RouterModel,
  complexityScore: number,
  rationaleTag: string,
): RouteDecision {
  const modelCfg = MODEL_REGISTRY[modelTier];
  return {
    provider: modelCfg.provider,
    model: modelCfg.modelId,
    modelTier,
    budgetCap: modelCfg.budgetCap,
    rationaleTag,
    complexityScore,
  };
}

function normalizeDecisionAgainstProviderAvailability(
  decision: RouteDecision,
  normalizedOverride: RouterModel | undefined,
): { decision: RouteDecision; error?: string } {
  if (isProviderReady(decision.provider)) {
    return { decision };
  }

  if (normalizedOverride) {
    return {
      decision,
      error: `Requested model '${normalizedOverride}' requires provider '${decision.provider}', ` +
        `but it is not configured or enabled on the server.`,
    };
  }

  const fallback = fallbackModel();
  if (!fallback) {
    return {
      decision,
      error: 'No enabled provider has valid credentials configured on the server.',
    };
  }

  const fallbackDecision = decisionFromModel(
    fallback,
    decision.complexityScore,
    `provider-unavailable-fallback-${decision.provider}`,
  );

  return {
    decision: fallbackDecision,
  };
}

// ============================================================================
// DEBATE MODE HELPERS
// ============================================================================

function normalizeDebateProfile(input?: string): DebateProfile {
  const v = String(input || '').trim().toLowerCase();
  if (v === 'video_ui' || v === 'video-ui' || v === 'videoui') return 'video_ui';
  if (v === 'code' || v === 'coding') return 'code';
  return 'general';
}

function parseVideoUiModelLadder(input?: string): RouterModel[] {
  const fallback: RouterModel[] = ['gemini-3.1-pro', 'gemini-2.5-flash'];
  const raw = String(input || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (raw.length === 0) return fallback;

  const out: RouterModel[] = [];
  for (const item of raw) {
    // Accept both new and old env var values for backwards compat
    if (item === 'gemini-3.1-pro' || item === 'gemini-3-pro') out.push('gemini-3.1-pro');
    if (item === 'gemini-3-flash') out.push('gemini-3-flash');
    if (item === 'gemini-2.5-flash') out.push('gemini-2.5-flash');
  }
  return out.length > 0 ? out : fallback;
}

const DEBATE_VIDEO_UI_MODEL_LADDER = parseVideoUiModelLadder(
  Deno.env.get('DEBATE_VIDEO_UI_MODEL_LADDER'),
);

function resolveVideoUiDebateModelTier(): RouterModel | null {
  for (const tier of DEBATE_VIDEO_UI_MODEL_LADDER) {
    if (isProviderReadyForModelTier(tier)) return tier;
  }
  return null;
}

function parseDebateRequest(inputMode?: string, rawModelOverride?: string, profile?: string): {
  requested: boolean;
  profile: DebateProfile;
  trigger: DebateTrigger;
  // If modelOverride is being used as a "debate toggle", suppress it from normalizeModelOverride()
  suppressModelOverride: boolean;
  overrideHeaderValue: string; // used for X-Model-Override when debate is explicit
} {
  const p = normalizeDebateProfile(profile);
  const mode = String(inputMode || '').trim().toLowerCase();
  const raw = String(rawModelOverride || '').trim().toLowerCase();

  // Explicit via body.mode = "debate"
  if (mode === 'debate') {
    return {
      requested: true,
      profile: p,
      trigger: 'explicit',
      suppressModelOverride: false,
      overrideHeaderValue: `debate:${p}`,
    };
  }

  // Compatibility: allow modelOverride = "debate" or "debate:<profile>"
  if (raw === 'debate' || raw.startsWith('debate:')) {
    const maybeProfile = raw.split(':')[1] || '';
    const pp = normalizeDebateProfile(maybeProfile);
    return {
      requested: true,
      profile: pp,
      trigger: 'explicit',
      suppressModelOverride: true,
      overrideHeaderValue: `debate:${pp}`,
    };
  }

  return {
    requested: false,
    profile: p,
    trigger: 'off',
    suppressModelOverride: false,
    overrideHeaderValue: '',
  };
}

function tryParseJson(input: string): unknown | undefined {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

async function consumeUpstreamToText(
  upstream: UpstreamCallResult,
  signal: AbortSignal,
  maxChars: number,
): Promise<string> {
  if (!upstream.response.ok) return '';
  const body = upstream.response.body;
  if (!body) return '';

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let acc = '';

  try {
    while (true) {
      if (signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (!dataStr || dataStr === '[DONE]') continue;
        const payload = tryParseJson(dataStr);
        if (!payload) continue;
        const deltas = upstream.extractDeltas(payload);
        for (const d of deltas) {
          if (!d) continue;
          acc += d;
          if (acc.length >= maxChars) return acc.slice(0, maxChars - 1) + '…';
        }
      }
    }
  } catch {
    // ignore; treat as partial
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }

  return acc.trim();
}

function isProviderReadyForModelTier(modelTier: RouterModel): boolean {
  const provider = MODEL_REGISTRY[modelTier].provider;
  return isProviderReady(provider);
}

interface DebateRunResult {
  upstream: UpstreamCallResult;
  synthesisMessages: Message[];
  debateModelTier: RouterModel;
  synthesisDecision: RouteDecision;
}

async function maybeRunDebateMode(params: {
  decision: RouteDecision;
  allMessages: Message[];
  images: ImageAttachment[];
  hasVideo: boolean;
  signal: AbortSignal;
  geminiFlashThinkingLevel: GeminiFlashThinkingLevel;
  debateProfile: DebateProfile;
  workerMaxTokens: number;
  forcedModelTier?: RouterModel;
  synthesisMaxTokens?: number;
  videoNotesJson?: string;
}): Promise<DebateRunResult | null> {
  const isVideoUi = params.debateProfile === 'video_ui';
  if (!isVideoUi && (params.images.length > 0 || params.hasVideo)) return null;
  if (isVideoUi && (params.images.length > 0 || !params.hasVideo || !params.videoNotesJson || !params.forcedModelTier)) {
    return null;
  }

  const basePrimaryDecision = params.forcedModelTier
    ? decisionFromModel(
      params.forcedModelTier,
      params.decision.complexityScore,
      `debate-${params.debateProfile}-synthesis`,
    )
    : params.decision;
  const synthesisBudgetCap = params.synthesisMaxTokens
    ? Math.min(basePrimaryDecision.budgetCap, params.synthesisMaxTokens)
    : basePrimaryDecision.budgetCap;
  const synthesisDecision: RouteDecision = {
    ...basePrimaryDecision,
    budgetCap: synthesisBudgetCap,
  };

  const primaryTier = synthesisDecision.modelTier;
  const plan = getDebatePlan(params.debateProfile, primaryTier);

  // Readiness gating: primary must be ready; each challenger needs at least one cascade option ready.
  if (!isProviderReadyForModelTier(primaryTier)) return null;
  for (const c of plan.challengers) {
    const assignedTier = params.forcedModelTier || c.modelTier;
    const sequence = buildFallbackSequence(assignedTier);
    if (!sequence.some(isProviderReadyForModelTier)) return null;
  }

  // Run challengers in parallel (streaming, consumed to text, bounded timeout).
  const challengerRuns = plan.challengers.map(async (c): Promise<ChallengerOutput | null> => {
    const workerController = new AbortController();
    const timeoutMs = params.debateProfile === 'code'
      ? 12000
      : params.debateProfile === 'video_ui'
      ? 9000
      : 10000;
    const tid = setTimeout(() => workerController.abort(), timeoutMs);
    const onStageAbort = () => workerController.abort();
    params.signal.addEventListener('abort', onStageAbort, { once: true });
    try {
      const baseUserQuery = params.allMessages.at(-1)?.content || '';
      const enrichedUserQuery = isVideoUi
        ? `${baseUserQuery}\n\nVIDEO_NOTES_JSON:\n${params.videoNotesJson}`
        : baseUserQuery;
      const workerPrompt = buildChallengerPrompt(
        params.debateProfile,
        c.role,
        enrichedUserQuery,
      );
      const workerMessages: Message[] = [
        // Keep context small: last 6 turns + challenger prompt as final user msg.
        ...params.allMessages.slice(Math.max(0, params.allMessages.length - 6)),
        { role: 'user', content: workerPrompt },
      ];

      // Cost-cascade fallback: try assigned tier first, then cheaper alternatives.
      const assignedTier = params.forcedModelTier || c.modelTier;
      const fallbackSequence = buildFallbackSequence(assignedTier);
      for (const workerTier of fallbackSequence) {
        if (workerController.signal.aborted) break;
        if (!isProviderReadyForModelTier(workerTier)) continue;
        try {
          const workerDecision: RouteDecision = {
            ...decisionFromModel(workerTier, params.decision.complexityScore, `debate-worker-${c.role}`),
            budgetCap: params.workerMaxTokens,
          };
          const upstream = await callProviderStream(
            workerDecision,
            workerMessages,
            [],
            workerController.signal,
            params.geminiFlashThinkingLevel,
          );
          const text = await consumeUpstreamToText(
            upstream,
            workerController.signal,
            plan.maxChallengerChars,
          );
          if (text) return { role: c.role, modelTier: workerTier, text };
        } catch {
          // try next model in cascade
        }
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(tid);
      params.signal.removeEventListener('abort', onStageAbort);
    }
  });

  const challengerResults = (await Promise.all(challengerRuns)).filter(Boolean) as ChallengerOutput[];

  // If no challengers succeed, fall back to the normal single-provider path.
  if (challengerResults.length === 0) return null;

  // Synthesis: ask the PRIMARY decision model to produce a final answer using debate notes.
  const baseUserQuery = params.allMessages.at(-1)?.content || '';
  const userQuery = isVideoUi
    ? `${baseUserQuery}\n\nVIDEO_NOTES_JSON:\n${params.videoNotesJson}`
    : baseUserQuery;
  const synthesisPrompt = buildSynthesisPrompt(
    params.debateProfile,
    userQuery,
    challengerResults,
    plan.maxChallengerChars,
  );

  const synthesisMessages: Message[] = [
    ...params.allMessages,
    { role: 'user', content: synthesisPrompt },
  ];

  const upstream = await callProviderStream(
    synthesisDecision,
    synthesisMessages,
    [],
    params.signal,
    params.geminiFlashThinkingLevel,
  );

  return {
    upstream,
    synthesisMessages,
    debateModelTier: synthesisDecision.modelTier,
    synthesisDecision,
  };
}

// ============================================================================
// UPSTREAM DELTA EXTRACTORS
// ============================================================================

function extractAnthropicDeltas(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = payload as { type?: string; delta?: { text?: string } };
  if (data.type === 'content_block_delta' && typeof data.delta?.text === 'string') {
    return [data.delta.text];
  }
  return [];
}

function extractOpenAIDeltas(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];

  const data = payload as {
    choices?: Array<{ delta?: { content?: string | Array<{ text?: string }> } }>;
  };

  const deltas: string[] = [];
  for (const choice of data.choices || []) {
    const content = choice.delta?.content;
    if (typeof content === 'string' && content) {
      deltas.push(content);
      continue;
    }
    if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part?.text === 'string' && part.text) {
          deltas.push(part.text);
        }
      }
    }
  }

  return deltas;
}

function extractGoogleDeltas(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];

  const data = payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const deltas: string[] = [];
  for (const candidate of data.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (typeof part?.text === 'string' && part.text) {
        deltas.push(part.text);
      }
    }
  }

  return deltas;
}

function normalizeGoogleModelName(rawName: string): string {
  return rawName.startsWith('models/') ? rawName.slice('models/'.length) : rawName;
}

function hasGenerateContentSupport(model: GoogleModelRecord): boolean {
  return model.supportedGenerationMethods.includes('generateContent');
}

async function listGoogleModels(signal: AbortSignal): Promise<GoogleModelRecord[]> {
  const now = Date.now();
  if (googleModelsCache && now - googleModelsCache.fetchedAt < GOOGLE_MODELS_CACHE_TTL_MS) {
    return googleModelsCache.models;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${
    encodeURIComponent(GOOGLE_API_KEY)
  }`;
  const response = await fetch(endpoint, { method: 'GET', signal });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Google ListModels failed (${response.status}): ${responseText}`);
  }

  let payload: { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> } = {};
  try {
    payload = JSON.parse(responseText) as typeof payload;
  } catch {
    throw new Error('Google ListModels returned invalid JSON payload');
  }

  const models = (payload.models || [])
    .filter((item): item is { name: string; supportedGenerationMethods?: string[] } =>
      typeof item?.name === 'string' && item.name.length > 0
    )
    .map((item) => ({
      name: normalizeGoogleModelName(item.name),
      supportedGenerationMethods: Array.isArray(item.supportedGenerationMethods)
        ? item.supportedGenerationMethods
        : [],
    }))
    .filter(hasGenerateContentSupport);

  googleModelsCache = { fetchedAt: now, models };
  return models;
}

function googleAliasScore(alias: string, modelName: string): number {
  const normalizedAlias = alias.toLowerCase();
  const normalizedName = modelName.toLowerCase();

  let score = 0;

  if (normalizedAlias === normalizedName) score += 1000;
  if (normalizedName.includes(normalizedAlias)) score += 500;

  if (normalizedAlias === 'gemini-2.5-flash' || normalizedAlias === 'gemini-3-flash' || normalizedAlias === 'gemini-3-flash-preview') {
    if (normalizedName.includes('flash')) score += 300;
    if (normalizedName.includes('gemini-2.5')) score += 200;
    if (normalizedName.includes('gemini-3')) score += 100;
    if (!normalizedName.includes('flash')) score -= 400;
  }

  if (
    normalizedAlias === 'gemini-3.1-pro-preview' ||
    normalizedAlias === 'gemini-3.1-pro' ||
    normalizedAlias === 'gemini-3-pro'
  ) {
    if (normalizedName.includes('pro')) score += 300;
    if (normalizedName.includes('gemini-3')) score += 200;
    if (normalizedName.includes('gemini-2.5')) score += 100;
    if (!normalizedName.includes('pro')) score -= 400;
  }

  if (normalizedName.includes('preview')) score -= 10;
  if (normalizedName.includes('exp')) score -= 15;

  return score;
}

async function resolveGoogleModelAlias(alias: string, signal: AbortSignal): Promise<string> {
  const models = await listGoogleModels(signal);
  if (models.length === 0) {
    throw new Error('Google ListModels returned no models with generateContent support');
  }

  const exact = models.find((m) => m.name.toLowerCase() === alias.toLowerCase());
  if (exact) return exact.name;

  const ranked = models
    .map((model) => ({ model, score: googleAliasScore(alias, model.name) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length > 0) {
    return ranked[0]!.model.name;
  }

  throw new Error(
    `No Google model available for alias '${alias}'. ` +
      `Query ListModels and verify current Gemini model naming.`,
  );
}

// ============================================================================
// UPSTREAM CALLS
// ============================================================================

async function callAnthropic(
  decision: RouteDecision,
  allMessages: Message[],
  images: ImageAttachment[],
  signal: AbortSignal,
): Promise<UpstreamCallResult> {
  const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(buildAnthropicStreamPayload(decision, allMessages, images)),
    signal,
  });

  return {
    response: anthropicResponse,
    extractDeltas: extractAnthropicDeltas,
    effectiveModelId: decision.model,
  };
}

async function callOpenAI(
  decision: RouteDecision,
  allMessages: Message[],
  images: ImageAttachment[],
  signal: AbortSignal,
): Promise<UpstreamCallResult> {
  const endpoint = 'https://api.openai.com/v1/chat/completions';

  const doCall = (payload: Record<string, unknown>) =>
    fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    });

  let openaiResponse = await doCall(
    buildOpenAIStreamPayload(decision, allMessages, images),
  );

  if (openaiResponse.status === 400) {
    const bodyText = await openaiResponse.text();
    if (bodyText.toLowerCase().includes('max_completion_tokens')) {
      openaiResponse = await doCall({
        ...buildOpenAILegacyStreamPayload(decision, allMessages, images),
      });
    } else {
      openaiResponse = new Response(bodyText, {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  return {
    response: openaiResponse,
    extractDeltas: extractOpenAIDeltas,
    effectiveModelId: decision.model,
  };
}

async function callNvidia(
  decision: RouteDecision,
  allMessages: Message[],
  signal: AbortSignal,
): Promise<UpstreamCallResult> {
  const endpoint = 'https://integrate.api.nvidia.com/v1/chat/completions';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildOpenAIStreamPayload(decision, allMessages, [])),
    signal,
  });

  return {
    response,
    extractDeltas: extractOpenAIDeltas,
    effectiveModelId: decision.model,
  };
}

async function callDeepInfra(
  decision: RouteDecision,
  allMessages: Message[],
  signal: AbortSignal,
): Promise<UpstreamCallResult> {
  const endpoint = 'https://api.deepinfra.com/v1/openai/chat/completions';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEEPINFRA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildOpenAIStreamPayload(decision, allMessages, [])),
    signal,
  });

  return {
    response,
    extractDeltas: extractOpenAIDeltas,
    effectiveModelId: decision.model,
  };
}

async function callGoogle(
  decision: RouteDecision,
  allMessages: Message[],
  images: ImageAttachment[],
  signal: AbortSignal,
  geminiFlashThinkingLevel: GeminiFlashThinkingLevel,
): Promise<UpstreamCallResult> {
  const resolvedModel = await resolveGoogleModelAlias(decision.model, signal);

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(resolvedModel)}` +
    `:streamGenerateContent?alt=sse&key=${encodeURIComponent(GOOGLE_API_KEY)}`;

  const isGeminiFlash = decision.modelTier === 'gemini-2.5-flash';

  const doCall = (includeThinkingConfig: boolean) =>
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        buildGoogleStreamPayload(
          decision,
          allMessages,
          images,
          includeThinkingConfig,
          geminiFlashThinkingLevel,
        ),
      ),
      signal,
    });

  let effectiveGeminiFlashThinkingLevel: GeminiFlashThinkingLevel | undefined = isGeminiFlash
    ? geminiFlashThinkingLevel
    : undefined;

  let googleResponse = await doCall(isGeminiFlash);

  if (googleResponse.status === 400 && isGeminiFlash) {
    const responseText = await googleResponse.text();
    const lowered = responseText.toLowerCase();
    const looksLikeThinkingConfigError = lowered.includes('thinking') ||
      lowered.includes('thinkingconfig') ||
      lowered.includes('thinking_level');

    if (looksLikeThinkingConfigError) {
      googleResponse = await doCall(false);
      effectiveGeminiFlashThinkingLevel = undefined;
    } else {
      googleResponse = new Response(responseText, {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  const result: UpstreamCallResult = {
    response: googleResponse,
    extractDeltas: extractGoogleDeltas,
    effectiveModelId: resolvedModel,
  };
  if (effectiveGeminiFlashThinkingLevel) {
    result.effectiveGeminiFlashThinkingLevel = effectiveGeminiFlashThinkingLevel;
  }
  return result;
}

async function callProviderStream(
  decision: RouteDecision,
  allMessages: Message[],
  images: ImageAttachment[],
  signal: AbortSignal,
  geminiFlashThinkingLevel: GeminiFlashThinkingLevel,
): Promise<UpstreamCallResult> {
  switch (decision.provider) {
    case 'anthropic':
      return await callAnthropic(decision, allMessages, images, signal);
    case 'openai':
      return await callOpenAI(decision, allMessages, images, signal);
    case 'google':
      return await callGoogle(decision, allMessages, images, signal, geminiFlashThinkingLevel);
    case 'nvidia':
      return await callNvidia(decision, allMessages, signal);
    case 'deepinfra':
      return await callDeepInfra(decision, allMessages, signal);
  }
}

// ============================================================================
// SMD v1.1 LIGHT — STRUCTURED GOOGLE CALL
// ============================================================================

/**
 * Extracts the text content from a non-streaming Gemini generateContent response.
 * The response envelope wraps the model output in candidates[0].content.parts[0].text.
 * With responseMimeType="application/json", that text is the raw JSON string.
 */
function tryExtractGoogleStructuredText(responseText: string): string | undefined {
  try {
    const envelope = JSON.parse(responseText) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = envelope?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof text === 'string' && text.trim() ? text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Calls the Gemini generateContent (non-streaming) endpoint with native structured output.
 * Used exclusively by SMD Skeptic and SynthDecision stages.
 *
 * Returns the raw response text (for JSON extraction) and HTTP status.
 * Does NOT use SSE; caller must extract JSON from the envelope.
 */
async function callGoogleStructured(
  decision: RouteDecision,
  allMessages: Message[],
  responseSchema: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ responseText: string; ok: boolean; status: number }> {
  const resolvedModel = await resolveGoogleModelAlias(decision.model, signal);
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(resolvedModel)}` +
    `:generateContent?key=${encodeURIComponent(GOOGLE_API_KEY)}`;

  const payload = buildGoogleJsonPayload(decision, allMessages, responseSchema);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  const responseText = await response.text();
  return { responseText, ok: response.ok, status: response.status };
}

// ============================================================================
// SMD v1.1 LIGHT — FAST-PATH GUARD
// ============================================================================

/**
 * Returns { skip: true, reason } when the prompt is too trivial for SMD.
 * Skipped prompts route directly to the baseline single-pass path.
 *
 * Logic is intentionally simple and tunable via env vars.
 * Logs are emitted by the caller so the run ID is available.
 */
const SMD_COMPLEXITY_SIGNALS = new Set([
  'compare', 'comparison', 'tradeoff', 'trade-off', 'pros', 'cons',
  'risk', 'risks', 'critique', 'criticize', 'review', 'evaluate',
  'choose', 'best option', 'plan', 'strategy', 'downside', 'drawback',
  'failure mode', 'failure modes', 'implications', 'recommend',
  'recommendation', 'decision', 'dilemma', 'should i', 'what if',
  'how should', 'why does', 'explain why', 'analyze', 'analysis',
  'versus', ' vs ', 'alternatives', 'considerations',
]);

function smdFastPath(
  query: string,
  queryTokens: number,
): { skip: boolean; reason: string } {
  if (queryTokens < SMD_FAST_PATH_MIN_TOKENS) {
    return {
      skip: true,
      reason: `token_count_below_threshold:${queryTokens}<${SMD_FAST_PATH_MIN_TOKENS}`,
    };
  }
  const lower = query.toLowerCase();
  const matched = [...SMD_COMPLEXITY_SIGNALS].filter((sig) => lower.includes(sig));
  if (matched.length === 0) {
    return { skip: true, reason: 'no_complexity_signal_words' };
  }
  return { skip: false, reason: '' };
}

// ============================================================================
// SMD v1.1 LIGHT — STAGE LOG INTERFACE
// ============================================================================

interface SmdStageLog {
  runId: string;
  mode: 'smd_light';
  provider: 'google';
  modelTier: string;
  modelId: string;
  fastPathHit: boolean;
  fastPathReason: string;
  draftLatencyMs: number;
  draftChars: number;
  skepticLatencyMs: number;
  skepticSchemaValid: boolean;
  skepticParseRetries: number;
  issueCount: number;
  highCriticalCount: number;
  synthLatencyMs: number;
  synthSchemaValid: boolean;
  synthParseRetries: number;
  unresolvedRiskCount: number;
  survivalViolations: string[];
  formatterLatencyMs: number;
  finalStatus: 'complete' | 'fallback_draft_empty' | 'fallback_skeptic_failed' | 'fallback_synth_failed' | 'fallback_formatter_failed' | 'error';
}

interface SmdRunResult {
  upstream: UpstreamCallResult;
  log: SmdStageLog;
}

// ============================================================================
// SMD v1.1 LIGHT — PIPELINE ORCHESTRATOR
// ============================================================================

/**
 * Runs the SMD Light pipeline: Draft → Skeptic → SynthDecision → Formatter.
 *
 * Returns null on any stage failure (caller falls back to baseline).
 * All failures are logged with the run ID for eval analysis.
 *
 * Key design choices:
 *  - Stages 1-3 are non-streaming (consume to text).
 *  - Stage 4 (Formatter) is streaming — returned as UpstreamCallResult for
 *    createNormalizedProxyStream(), identical to the normal provider call path.
 *  - Gemini Flash is used for ALL stages (same-model experiment).
 *  - Authorship masking is enforced by the prompt builders in smd_prompts.ts.
 *  - Context sanitation: Formatter only sees accepted_changes + rewrite_instructions
 *    + unresolved_risks (not rejected_criticisms).
 */
async function maybeRunSmdMode(params: {
  userQuery: string;
  allMessages: Message[];
  signal: AbortSignal;
  geminiFlashThinkingLevel: GeminiFlashThinkingLevel;
}): Promise<SmdRunResult | null> {
  const runId = crypto.randomUUID().slice(0, 8);
  const smdDecisionBase = decisionFromModel(SMD_MODEL_TIER, 50, 'smd-light');
  const modelId = MODEL_REGISTRY[SMD_MODEL_TIER].modelId;

  const log: SmdStageLog = {
    runId,
    mode: 'smd_light',
    provider: 'google',
    modelTier: SMD_MODEL_TIER,
    modelId,
    fastPathHit: false,
    fastPathReason: '',
    draftLatencyMs: 0,
    draftChars: 0,
    skepticLatencyMs: 0,
    skepticSchemaValid: false,
    skepticParseRetries: 0,
    issueCount: 0,
    highCriticalCount: 0,
    synthLatencyMs: 0,
    synthSchemaValid: false,
    synthParseRetries: 0,
    unresolvedRiskCount: 0,
    survivalViolations: [],
    formatterLatencyMs: 0,
    finalStatus: 'error',
  };

  try {
    // ── STAGE 1: DRAFT ──────────────────────────────────────────────────────
    const draftStart = Date.now();
    const draftDecision: RouteDecision = { ...smdDecisionBase, budgetCap: SMD_DRAFT_BUDGET };
    const draftMessages: Message[] = [
      // Preserve conversation history context; replace final user message with draft prompt.
      ...params.allMessages.slice(0, -1),
      { role: 'user', content: buildSmdDraftPrompt(params.userQuery) },
    ];

    const draftUpstream = await callProviderStream(
      draftDecision,
      draftMessages,
      [],
      params.signal,
      params.geminiFlashThinkingLevel,
    );
    const draftText = await consumeUpstreamToText(draftUpstream, params.signal, SMD_DRAFT_MAX_CHARS);
    log.draftLatencyMs = Date.now() - draftStart;
    log.draftChars = draftText.length;

    if (!draftText.trim()) {
      log.finalStatus = 'fallback_draft_empty';
      console.warn(`[SMD][${runId}] draft stage returned empty text — fallback to baseline`);
      console.log('[SMD] run:', JSON.stringify(log));
      return null;
    }

    // ── STAGE 2: SKEPTIC (native structured JSON) ────────────────────────────
    const skepticStart = Date.now();
    const skepticDecision: RouteDecision = { ...smdDecisionBase, budgetCap: SMD_SKEPTIC_BUDGET };
    const skepticMessages: Message[] = [
      { role: 'user', content: buildSmdSkepticPrompt(params.userQuery, draftText) },
    ];

    let skepticOutput: SkepticOutput | null = null;
    let skepticRetries = 0;
    for (let attempt = 0; attempt <= 1; attempt++) {
      if (params.signal.aborted) break;
      let rawResult: { responseText: string; ok: boolean; status: number };
      try {
        rawResult = await callGoogleStructured(
          skepticDecision,
          skepticMessages,
          SKEPTIC_GEMINI_SCHEMA,
          params.signal,
        );
      } catch (fetchErr) {
        console.warn(`[SMD][${runId}] skeptic fetch error (attempt ${attempt}):`, fetchErr);
        break;
      }
      if (!rawResult.ok) {
        console.warn(`[SMD][${runId}] skeptic HTTP ${rawResult.status} (attempt ${attempt})`);
        break;
      }
      const innerText = tryExtractGoogleStructuredText(rawResult.responseText);
      const parsed = innerText ? tryParseJson(innerText) : undefined;
      const validation = validateSkepticOutput(parsed);
      if (validation.valid) {
        skepticOutput = validation.data;
        skepticRetries = attempt;
        break;
      }
      console.warn(
        `[SMD][${runId}] skeptic schema validation failed (attempt ${attempt}): ${validation.error}`,
      );
      skepticRetries = attempt + 1;
    }
    log.skepticLatencyMs = Date.now() - skepticStart;
    log.skepticSchemaValid = skepticOutput !== null;
    log.skepticParseRetries = skepticRetries;

    if (!skepticOutput) {
      log.finalStatus = 'fallback_skeptic_failed';
      console.warn(`[SMD][${runId}] skeptic stage failed — fallback to baseline`);
      console.log('[SMD] run:', JSON.stringify(log));
      return null;
    }
    log.issueCount = skepticOutput.issues.length;
    log.highCriticalCount = countHighCriticalIssues(skepticOutput);

    // ── STAGE 3: SYNTH DECISION (native structured JSON) ─────────────────────
    const synthStart = Date.now();
    const synthDecisionModel: RouteDecision = { ...smdDecisionBase, budgetCap: SMD_SYNTH_BUDGET };
    const synthMessages: Message[] = [
      {
        role: 'user',
        content: buildSmdSynthDecisionPrompt(params.userQuery, draftText, skepticOutput),
      },
    ];

    let synthDecision: SynthDecision | null = null;
    let synthRetries = 0;
    for (let attempt = 0; attempt <= 1; attempt++) {
      if (params.signal.aborted) break;
      let rawResult: { responseText: string; ok: boolean; status: number };
      try {
        rawResult = await callGoogleStructured(
          synthDecisionModel,
          synthMessages,
          SYNTH_DECISION_GEMINI_SCHEMA,
          params.signal,
        );
      } catch (fetchErr) {
        console.warn(`[SMD][${runId}] synth fetch error (attempt ${attempt}):`, fetchErr);
        break;
      }
      if (!rawResult.ok) {
        console.warn(`[SMD][${runId}] synth HTTP ${rawResult.status} (attempt ${attempt})`);
        break;
      }
      const innerText = tryExtractGoogleStructuredText(rawResult.responseText);
      const parsed = innerText ? tryParseJson(innerText) : undefined;
      const validation = validateSynthDecision(parsed);
      if (validation.valid) {
        synthDecision = validation.data;
        synthRetries = attempt;
        break;
      }
      console.warn(
        `[SMD][${runId}] synth schema validation failed (attempt ${attempt}): ${validation.error}`,
      );
      synthRetries = attempt + 1;
    }
    log.synthLatencyMs = Date.now() - synthStart;
    log.synthSchemaValid = synthDecision !== null;
    log.synthParseRetries = synthRetries;

    if (!synthDecision) {
      log.finalStatus = 'fallback_synth_failed';
      console.warn(`[SMD][${runId}] synth decision stage failed — fallback to baseline`);
      console.log('[SMD] run:', JSON.stringify(log));
      return null;
    }
    log.unresolvedRiskCount = synthDecision.unresolved_risks.length;

    // Validate high/critical survival rule — violations are logged but do not abort.
    // If this fires frequently in eval, the SynthDecision prompt needs strengthening.
    const violations = validateHighCriticalSurvival(skepticOutput, synthDecision);
    log.survivalViolations = violations;
    if (violations.length > 0) {
      console.warn(
        `[SMD][${runId}] survival rule violations for issue ids: ${violations.join(', ')}` +
          ' — high/critical issues not accounted for in accepted/rejected/unresolved',
      );
    }

    // ── STAGE 4: FORMATTER (streaming, returned as UpstreamCallResult) ───────
    const formatterStart = Date.now();
    const formatterDecision: RouteDecision = {
      ...smdDecisionBase,
      budgetCap: SMD_FORMATTER_BUDGET,
      rationaleTag: 'smd-formatter',
    };
    const formatterMessages: Message[] = [
      // Include conversation history for context continuity.
      ...params.allMessages.slice(0, -1),
      {
        role: 'user',
        content: buildSmdFormatterPrompt(params.userQuery, draftText, synthDecision),
      },
    ];

    const formatterUpstream = await callProviderStream(
      formatterDecision,
      formatterMessages,
      [],
      params.signal,
      params.geminiFlashThinkingLevel,
    );
    log.formatterLatencyMs = Date.now() - formatterStart;
    log.finalStatus = 'complete';

    console.log('[SMD] run complete:', JSON.stringify(log));

    return { upstream: formatterUpstream, log };
  } catch (err) {
    log.finalStatus = 'error';
    console.error(`[SMD][${runId}] unexpected error:`, err);
    console.log('[SMD] run:', JSON.stringify(log));
    return null;
  }
}

// ============================================================================
// JWT VERIFICATION
// ============================================================================

function extractBearerToken(authHeader: string): string | null {
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.substring(7);
}


// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FUNCTION_TIMEOUT_MS);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Server misconfigured: missing Supabase env vars' }),
        {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        },
      );
    }

    if (!hasAtLeastOneProviderConfigured()) {
      return new Response(
        JSON.stringify({
          error:
            'Server misconfigured: no provider credentials available. Configure ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.',
        }),
        {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        },
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Missing Authorization header' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const token = extractBearerToken(authHeader);
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token format' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const supabaseClient = createClient(
      supabaseUrl,
      supabaseServiceRoleKey,
      {
        db: { schema: 'public' },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid or expired token' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;

    let body: {
      query?: string;
      conversationId?: string;
      platform?: 'web' | 'mobile';
      history?: Message[];
      images?: ImageAttachment[];
      videoAssetIds?: string[];
      imageData?: string;
      mediaType?: string;
      imageStorageUrl?: string;
      modelOverride?: string;
      geminiFlashThinkingLevel?: string;
      // Debate Mode tool toggle
      mode?: string; // "debate" to enable
      debateProfile?: string; // "general" | "code" | "video_ui"
    };

    const contentLengthHeader = req.headers.get('content-length');
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
        return new Response(
          JSON.stringify({
            error: `Payload too large. Max allowed size is ${Math.round(MAX_REQUEST_BYTES / (1024 * 1024))}MB.`,
          }),
          {
            status: 413,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          },
        );
      }
    }

    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Bad Request: Invalid JSON' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const {
      query: rawQuery,
      conversationId,
      platform = 'web',
      history = [],
      images,
      videoAssetIds = [],
      imageData,
      mediaType,
      imageStorageUrl,
      modelOverride,
      geminiFlashThinkingLevel,
      mode,
      debateProfile,
    } = body;

    const normalizedGeminiFlashThinkingLevel = normalizeGeminiFlashThinkingLevel(
      geminiFlashThinkingLevel,
    );

    let imageAttachments: ImageAttachment[] = [];

    if (images && images.length > 0) {
      imageAttachments = images;
    } else if (imageData) {
      imageAttachments = [{ data: imageData, mediaType: mediaType || 'image/png' }];
    }

    let query = rawQuery?.trim() || '';
    const hasImages = imageAttachments.length > 0;
    const hasVideoAssets = Array.isArray(videoAssetIds) && videoAssetIds.length > 0;

    if (!query && !hasImages && !hasVideoAssets) {
      return new Response(JSON.stringify({ error: 'Bad Request: Missing query, image, or videoAssetIds' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (!conversationId) {
      return new Response(JSON.stringify({ error: 'Bad Request: Missing conversationId' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (!query && (hasImages || hasVideoAssets)) {
      if (hasImages && hasVideoAssets) {
        query = 'Please analyze these images and videos.';
      } else if (hasVideoAssets) {
        query = videoAssetIds.length === 1
          ? 'Please analyze this video.'
          : `Please analyze these ${videoAssetIds.length} videos.`;
      } else {
        query = imageAttachments.length === 1
          ? 'Please analyze this image.'
          : `Please analyze these ${imageAttachments.length} images.`;
      }
    }

    if (query.length > MAX_QUERY_LENGTH) {
      return new Response(JSON.stringify({ error: 'Query exceeds maximum length' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (DEV_MODE) {
      console.log('[DEV] Request:', {
        userId: userId.slice(0, 8),
        conversationId: conversationId.slice(0, 8),
        imageCount: imageAttachments.length,
        videoCount: videoAssetIds.length,
        queryLen: query.length,
        modelOverride: modelOverride || 'auto',
        geminiFlashThinkingLevel: normalizedGeminiFlashThinkingLevel,
      });
    }

    const ownership = await validateConversation(
      supabaseClient as unknown as ReturnType<typeof createClient>,
      conversationId,
      userId,
    );
    if (!ownership.valid) {
      return new Response(JSON.stringify({ error: 'Forbidden: Invalid conversation ownership' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const videoValidation = await validateReadyVideoAssets(
      supabaseClient as unknown as ReturnType<typeof createClient>,
      userId,
      Array.isArray(videoAssetIds) ? videoAssetIds : [],
      ENABLE_VIDEO_PIPELINE,
    );
    if (!videoValidation.ok) {
      return new Response(JSON.stringify({ error: videoValidation.error }), {
        status: videoValidation.error === 'video_not_ready' ? 409 : 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    let memoryRetrieval: MemoryRetrievalResult = {
      contextBlock: '',
      hits: 0,
      tokenCount: 0,
    };
    try {
      memoryRetrieval = await fetchRelevantMemories(
        supabaseClient as unknown as ReturnType<typeof createClient>,
        userId,
        query,
      );
    } catch (memoryError) {
      console.warn('[Memory] retrieval skipped:', memoryError);
    }

    let videoContextBlock = '';
    if (videoValidation.ids.length > 0) {
      try {
        videoContextBlock = await buildVideoContextBlock(
          supabaseClient as unknown as ReturnType<typeof createClient>,
          videoValidation.ids,
          VIDEO_CONTEXT_MAX_CHARS,
        );
      } catch (videoContextError) {
        console.warn('[Video] context injection skipped:', videoContextError);
      }
    }

    const effectiveQuery = [memoryRetrieval.contextBlock, videoContextBlock, `Current request:\n${query}`]
      .filter((part) => typeof part === 'string' && part.trim().length > 0)
      .join('\n\n');

    const routerParams: RouterParams = {
      userQuery: query,
      currentSessionTokens: ownership.tokenCount + memoryRetrieval.tokenCount,
      platform,
      history,
      images: imageAttachments,
      hasVideoAssets,
    };

    const debateReq = parseDebateRequest(mode, modelOverride, debateProfile);
    const normalizedOverride = normalizeModelOverride(
      debateReq.suppressModelOverride ? undefined : modelOverride,
    );
    let decision = determineRoute(routerParams, normalizedOverride);

    const availabilityCheck = normalizeDecisionAgainstProviderAvailability(
      decision,
      normalizedOverride,
    );
    if (availabilityCheck.error) {
      return new Response(JSON.stringify({ error: availabilityCheck.error }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    decision = availabilityCheck.decision;

    const historyContext = history
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join('\n');
    const estimatedVideoPromptTokens = estimateVideoPromptTokens(videoValidation.ids.length);
    const preFlightCost = calculatePreFlightCost(
      decision.modelTier,
      `${historyContext}\nuser: ${effectiveQuery}`,
      imageAttachments.length,
      estimatedVideoPromptTokens,
    );

    if (DEV_MODE) {
      console.log('[ROUTER] Decision:', {
        provider: decision.provider,
        modelTier: decision.modelTier,
        modelId: decision.model,
        score: decision.complexityScore,
        rationale: decision.rationaleTag,
      });
    }

    const userMsg: Message = {
      role: 'user',
      content: effectiveQuery,
    };

    const allMessages = [...history, userMsg];

    // Debate state — declared before try so both the catch and response-building can see them.
    let debateActive = false;
    let debateProfileEffective: DebateProfile = 'general';
    let debateTriggerEffective: DebateTrigger = 'off';
    let debateOverrideHeader = '';
    let debateSynthesisMessages: Message[] | null = null;
    let debateModelTierEffective = '';
    let responseDecision: RouteDecision = decision;

    // SMD state — declared alongside debate state for the same reason.
    let smdActive = false;
    let smdFastPathHit = false;
    let smdRunLog: SmdStageLog | null = null;

    let upstream: UpstreamCallResult;
    try {
      // ── SMD v1.1 Light branch ─────────────────────────────────────────────
      // Checked before the existing debate branch. SMD is:
      //   - Triggered by mode === 'smd_light' in the request body
      //   - Gated by ENABLE_SMD_LIGHT env flag (default off)
      //   - Restricted to text-only, no images, no video
      //   - Locked to Gemini Flash regardless of normal routing decision
      const smdRequested = String(mode || '').trim().toLowerCase() === 'smd_light';
      const smdEligible = ENABLE_SMD_LIGHT && smdRequested && !hasImages && !hasVideoAssets;

      if (smdEligible) {
        const queryTokens = countTokens(query);
        const fastPath = smdFastPath(query, queryTokens);

        if (fastPath.skip) {
          console.log(`[SMD] fast-path triggered: ${fastPath.reason} — routing to baseline`);
          smdFastPathHit = true;
          // Fast-path: use the normally routed model (not forced to Gemini Flash).
          upstream = await callProviderStream(
            decision,
            allMessages,
            imageAttachments,
            controller.signal,
            normalizedGeminiFlashThinkingLevel,
          );
        } else {
          const smdResult = await maybeRunSmdMode({
            userQuery: query,
            allMessages,
            signal: controller.signal,
            geminiFlashThinkingLevel: normalizedGeminiFlashThinkingLevel,
          });

          if (smdResult) {
            upstream = smdResult.upstream;
            smdActive = true;
            smdRunLog = smdResult.log;
            // SMD forces Gemini Flash for the entire pipeline; reflect in response decision.
            responseDecision = decisionFromModel(
              SMD_MODEL_TIER,
              decision.complexityScore,
              'smd-light',
            );
          } else {
            // All stage failures fall back silently to the normal baseline path.
            console.log('[SMD] pipeline returned null — falling back to baseline');
            upstream = await callProviderStream(
              decision,
              allMessages,
              imageAttachments,
              controller.signal,
              normalizedGeminiFlashThinkingLevel,
            );
          }
        }
      } else {
      // ── Existing debate + baseline branch (untouched) ─────────────────────
      const debateEligibility = computeDebateEligibility({
        profile: debateReq.profile,
        enableDebateMode: ENABLE_DEBATE_MODE,
        enableDebateAuto: ENABLE_DEBATE_AUTO,
        debateRequested: debateReq.requested,
        hasImages,
        hasVideoAssets,
        complexityScore: decision.complexityScore,
        threshold: DEBATE_COMPLEXITY_THRESHOLD,
      });

      // Worker token cap: challenger budget by profile (not synthesis model).
      const workerMaxTokens = selectDebateWorkerMaxTokens(
        debateReq.profile,
        DEBATE_WORKER_MAX_TOKENS_GENERAL,
        DEBATE_WORKER_MAX_TOKENS_CODE,
        DEBATE_WORKER_MAX_TOKENS_VIDEO_UI,
      );

      if (debateEligibility.doDebate) {
        const forcedVideoUiTier = debateReq.profile === 'video_ui'
          ? resolveVideoUiDebateModelTier()
          : undefined;
        const videoUiNotesJson = debateReq.profile === 'video_ui' && forcedVideoUiTier
          ? await buildVideoUiNotesJson(
            supabaseClient as unknown as ReturnType<typeof createClient>,
            videoValidation.ids,
            DEBATE_VIDEO_UI_NOTES_MAX_CHARS,
          )
          : undefined;

        const debateResult = await runDebateStageWithTimeout({
          parentSignal: controller.signal,
          timeoutMs: debateReq.profile === 'video_ui' ? DEBATE_VIDEO_UI_STAGE_TIMEOUT_MS : 0,
          run: async (debateStageSignal) => await maybeRunDebateMode({
            decision,
            allMessages,
            images: imageAttachments,
            hasVideo: hasVideoAssets,
            signal: debateStageSignal,
            geminiFlashThinkingLevel: normalizedGeminiFlashThinkingLevel,
            debateProfile: debateReq.profile,
            workerMaxTokens,
            ...(forcedVideoUiTier ? { forcedModelTier: forcedVideoUiTier } : {}),
            ...(debateReq.profile === 'video_ui'
              ? { synthesisMaxTokens: DEBATE_VIDEO_UI_SYNTHESIS_MAX_TOKENS }
              : {}),
            ...(videoUiNotesJson ? { videoNotesJson: videoUiNotesJson } : {}),
          }),
        });
        // On failure (no challengers succeeded), fall through silently to the normal path.
        if (debateResult) {
          upstream = debateResult.upstream;
          debateSynthesisMessages = debateResult.synthesisMessages;
          debateActive = true;
          debateProfileEffective = debateReq.profile;
          debateTriggerEffective = debateEligibility.trigger;
          debateOverrideHeader = debateReq.requested ? debateReq.overrideHeaderValue : '';
          debateModelTierEffective = debateResult.debateModelTier;
          responseDecision = debateResult.synthesisDecision;
        } else {
          upstream = await callProviderStream(
            decision,
            allMessages,
            imageAttachments,
            controller.signal,
            normalizedGeminiFlashThinkingLevel,
          );
        }
      } else {
        upstream = await callProviderStream(
          decision,
          allMessages,
          imageAttachments,
          controller.signal,
          normalizedGeminiFlashThinkingLevel,
        );
      }
      } // end: else (not smdEligible)
    } catch (upstreamError) {
      const message = upstreamError instanceof Error
        ? upstreamError.message
        : String(upstreamError);
      if (DEV_MODE) {
        console.error(
          `[Upstream:${responseDecision.provider}] Request failed:`,
          message,
        );
      }
      return new Response(
        JSON.stringify({
          error: 'Upstream provider error',
          provider: responseDecision.provider,
        }),
        {
          status: 502,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        },
      );
    }

    if (!upstream.response.ok) {
      if (DEV_MODE) {
        const errorBody = await upstream.response.text();
        console.error(
          `[Upstream:${responseDecision.provider}] Error ${upstream.response.status}:`,
          errorBody,
        );
      }
      return new Response(
        JSON.stringify({
          error: 'Upstream provider error',
          provider: responseDecision.provider,
          status: upstream.response.status,
        }),
        {
          status: 502,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        },
      );
    }

    const effectiveModelId = upstream.effectiveModelId || responseDecision.model;

    const userTokenCount = computeUserTokenCount(query, imageAttachments, estimatedVideoPromptTokens);
    persistMessageAsync(
      supabaseClient as unknown as ReturnType<typeof createClient>,
      conversationId,
      'user',
      query,
      userTokenCount,
      `${responseDecision.provider}:${effectiveModelId}`,
      imageStorageUrl,
    );

    if (!upstream.response.body) {
      return new Response(JSON.stringify({ error: 'Upstream provider returned empty stream' }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // When debate ran, synthesis messages are longer than the original prompt.
    // Recompute the cost estimate so X-Cost-Estimate-USD reflects the actual synthesis call.
    // Challenger costs remain excluded (noted by X-Debate-Cost-Note: partial).
    const effectiveCostEstimateUsd = debateSynthesisMessages
      ? calculatePreFlightCost(
          responseDecision.modelTier,
          serializeMessagesForCost(debateSynthesisMessages),
          0, // synthesis call has no image attachments
          0,
        ).estimatedUsd
      : preFlightCost.estimatedUsd;

    let assistantText = '';

    const proxyStream = createNormalizedProxyStream({
      upstreamBody: upstream.response.body,
      extractDeltas: upstream.extractDeltas,
      onDelta: (delta) => {
        assistantText += delta;
      },
      onComplete: async () => {
        const assistantTokenCount = countTokens(assistantText);
        const costBreakdown = calculateCostBreakdown(responseDecision.modelTier, {
          promptTokens: userTokenCount,
          completionTokens: assistantTokenCount,
          reasoningTokens: 0,
        });

        await persistCostLog(
          supabaseClient as unknown as ReturnType<typeof createClient>,
          {
            user_id: userId,
            conversation_id: conversationId,
            model: responseDecision.modelTier,
            provider: responseDecision.provider,
            input_tokens: costBreakdown.promptTokens,
            output_tokens: costBreakdown.completionTokens,
            thinking_tokens: costBreakdown.reasoningTokens,
            input_cost: costBreakdown.inputCostUsd,
            output_cost: costBreakdown.outputCostUsd,
            thinking_cost: costBreakdown.reasoningCostUsd,
            total_cost: costBreakdown.totalUsd,
            pricing_version: costBreakdown.pricingVersion,
            complexity_score: responseDecision.complexityScore,
            route_rationale: responseDecision.rationaleTag,
          },
        );

        if (assistantText.trim()) {
          persistMessageAsync(
            supabaseClient as unknown as ReturnType<typeof createClient>,
            conversationId,
            'assistant',
            assistantText,
            assistantTokenCount,
            `${responseDecision.provider}:${effectiveModelId}`,
          );
          void maybeSummarizeConversationAsync(
            supabaseClient as unknown as ReturnType<typeof createClient>,
            userId,
            conversationId,
            ownership.tokenCount + userTokenCount + assistantTokenCount,
            { openai: OPENAI_API_KEY, anthropic: ANTHROPIC_API_KEY, google: GOOGLE_API_KEY },
          );
        }
      },
    });

    return new Response(proxyStream, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Router-Model': responseDecision.modelTier,
        'X-Router-Model-Id': effectiveModelId,
        'X-Provider': responseDecision.provider,
        // Preserve semantics: "override used or auto".
        // If debate was explicitly requested, reflect that in X-Model-Override.
        'X-Model-Override': debateOverrideHeader || normalizedOverride || 'auto',
        'X-Router-Rationale': responseDecision.rationaleTag,
        'X-Complexity-Score': responseDecision.complexityScore.toString(),
        'X-Gemini-Thinking-Level': upstream.effectiveGeminiFlashThinkingLevel || 'n/a',
        'X-Memory-Hits': String(memoryRetrieval.hits),
        'X-Memory-Tokens': String(memoryRetrieval.tokenCount),
        'X-Cost-Estimate-USD': effectiveCostEstimateUsd.toFixed(6),
        'X-Cost-Pricing-Version': preFlightCost.pricingVersion,
        // Debate headers are emitted ONLY when debate ran (absent = debate did not run).
        ...buildDebateHeaders({
          debateActive,
          debateProfile: debateProfileEffective,
          debateTrigger: debateTriggerEffective,
          ...(debateModelTierEffective ? { debateModelTier: debateModelTierEffective } : {}),
        }),
        // SMD headers: emitted when SMD pipeline ran OR fast-path triggered.
        ...(smdActive && smdRunLog ? {
          'X-SMD-Mode': 'true',
          'X-SMD-Issue-Count': String(smdRunLog.issueCount),
          'X-SMD-High-Critical-Count': String(smdRunLog.highCriticalCount),
          'X-SMD-Unresolved-Risk-Count': String(smdRunLog.unresolvedRiskCount),
          'X-SMD-Parse-Status': (smdRunLog.skepticSchemaValid && smdRunLog.synthSchemaValid)
            ? 'ok'
            : 'degraded',
          'X-SMD-Fast-Path': 'false',
        } : smdFastPathHit ? {
          'X-SMD-Mode': 'true',
          'X-SMD-Fast-Path': 'true',
        } : {}),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return new Response(JSON.stringify({ error: 'Request timeout' }), {
        status: 504,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    console.error('[Router] Critical error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } finally {
    clearTimeout(timeoutId);
  }
});
