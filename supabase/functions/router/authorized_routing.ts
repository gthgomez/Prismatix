import { MODEL_BENCHMARKS } from '../_shared/model_benchmarks.ts';
import { isProviderId } from '../_shared/provider_registry.ts';
import { isCurrentRouteTariff, type ServingRoute } from '../_shared/serving_routes.ts';
import { calculatePreFlightCost, type PreFlightCostResult } from './cost_engine.ts';
import { analyzeRouting, normalizeModelOverride, type RouteDecision, type RouterParams } from './router_logic.ts';

interface RouteSelectionOptions {
  params: RouterParams;
  contextText: string;
  imageCount: number;
  additionalPromptTokens: number;
  maximumCostUsd: number;
  manual?: string;
  profile?: 'economy' | 'balanced' | 'capability';
  preferredProvider?: string | null;
}

type RouteSelectionFailure = { ok: false; code: string; status: number; message: string };
type RouteSelectionResult = RouteSelectionFailure | { ok: true; decision: RouteDecision; cost: PreFlightCostResult };

export const AUTHORIZED_ROUTING_POLICY = 'account-routes-v1';

function deny(code: string, message: string, status = 409): RouteSelectionFailure {
  return { ok: false, code, message, status };
}

export function selectAuthorizedRoute(routes: readonly ServingRoute[], options: RouteSelectionOptions): RouteSelectionResult {
  const analysis = analyzeRouting(options.params);
  const profile = options.profile ?? 'balanced';
  const override = options.manual?.trim();
  const manual = override && override.toLowerCase() !== 'auto' ? override : undefined;
  let requested = routes;
  if (manual) {
    const exact = routes.find((route) => route.id === manual);
    if (exact) {
      requested = [exact];
    } else {
      // An explicit serving route that disappeared must never select another provider.
      if (isProviderId(manual.split(':')[0]) && manual.includes(':')) {
        return deny('route_unavailable', 'That model connection is unavailable. Refresh Provider Settings or choose another route.');
      }
      const legacyModel = normalizeModelOverride(manual);
      requested = routes.filter((route) => route.canonicalId === (legacyModel ?? manual));
      if (!legacyModel && requested.length === 0) {
        return deny('unknown_model', 'Choose a model from your connected routes.', 400);
      }
      if (requested.length > 1) {
        return deny('route_selection_required', 'Choose the provider to use for this model.');
      }
    }
    if (!requested.length) return deny('route_unavailable', 'That model is unavailable on your connections. Refresh Provider Settings or choose another model.');
  }
  if (!requested.length) return deny('provider_key_required', 'Connect and verify an inference provider in Provider Settings.');

  const modalities = requested.filter((route) => !options.imageCount || route.supportsImages);
  if (!modalities.length) return deny('modality_mismatch', 'Choose a model that accepts images or remove the image attachments.', 400);

  const codingRequest = analysis.isCodeHeavy || /\b(code|coding|programming|debug|refactor|implementation)\b/i.test(options.params.userQuery);
  const suitable = modalities.filter((route) =>
    (route.provider !== 'opencode_go' || codingRequest) &&
    (manual || analysis.reasoningDifficulty < 70 || route.supportsReasoning)
  );
  if (!suitable.length) return deny('route_incompatible', 'Your connected routes do not support this request. Choose another provider or model.');

  const priced = suitable.filter((route) => isCurrentRouteTariff(route.tariff));
  if (!priced.length) return deny('unknown_model_pricing', 'Refresh model pricing in Provider Settings or choose another connection.');
  const estimates = priced.map((route) => ({
    route,
    cost: calculatePreFlightCost(route.canonicalId, options.contextText, options.imageCount, options.additionalPromptTokens, route.tariff),
    benchmark: MODEL_BENCHMARKS[route.canonicalId]?.benchmarkScore,
  }));
  const contextCompatible = estimates.filter(({ route, cost }) =>
    cost.promptTokens + cost.projectedOutputTokens <= route.contextWindow && cost.projectedOutputTokens <= route.maxOutputTokens
  );
  if (!contextCompatible.length) return deny('context_limit_exceeded', 'Shorten the conversation or choose a model with a larger context window.', 400);

  const candidates = contextCompatible.filter(({ cost }) => !cost.hasUnknownRate && cost.estimatedUsd <= options.maximumCostUsd);
  if (!candidates.length) return deny('request_cost_limit_exceeded', 'No compatible route fits this request’s spending limit.', 402);

  // Benchmark data is used as recorded and only for models with evidence. A
  // missing score is never fabricated. For complex Balanced requests use the
  // most relevant existing quality band before comparing request-specific cost.
  const preferQuality = profile === 'capability' || (profile === 'balanced' && analysis.reasoningDifficulty >= 45);
  const qualityBand = (score: number | undefined) => score === undefined ? -1 : Math.floor(score / 10);
  candidates.sort((a, b) => {
    if (!manual && preferQuality) {
      const qualityDelta = profile === 'capability'
        ? (b.benchmark ?? -1) - (a.benchmark ?? -1)
        : qualityBand(b.benchmark) - qualityBand(a.benchmark);
      if (qualityDelta) return qualityDelta;
    }
    return a.cost.estimatedUsd - b.cost.estimatedUsd ||
      Number(b.route.provider === options.preferredProvider) - Number(a.route.provider === options.preferredProvider) ||
      a.route.id.localeCompare(b.route.id);
  });
  const { route, cost } = candidates[0]!;
  const rationaleTag = manual ? 'manual-serving-route' : `${AUTHORIZED_ROUTING_POLICY}-${profile}`;
  return {
    ok: true,
    cost,
    decision: {
      servingRoute: route,
      provider: route.provider,
      model: route.upstreamId,
      modelTier: route.canonicalId,
      budgetCap: Math.min(route.maxOutputTokens, route.contextWindow - cost.promptTokens),
      rationaleTag,
      complexityScore: analysis.complexityScore,
      routingDebug: { ...analysis, routeStep: rationaleTag },
      explanation: {
        selection: manual ? 'override' : 'auto',
        modelTier: route.canonicalId,
        gateway: route.provider === 'opencode' ? 'opencode' : 'direct_fallback',
        reason: manual ? 'Used the selected model connection.' : `Selected an eligible connection using the ${profile} routing policy.`,
        fallbackUsed: false,
        priceKnown: true,
      },
    },
  };
}
