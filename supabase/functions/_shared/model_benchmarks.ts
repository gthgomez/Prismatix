// model_benchmarks.ts — Standardized Artificial Intelligence Benchmark Registry
// Single source of truth for model intelligence scores, rankings, and peer tier bands.
// Used by the Prismatix Router for deterministic Auto and Manual Debate Mode pairing.

import { MODEL_TARIFF, type TariffEntry } from './model_tariff.ts';

export const BENCHMARK_REGISTRY_VERSION = '2026-10-19-v1' as const;

export type IntelligenceBand = 'frontier' | 'high' | 'balanced' | 'economy';

export interface ModelBenchmarkEntry {
  modelTier: string;
  family: string;
  displayName: string;
  /** Composite AI Benchmark Score (0-100 scale, normalized across LMSYS Chatbot Arena, Artificial Analysis, and SWE-bench). */
  benchmarkScore: number;
  intelligenceBand: IntelligenceBand;
  rank: number;
  verifiedAt: string;
}

export const INTELLIGENCE_BAND_DEFINITIONS: Record<
  IntelligenceBand,
  { label: string; minScore: number; maxScore: number; description: string }
> = {
  frontier: {
    label: 'Frontier Intelligence',
    minScore: 93,
    maxScore: 100,
    description: 'Max tier frontier reasoning, deep synthesis & complex architecture',
  },
  high: {
    label: 'High-End Reasoning',
    minScore: 84,
    maxScore: 92,
    description: 'Premier coding, security auditing & heavy analytical workloads',
  },
  balanced: {
    label: 'Balanced & Fast Reasoning',
    minScore: 74,
    maxScore: 83,
    description: 'High-speed reasoning, conversational agility & cost-effective intelligence',
  },
  economy: {
    label: 'Economy & Lightweight',
    minScore: 0,
    maxScore: 73,
    description: 'Ultra-low latency, basic utilities & zero-marginal-cost tasks',
  },
};

/**
 * Standardized Benchmark Intelligence Catalog.
 * Ranked strictly by verified AI benchmark composite scores.
 */
