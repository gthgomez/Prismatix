import { countTokens, type RouterModel } from './router_logic.ts';
import {
  lookupPrice,
  PRICING_VERSION,
  type PriceLookupResult,
  type PriceStatus,
} from './pricing_registry.ts';

function provenanceFields(lookup: PriceLookupResult) {
  return {
    pricingStatus: lookup.status,
    isStale: lookup.status === 'stale',
    pricingSourceRef: lookup.sourceRef,
    pricingSourceUrl: lookup.sourceUrl,
    pricingEffectiveFrom: lookup.effectiveFrom,
    pricingEffectiveUntil: lookup.effectiveUntil,
  };
}

const TOKENS_PER_MILLION = 1_000_000;

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export interface PreFlightCostResult {
  tokenEstimate: number;
  promptTokens: number;
  projectedOutputTokens: number;
  estimatedUsd: number;
  pricingVersion: string;
  hasUnknownRate: boolean;
  /** Typed pricing status backing this estimate (known/stale/unknown). */
  pricingStatus: PriceStatus;
  isStale: boolean;
  /** Effective source/date provenance for pricing receipts. */
  pricingSourceRef: string | null;
  pricingSourceUrl: string | null;
  pricingEffectiveFrom: string | null;
  pricingEffectiveUntil: string | null;
}

export interface UsageStats {
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
}

export interface FinalCostResult {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  finalUsd: number;
  pricingVersion: string;
  hasUnknownRate: boolean;
  pricingStatus: PriceStatus;
  isStale: boolean;
  pricingSourceRef: string | null;
  pricingSourceUrl: string | null;
  pricingEffectiveFrom: string | null;
  pricingEffectiveUntil: string | null;
}

export interface CostBreakdownResult {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  reasoningCostUsd: number;
  totalUsd: number;
  pricingVersion: string;
  hasUnknownRate: boolean;
  pricingStatus: PriceStatus;
  isStale: boolean;
  pricingSourceRef: string | null;
  pricingSourceUrl: string | null;
  pricingEffectiveFrom: string | null;
  pricingEffectiveUntil: string | null;
}

export function calculatePreFlightCost(
  modelTier: RouterModel,
  contextText: string,
  images: number,
  additionalPromptTokens = 0,
): PreFlightCostResult {
  const imageTokens = Math.max(0, images) * 1600;
  const promptTokens = countTokens(contextText) + imageTokens + Math.max(0, additionalPromptTokens);
  const projectedOutputTokens = Math.max(64, Math.ceil(promptTokens * 0.35));
  const lookup = lookupPrice(modelTier, promptTokens);

  // Fail-closed: an unknown price is a null record, never a zero estimate
  // masquerading as a real cost. Auto routing is rejected downstream.
  if (lookup.pricing === null) {
    return {
      tokenEstimate: promptTokens + projectedOutputTokens,
      promptTokens,
      projectedOutputTokens,
      estimatedUsd: 0,
      pricingVersion: PRICING_VERSION,
      hasUnknownRate: true,
      ...provenanceFields(lookup),
    };
  }
  const pricing = lookup.pricing;

  const inputCost = (promptTokens / TOKENS_PER_MILLION) * pricing.inputRatePer1M;
  const outputCost = (projectedOutputTokens / TOKENS_PER_MILLION) * pricing.outputRatePer1M;

  return {
    tokenEstimate: promptTokens + projectedOutputTokens,
    promptTokens,
    projectedOutputTokens,
    estimatedUsd: roundUsd(inputCost + outputCost),
    pricingVersion: PRICING_VERSION,
    hasUnknownRate: false,
    ...provenanceFields(lookup),
  };
}

export function calculateFinalCost(
  modelTier: RouterModel,
  usage: UsageStats,
): FinalCostResult {
  const promptTokens = Math.max(0, usage.promptTokens || 0);
  const completionTokens = Math.max(0, usage.completionTokens || 0);
  const reasoningTokens = Math.max(0, usage.reasoningTokens || 0);
  const lookup = lookupPrice(modelTier);

  if (lookup.pricing === null) {
    return {
      promptTokens,
      completionTokens,
      reasoningTokens,
      finalUsd: 0,
      pricingVersion: PRICING_VERSION,
      hasUnknownRate: true,
      ...provenanceFields(lookup),
    };
  }
  const pricing = lookup.pricing;

  const inputCost = (promptTokens / TOKENS_PER_MILLION) * pricing.inputRatePer1M;
  const outputCost = (completionTokens / TOKENS_PER_MILLION) * pricing.outputRatePer1M;
  const reasoningRate = pricing.reasoningRatePer1M ?? pricing.outputRatePer1M;
  const reasoningCost = (reasoningTokens / TOKENS_PER_MILLION) * reasoningRate;

  return {
    promptTokens,
    completionTokens,
    reasoningTokens,
    finalUsd: roundUsd(inputCost + outputCost + reasoningCost),
    pricingVersion: PRICING_VERSION,
    hasUnknownRate: false,
    ...provenanceFields(lookup),
  };
}

