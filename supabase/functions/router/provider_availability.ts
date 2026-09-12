// provider_availability.ts
// Provider-unavailable re-routing with a fail-closed cost guard.
//
// Cost-safety invariant: when the routed provider has no configured
// credentials, the request may be re-routed only to a fallback whose price is
// known and whose cost basis (input+output rates per 1M) is not higher than
// the originally decided model. Availability failures can therefore never
// escalate spend, and when no safe fallback exists the request fails with a
// deterministic, user-readable error.

import {
  createStubRoutingDebug,
  MODEL_REGISTRY,
  type Provider,
  type RouteDecision,
  type RouterModel,
} from './router_logic.ts';
import { getPricingForModel } from './pricing_registry.ts';

/** Conservative cost basis (input+output rates per 1M) used to bound fallback escalation. */
export function modelRateBasis(modelTier: RouterModel): number {
  const pricing = getPricingForModel(modelTier);
  // Unknown pricing is treated as infinitely expensive: a fallback must never
  // silently replace an unpriced decision with a priced (and billable) one.
  return pricing.isUnknown
    ? Number.POSITIVE_INFINITY
    : pricing.inputRatePer1M + pricing.outputRatePer1M;
}

/** Deterministic, price-known fallback order for provider-unavailable re-routing. */
export const PROVIDER_UNAVAILABLE_FALLBACKS: RouterModel[] = [
  'gemini-2.5-flash',
  'gpt-5.4-mini',
  'sonnet-4.6',
];

export function priceKnownFor(modelTier: RouterModel): boolean {
  return !getPricingForModel(modelTier).isUnknown;
}

export function decisionFromModel(
  modelTier: RouterModel,
  complexityScore: number,
  rationaleTag: string,
): RouteDecision {
  const modelCfg = MODEL_REGISTRY[modelTier];
  if (!modelCfg) {
    throw new Error(`Unknown model tier '${modelTier}' for provider availability decision.`);
  }
  return {
    provider: modelCfg.provider,
    model: modelCfg.modelId,
    modelTier,
    budgetCap: modelCfg.budgetCap,
    rationaleTag,
    complexityScore,
    routingDebug: createStubRoutingDebug(complexityScore, rationaleTag),
    explanation: {
      selection: 'auto',
      modelTier,
      gateway: modelCfg.provider === 'opencode' ? 'opencode' : 'direct_fallback',
      reason: `Selected by the router for this pipeline stage (${rationaleTag}).`,
      fallbackUsed: rationaleTag.includes('fallback'),
      priceKnown: priceKnownFor(modelTier),
    },
  };
}

export type ProviderReadyPredicate = (provider: Provider) => boolean;

export function normalizeDecisionAgainstProviderAvailability(
  decision: RouteDecision,
  normalizedOverride: RouterModel | undefined,
  isProviderReady: ProviderReadyPredicate,
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

  const decidedBasis = modelRateBasis(decision.modelTier);
  const attemptedModels: string[] = [];
  for (const candidate of PROVIDER_UNAVAILABLE_FALLBACKS) {
    const config = MODEL_REGISTRY[candidate];
    if (!config || !isProviderReady(config.provider)) {
      attemptedModels.push(`${candidate}: provider-not-ready`);
      continue;
    }
    if (modelRateBasis(candidate) > decidedBasis) {
      attemptedModels.push(`${candidate}: more-expensive-than-decided`);
      continue;
    }
    const fallbackDecision = decisionFromModel(
      candidate,
      decision.complexityScore,
      `provider-unavailable-fallback-${decision.provider}`,
    );
    fallbackDecision.explanation = {
      selection: 'auto',
      modelTier: candidate,
      gateway: 'direct_fallback',
      fallbackUsed: true,
      attemptedModels: [
        `${decision.modelTier}: provider-unavailable`,
        ...attemptedModels,
      ],
      reason:
        `The routed provider '${decision.provider}' is unavailable; re-routed to the cheaper priced fallback '${candidate}'.`,
      priceKnown: priceKnownFor(candidate),
    };
    return { decision: fallbackDecision };
  }

  return {
    decision,
    error: `Auto routing failed closed: the routed model '${decision.modelTier}' requires provider ` +
      `'${decision.provider}', which is unavailable, and no cheaper priced fallback is configured.`,
  };
}