export const MODEL_BENCHMARKS: Record<string, ModelBenchmarkEntry> = {
  // ── Frontier Band (Score >= 93) ───────────────────────────────────────────
  'claude-opus-5-5': {
    modelTier: 'claude-opus-5-5',
    family: 'anthropic',
    displayName: 'Claude Opus 5.5',
    benchmarkScore: 98,
    intelligenceBand: 'frontier',
    rank: 1,
    verifiedAt: '2026-10-10',
  },
  'gpt-6.1-sol': {
    modelTier: 'gpt-6.1-sol',
    family: 'openai',
    displayName: 'GPT-6.1 Sol',
    benchmarkScore: 97,
    intelligenceBand: 'frontier',
    rank: 2,
    verifiedAt: '2026-10-06',
  },
  'gpt-6-sol': {
    modelTier: 'gpt-6-sol',
    family: 'openai',
    displayName: 'GPT-6 Sol',
    benchmarkScore: 96,
    intelligenceBand: 'frontier',
    rank: 3,
    verifiedAt: '2026-10-06',
  },
  'claude-opus-5': {
    modelTier: 'claude-opus-5',
    family: 'anthropic',
    displayName: 'Claude Opus 5',
    benchmarkScore: 95,
    intelligenceBand: 'frontier',
    rank: 4,
    verifiedAt: '2026-08-16',
  },
  'gpt-5.6-sol': {
    modelTier: 'gpt-5.6-sol',
    family: 'openai',
    displayName: 'GPT-5.6 Sol',
    benchmarkScore: 94,
    intelligenceBand: 'frontier',
    rank: 5,
    verifiedAt: '2026-08-16',
  },

  // ── High-End Reasoning Band (Score 84 - 92) ──────────────────────────────
  'claude-sonnet-5-5': {
    modelTier: 'claude-sonnet-5-5',
    family: 'anthropic',
    displayName: 'Claude Sonnet 5.5',
    benchmarkScore: 91,
    intelligenceBand: 'high',
    rank: 6,
    verifiedAt: '2026-10-06',
  },
  'gpt-6-astra': {
    modelTier: 'gpt-6-astra',
    family: 'openai',
    displayName: 'GPT-6 Astra',
    benchmarkScore: 90,
    intelligenceBand: 'high',
    rank: 7,
    verifiedAt: '2026-10-10',
  },
  'deepseek-v4-pro': {
    modelTier: 'deepseek-v4-pro',
    family: 'deepseek',
    displayName: 'DeepSeek V4 Pro',
    benchmarkScore: 89,
    intelligenceBand: 'high',
    rank: 8,
    verifiedAt: '2026-08-16',
  },
  'claude-sonnet-5': {
    modelTier: 'claude-sonnet-5',
    family: 'anthropic',
    displayName: 'Claude Sonnet 5',
    benchmarkScore: 88,
    intelligenceBand: 'high',
    rank: 9,
    verifiedAt: '2026-08-16',
  },
  'gpt-5.6-terra': {
    modelTier: 'gpt-5.6-terra',
    family: 'openai',
    displayName: 'GPT-5.6 Terra',
    benchmarkScore: 87,
    intelligenceBand: 'high',
    rank: 10,
    verifiedAt: '2026-08-16',
  },
  'grok-4.7': {
    modelTier: 'grok-4.7',
    family: 'xai',
    displayName: 'Grok 4.7',
    benchmarkScore: 86,
    intelligenceBand: 'high',
    rank: 11,
    verifiedAt: '2026-09-01',
  },
  'grok-4.6': {
    modelTier: 'grok-4.6',
    family: 'xai',
    displayName: 'Grok 4.6',
    benchmarkScore: 85,
    intelligenceBand: 'high',
    rank: 12,
    verifiedAt: '2026-08-16',
  },

  // ── Balanced & Fast Reasoning Band (Score 74 - 83) ───────────────────────
  'gpt-6-luna': {
    modelTier: 'gpt-6-luna',
    family: 'openai',
    displayName: 'GPT-6 Luna',
    benchmarkScore: 82,
    intelligenceBand: 'balanced',
    rank: 13,
    verifiedAt: '2026-10-06',
  },
  'deepseek-v4-1-flash': {
    modelTier: 'deepseek-v4-1-flash',
    family: 'deepseek',
    displayName: 'DeepSeek V4.1 Flash',
    benchmarkScore: 81,
    intelligenceBand: 'balanced',
    rank: 14,
    verifiedAt: '2026-10-07',
  },
  'gemini-3.8-flash': {
    modelTier: 'gemini-3.8-flash',
    family: 'google',
    displayName: 'Gemini 3.8 Flash',
    benchmarkScore: 80,
    intelligenceBand: 'balanced',
    rank: 15,
    verifiedAt: '2026-10-06',
  },
  'claude-haiku-5-5': {
    modelTier: 'claude-haiku-5-5',
    family: 'anthropic',
    displayName: 'Claude Haiku 5.5',
    benchmarkScore: 79,
    intelligenceBand: 'balanced',
    rank: 16,
    verifiedAt: '2026-09-20',
  },
  'deepseek-v4-flash': {
    modelTier: 'deepseek-v4-flash',
    family: 'deepseek',
    displayName: 'DeepSeek V4 Flash',
    benchmarkScore: 78,
    intelligenceBand: 'balanced',
    rank: 17,
    verifiedAt: '2026-08-16',
  },
  'gpt-5.6-luna': {
    modelTier: 'gpt-5.6-luna',
    family: 'openai',
    displayName: 'GPT-5.6 Luna',
    benchmarkScore: 77,
    intelligenceBand: 'balanced',
    rank: 18,
    verifiedAt: '2026-08-16',
  },
  'gemini-3.7-flash': {
    modelTier: 'gemini-3.7-flash',
    family: 'google',
    displayName: 'Gemini 3.7 Flash',
    benchmarkScore: 76,
    intelligenceBand: 'balanced',
    rank: 19,
    verifiedAt: '2026-08-16',
  },
  'qwen-3.8-flash': {
    modelTier: 'qwen-3.8-flash',
    family: 'qwen',
    displayName: 'Qwen 3.8 Flash',
    benchmarkScore: 75,
    intelligenceBand: 'balanced',
    rank: 20,
    verifiedAt: '2026-10-10',
  },
  'glm-5.3-flash': {
    modelTier: 'glm-5.3-flash',
    family: 'glm',
    displayName: 'GLM 5.3 Flash',
    benchmarkScore: 74,
    intelligenceBand: 'balanced',
    rank: 21,
    verifiedAt: '2026-10-10',
  },

  // ── Economy Band (Score < 74) ────────────────────────────────────────────
  'claude-haiku-4-5': {
    modelTier: 'claude-haiku-4-5',
    family: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    benchmarkScore: 73,
    intelligenceBand: 'economy',
    rank: 22,
    verifiedAt: '2026-08-16',
  },
  'deepseek-v4-flash-free': {
    modelTier: 'deepseek-v4-flash-free',
    family: 'deepseek',
    displayName: 'DeepSeek V4 Flash (Free)',
    benchmarkScore: 72,
    intelligenceBand: 'economy',
    rank: 23,
    verifiedAt: '2026-08-16',
  },
  'mimo-2.6-flash': {
    modelTier: 'mimo-2.6-flash',
    family: 'other',
    displayName: 'Mimo 2.6 Flash',
    benchmarkScore: 71,
    intelligenceBand: 'economy',
    rank: 24,
    verifiedAt: '2026-10-10',
  },
  'mimo-v2.5-free': {
    modelTier: 'mimo-v2.5-free',
    family: 'other',
    displayName: 'Mimo 2.5 Free',
    benchmarkScore: 70,
    intelligenceBand: 'economy',
    rank: 25,
    verifiedAt: '2026-10-10',
  },
};