export function calculateCostBreakdown(
  modelTier: RouterModel,
  usage: UsageStats,
): CostBreakdownResult {
  const promptTokens = Math.max(0, usage.promptTokens || 0);
  const completionTokens = Math.max(0, usage.completionTokens || 0);
  const reasoningTokens = Math.max(0, usage.reasoningTokens || 0);
  const lookup = lookupPrice(modelTier);

  if (lookup.pricing === null) {
    return {
      promptTokens,
      completionTokens,
      reasoningTokens,
      inputCostUsd: 0,
      outputCostUsd: 0,
      reasoningCostUsd: 0,
      totalUsd: 0,
      pricingVersion: PRICING_VERSION,
      hasUnknownRate: true,
      ...provenanceFields(lookup),
    };
  }
  const pricing = lookup.pricing;

  const inputCost = roundUsd((promptTokens / TOKENS_PER_MILLION) * pricing.inputRatePer1M);
  const outputCost = roundUsd((completionTokens / TOKENS_PER_MILLION) * pricing.outputRatePer1M);
  const reasoningRate = pricing.reasoningRatePer1M ?? pricing.outputRatePer1M;
  const reasoningCost = roundUsd((reasoningTokens / TOKENS_PER_MILLION) * reasoningRate);

  return {
    promptTokens,
    completionTokens,
    reasoningTokens,
    inputCostUsd: inputCost,
    outputCostUsd: outputCost,
    reasoningCostUsd: reasoningCost,
    totalUsd: roundUsd(inputCost + outputCost + reasoningCost),
    pricingVersion: PRICING_VERSION,
    hasUnknownRate: false,
    ...provenanceFields(lookup),
  };
}

export interface AutoSendSafetyInput {
  /** True when the model was chosen by Auto routing (no manual override). */
  isAuto: boolean;
  modelTier: RouterModel;
  hasUnknownRate: boolean;
  /** Evaluation time (defaults to now); lets callers test expiry windows. */
  evaluationDate?: Date;
}

export interface AutoSendSafetyDecision {
  allowed: boolean;
  reason?: 'unknown_pricing' | 'stale_pricing' | 'auto_not_eligible';
  message: string;
  /** True when the request may proceed but the rate is known-stale. */
  staleRateWarning?: boolean;
}

/**
 * Single authoritative gate for "may this request be sent?".
 * Unknown pricing blocks both auto and explicit selection (an unpriced model
 * can never be shown as a known cost). A stale rate (expired effective window
 * or older than STALE_AFTER_DAYS) rejects Auto before any provider call;
 * manual selection of a stale-priced model stays possible but the decision
 * carries an explicit staleness warning so it never masquerades as current.
 * Auto additionally requires the model to be flagged as eligible.
 */
export function evaluateAutoSendSafety(input: AutoSendSafetyInput): AutoSendSafetyDecision {
  const lookup = lookupPrice(input.modelTier, 0, input.evaluationDate);

  if (input.hasUnknownRate || lookup.status === 'unknown') {
    return {
      allowed: false,
      reason: 'unknown_pricing',
      message:
        `Cost safety: pricing for model '${input.modelTier}' is unknown, so Prismatix will not send this request. ` +
        'Pick a priced model manually or try again later.',
    };
  }

  if (lookup.status === 'stale') {
    const expiry = lookup.effectiveUntil
      ? ` Its advertised rates expired on ${lookup.effectiveUntil}.`
      : ` Its rates were last verified on ${lookup.effectiveFrom} and are older than the freshness window.`;
    // Stale blocks Auto unconditionally. Manual selection stays possible
    // (explicit supported policy: recorded rates are shown with a warning),
    // which is why the eligibility flag is not consulted here.
    if (input.isAuto) {
      return {
        allowed: false,
        reason: 'stale_pricing',
        message:
          `Cost safety: pricing for model '${input.modelTier}' is stale, so it will not be sent automatically.` +
          expiry +
          ' Pick a model with current pricing or choose this model explicitly after reviewing its recorded rates.',
      };
    }
    // Manual selection with a stale recorded rate: allowed, but never silent.
    return {
      allowed: true,
      staleRateWarning: true,
      message:
        `Cost safety warning: pricing for model '${input.modelTier}' is stale.` +
        expiry +
        ' The estimate below uses the recorded rate and may not match current billing.',
    };
  }

  if (input.isAuto && lookup.isEligibleForAutoRouting === false) {
    return {
      allowed: false,
      reason: 'auto_not_eligible',
      message:
        `Cost safety: model '${input.modelTier}' is not eligible for automatic routing. ` +
        'Choose it explicitly from the model menu if you want to use it.',
    };
  }

  return { allowed: true, message: '' };
}
