// debate_profiles.ts
// Debate Mode: challenger critiques synthesized by the primary model.

import type { RouterModel } from './router_logic.ts';
import {
  resolvePeerChallengers,
  getModelBenchmark,
  type IntelligenceBand,
} from '../_shared/model_benchmarks.ts';

export type DebateProfile = 'general' | 'code' | 'video_ui';
export type DebateTrigger = 'off' | 'explicit' | 'auto';

export interface DebatePlan {
  profile: DebateProfile;
  primaryBand?: IntelligenceBand;
  primaryScore?: number;
  challengers: Array<{ role: string; modelTier: RouterModel }>;
  maxChallengerChars: number;
}

export const DEFAULT_DEBATE_THRESHOLD = 85;

export const GENERAL_CHALLENGER_FALLBACKS: RouterModel[] = [
  'deepseek-v4-1-flash',
  'gpt-6-luna',
  'gemini-3.8-flash',
];

export const CODE_CRITIC_FALLBACKS: RouterModel[] = [
  'deepseek-v4-1-flash',
  'deepseek-v4-pro',
  'claude-sonnet-5-5',
];

export const CODE_IMPLEMENTER_FALLBACKS: RouterModel[] = [
  'deepseek-v4-pro',
  'gpt-6-sol',
  'gpt-6.1-sol',
];

export const DEBATE_COST_CASCADE: RouterModel[] = GENERAL_CHALLENGER_FALLBACKS;
export const CODE_CHALLENGER_FALLBACKS: RouterModel[] = CODE_CRITIC_FALLBACKS;

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function uniqChallengers(
  arr: Array<{ role: string; modelTier: RouterModel }>,
): Array<{ role: string; modelTier: RouterModel }> {
  const seen = new Set<string>();
  const out: Array<{ role: string; modelTier: RouterModel }> = [];
  for (const c of arr) {
    const key = `${c.role}::${c.modelTier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

const HIGH_RISK_CODE_PATTERN =
  /\b(auth|password|token|secret|api.?key|billing|payment|sql|inject|xss|rce|exploit|privilege|sanitize|encrypt|hash|csrf|cors|rbac|permission|credential)\b/i;

export function resolveDebateChallengerCount(
  profile: DebateProfile,
  complexityScore: number,
  userQuery: string,
  debateWasExplicit: boolean,
): 1 | 2 | 3 {
  if (profile === 'video_ui') return 3;
  if (profile === 'code' && HIGH_RISK_CODE_PATTERN.test(userQuery)) return 2;
  if (!debateWasExplicit && complexityScore < 93) return 1;
  return 2;
}

/**
 * Choose challengers based on profile + primary model using AI benchmark intelligence ranking.
 * In Auto or Manual mode, pairs the primary model with peer models of comparable benchmark
 * intelligence from distinct provider families, breaking ties by lowest token cost.
 */
export function getDebatePlan(
  profile: DebateProfile,
  primary: RouterModel,
  challengerCount: 1 | 2 | 3 = 2,
): DebatePlan {
  if (profile === 'video_ui') {
    return {
      profile: 'video_ui',
      challengers: [
        { role: 'UI Designer Critic', modelTier: 'gemini-3.8-flash' as RouterModel },
        { role: 'Product QA / UX Researcher', modelTier: 'gemini-3.8-flash' as RouterModel },
        { role: 'Customer Persona', modelTier: 'gemini-3.8-flash' as RouterModel },
      ].slice(0, challengerCount),
      maxChallengerChars: 1800,
    };
  }

  const primaryMeta = getModelBenchmark(primary);
  const primaryBand = primaryMeta.intelligenceBand;

  let base: Array<{ role: string; modelTier: RouterModel }>;
  if (profile === 'code') {
    if (primaryBand === 'frontier') {
      base = [
        { role: 'critic', modelTier: 'claude-opus-5-5' as RouterModel },
        { role: 'implementer', modelTier: 'gpt-6.1-sol' as RouterModel },
      ];
    } else if (primaryBand === 'high') {
      base = [
        { role: 'critic', modelTier: 'deepseek-v4-pro' as RouterModel },
        { role: 'implementer', modelTier: 'claude-sonnet-5-5' as RouterModel },
      ];
    } else {
      // balanced / economy
      base = [
        { role: 'critic', modelTier: 'deepseek-v4-1-flash' as RouterModel },
        { role: 'implementer', modelTier: 'deepseek-v4-pro' as RouterModel },
      ];
    }
  } else {
    // general
    if (primaryBand === 'frontier') {
      base = [
        { role: 'skeptic', modelTier: 'claude-opus-5' as RouterModel },
        { role: 'alternative architect', modelTier: 'gpt-6-sol' as RouterModel },
      ];
    } else if (primaryBand === 'high') {
      base = [
        { role: 'skeptic', modelTier: 'deepseek-v4-pro' as RouterModel },
        { role: 'alternative architect', modelTier: 'gpt-6-astra' as RouterModel },
      ];
    } else {
      // balanced / economy
      base = [
        { role: 'skeptic', modelTier: 'deepseek-v4-1-flash' as RouterModel },
        { role: 'alternative architect', modelTier: 'gpt-6-luna' as RouterModel },
      ];
    }
  }

  const roles = profile === 'code'
    ? ['critic', 'implementer', 'critic']
    : ['skeptic', 'alternative architect', 'skeptic'];

  // Filter out primary model so a model never debates itself
  const filtered = base.filter((c) => c.modelTier !== primary);
  if (filtered.length < challengerCount) {
    const peerSelection = resolvePeerChallengers({
      primaryModel: primary,
      count: challengerCount,
    });
    for (const tier of peerSelection.challengers) {
      if (filtered.length >= challengerCount) break;
      if (!filtered.some((c) => c.modelTier === tier) && tier !== primary) {
        filtered.push({
          role: roles[filtered.length] ?? (profile === 'code' ? 'implementer' : 'alternative architect'),
          modelTier: tier as RouterModel,
        });
      }
    }
  }

  const challengers = uniq(uniqChallengers(filtered))
    .slice(0, challengerCount)
    .map((c, idx) => ({
      ...c,
      role: roles[idx] ?? c.role,
    }));

  return {
    profile,
    primaryBand,
    primaryScore: primaryMeta.benchmarkScore,
    challengers,
    maxChallengerChars: profile === 'code' ? 2400 : 2000,
  };
}