export function getModelBenchmark(modelTier: string): ModelBenchmarkEntry {
  const normalized = modelTier.trim().toLowerCase();
  const found = MODEL_BENCHMARKS[normalized];
  if (found) return found;

  // Fallback heuristic for unknown / alias models
  return {
    modelTier: normalized,
    family: 'other',
    displayName: normalized,
    benchmarkScore: 75,
    intelligenceBand: 'balanced',
    rank: 99,
    verifiedAt: '2026-10-19',
  };
}

export function getModelIntelligenceBand(modelTier: string): IntelligenceBand {
  return getModelBenchmark(modelTier).intelligenceBand;
}

/**
 * Calculates a blended token cost index for deterministic tie-breaking.
 * Formula: (Input Rate + 2 * Output Rate) / 3 (assuming 1:2 input-to-output token ratio).
 */
export function calculateBlendedCostPer1M(
  modelTier: string,
  tariffMap: Record<string, TariffEntry> = MODEL_TARIFF,
): number {
  const tariff = tariffMap[modelTier];
  if (!tariff) return 999.0;
  const inRate = Number(tariff.inputRatePer1M ?? 0);
  const outRate = Number(tariff.outputRatePer1M ?? 0);
  return (inRate + 2 * outRate) / 3;
}

export interface ResolvePeerChallengersParams {
  primaryModel: string;
  count?: number;
  isReady?: (modelTier: string) => boolean;
  tariffMap?: Record<string, TariffEntry>;
}

export interface ResolvedPeerSelection {
  primaryModel: string;
  primaryBand: IntelligenceBand;
  primaryScore: number;
  challengers: string[];
  fallbackSequences: Record<string, string[]>;
}

/**
 * Resolves 2 peer challenger models from different provider families,
 * matched to the primary model's benchmark intelligence band, with tie-breaking
 * by lowest token cost and neighbor expansion fallback.
 */
