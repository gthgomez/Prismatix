// debate_profiles.ts
// Debate Mode is a router "tool": run 1-2 challenger critiques, then ask the primary model to synthesize.
// This file contains ONLY config + pure helpers (no fetch side effects).

import type { RouterModel } from './router_logic.ts';

export type DebateProfile = 'general' | 'code' | 'video_ui';
export type DebateTrigger = 'off' | 'explicit' | 'auto';

export interface DebatePlan {
  profile: DebateProfile;
  challengers: Array<{ role: string; modelTier: RouterModel }>;
  maxChallengerChars: number;
}

export const DEFAULT_DEBATE_THRESHOLD = 85;

/**
 * Cost-ordered cascade for debate challengers (cheapest first).
 * When a challenger's assigned model fails, runChallengerWithFallback
 * tries each tier in this order until one succeeds.
 *
 * Blended $/1M (3:1 in:out ratio) as of 2026-03-20:
 *   nemotron-3-super:  $0.10in / $0.50out → ~$0.11 blended
 *   gemini-3-flash:    $0.50in / $3.00out → ~$1.13 blended
 *   gpt-5.4-mini:      $0.75in / $4.50out → ~$1.69 blended
 */
export const DEBATE_COST_CASCADE: RouterModel[] = [
  'nemotron-3-super',
  'gemini-3-flash',
  'gpt-5.4-mini',
];

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

/**
 * Choose challengers based on profile + primary model.
 * Goal: keep it cheap + diverse, but never require frontend RouterModel changes.
 */
export function getDebatePlan(profile: DebateProfile, primary: RouterModel): DebatePlan {
  // Keep challengers bounded for cost/perf.
  // NOTE: All tiers must exist in MODEL_REGISTRY; do not invent keys here.
  const base = profile === 'code'
    ? [
        { role: 'critic', modelTier: 'gpt-5.4-mini' as RouterModel },
        { role: 'implementer', modelTier: 'haiku-4.5' as RouterModel },
      ]
    : profile === 'video_ui'
    ? [
        { role: 'UI Designer Critic', modelTier: 'gemini-3.1-pro' as RouterModel },
        { role: 'Product QA / UX Researcher', modelTier: 'gemini-3.1-pro' as RouterModel },
        { role: 'Customer Persona', modelTier: 'gemini-3.1-pro' as RouterModel },
      ]
    : [
        { role: 'skeptic', modelTier: 'gpt-5.4-mini' as RouterModel },
        { role: 'synthesist', modelTier: 'gemini-3-flash' as RouterModel },
      ];

  const filtered = profile === 'video_ui'
    ? base
    : base.filter((c) => c.modelTier !== primary);
  const challengers = uniq(uniqChallengers(filtered)).slice(0, profile === 'video_ui' ? 3 : 2);

  return {
    profile,
    challengers,
    // Keep worker outputs bounded so synthesis prompt doesn't explode.
    maxChallengerChars: profile === 'code' ? 2400 : profile === 'video_ui' ? 1800 : 2000,
  };
}