export function resolvePeerChallengers(
  params: ResolvePeerChallengersParams,
): ResolvedPeerSelection {
  const {
    primaryModel,
    count = 2,
    isReady = () => true,
    tariffMap = MODEL_TARIFF,
  } = params;

  const primaryMeta = getModelBenchmark(primaryModel);
  const primaryBand = primaryMeta.intelligenceBand;
  const primaryScore = primaryMeta.benchmarkScore;
  const primaryFamily = primaryMeta.family;

  // Collect all catalog models with benchmark metadata
  const allEntries = Object.values(MODEL_BENCHMARKS);

  // Helper to score cost
  const getCost = (tier: string) => calculateBlendedCostPer1M(tier, tariffMap);

  // ── Step 1: Collect candidates within the SAME intelligence band ──────────
  const sameBandCandidates = allEntries.filter(
    (e) =>
      e.modelTier !== primaryModel &&
      e.intelligenceBand === primaryBand &&
      isReady(e.modelTier),
  );

  // Group same-band candidates by provider family, sorting each family by cost
  const sameBandByFamily = new Map<string, ModelBenchmarkEntry[]>();
  for (const c of sameBandCandidates) {
    if (!sameBandByFamily.has(c.family)) {
      sameBandByFamily.set(c.family, []);
    }
    sameBandByFamily.get(c.family)!.push(c);
  }
  for (const list of sameBandByFamily.values()) {
    list.sort((a, b) => getCost(a.modelTier) - getCost(b.modelTier));
  }

  // Filter out the primary's family first to maximize external adversarial diversity
  const chosenChallengers: string[] = [];
  const chosenFamilies = new Set<string>();

  // Sort distinct non-primary families by their lowest-cost model
  const distinctFamilies = Array.from(sameBandByFamily.keys())
    .filter((f) => f !== primaryFamily)
    .sort((fa, fb) => {
      const bestA = sameBandByFamily.get(fa)![0]!.modelTier;
      const bestB = sameBandByFamily.get(fb)![0]!.modelTier;
      return getCost(bestA) - getCost(bestB);
    });

  for (const family of distinctFamilies) {
    if (chosenChallengers.length >= count) break;
    const bestInFamily = sameBandByFamily.get(family)![0]!;
    chosenChallengers.push(bestInFamily.modelTier);
    chosenFamilies.add(family);
  }

  // ── Step 2: Neighbor Expansion Fallback if fewer than `count` distinct families ─
  if (chosenChallengers.length < count) {
    // Collect all remaining models from available distinct families not yet chosen
    const remainingCandidates = allEntries.filter(
      (e) =>
        e.modelTier !== primaryModel &&
        !chosenChallengers.includes(e.modelTier) &&
        !chosenFamilies.has(e.family) &&
        e.family !== primaryFamily &&
        isReady(e.modelTier),
    );

    // Sort by: 1) absolute score distance to primary, 2) blended cost
    remainingCandidates.sort((a, b) => {
      const distA = Math.abs(a.benchmarkScore - primaryScore);
      const distB = Math.abs(b.benchmarkScore - primaryScore);
      if (distA !== distB) return distA - distB;
      return getCost(a.modelTier) - getCost(b.modelTier);
    });

    for (const cand of remainingCandidates) {
      if (chosenChallengers.length >= count) break;
      if (!chosenFamilies.has(cand.family)) {
        chosenChallengers.push(cand.modelTier);
        chosenFamilies.add(cand.family);
      }
    }
  }

  // ── Step 3: Last Resort Fallback (if still < count, allow secondary from same family) ─
  if (chosenChallengers.length < count) {
    const lastResort = allEntries.filter(
      (e) =>
        e.modelTier !== primaryModel &&
        !chosenChallengers.includes(e.modelTier) &&
        isReady(e.modelTier),
    );
    lastResort.sort((a, b) => {
      const distA = Math.abs(a.benchmarkScore - primaryScore);
      const distB = Math.abs(b.benchmarkScore - primaryScore);
      if (distA !== distB) return distA - distB;
      return getCost(a.modelTier) - getCost(b.modelTier);
    });
    for (const cand of lastResort) {
      if (chosenChallengers.length >= count) break;
      chosenChallengers.push(cand.modelTier);
    }
  }

  // ── Step 4: Build robust fallback sequences for each challenger ───────────
  const fallbackSequences: Record<string, string[]> = {};
  for (const challengerTier of chosenChallengers) {
    const cMeta = getModelBenchmark(challengerTier);
    // Other ready candidates in the same band, plus adjacent neighbors
    const cascade = allEntries
      .filter((e) => e.modelTier !== primaryModel && isReady(e.modelTier))
      .sort((a, b) => {
        const distA = Math.abs(a.benchmarkScore - cMeta.benchmarkScore);
        const distB = Math.abs(b.benchmarkScore - cMeta.benchmarkScore);
        if (distA !== distB) return distA - distB;
        return getCost(a.modelTier) - getCost(b.modelTier);
      })
      .map((e) => e.modelTier);

    const filteredCascade = cascade.filter((m) => m !== challengerTier);
    fallbackSequences[challengerTier] = [challengerTier, ...filteredCascade];
  }

  return {
    primaryModel,
    primaryBand,
    primaryScore,
    challengers: chosenChallengers,
    fallbackSequences,
  };
}
