// debate_profiles.ts
// Debate Mode: challenger critiques synthesized by the primary model.

import type { RouterModel } from './router_logic.ts';
import { RouteRole, resolveModelForRole } from './models_hub.ts';

export type DebateProfile = 'general' | 'code' | 'video_ui';
export type DebateTrigger = 'off' | 'explicit' | 'auto';

export interface DebatePlan {
  profile: DebateProfile;
  challengers: Array<{ role: string; modelTier: RouterModel }>;
  maxChallengerChars: number;
}

export const DEFAULT_DEBATE_THRESHOLD = 85;

export const GENERAL_CHALLENGER_FALLBACKS: RouterModel[] = [
  'deepseek-v4-flash',
  'gpt-5.6-luna',
  'qwen3.5-4b',
  'glm-4.7-flash',
  'llama-3.1-8b-turbo',
];

export const CODE_CRITIC_FALLBACKS: RouterModel[] = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'claude-sonnet-5',
  'deepseek-v3',
  'glm-4.7-flash',
];

export const CODE_IMPLEMENTER_FALLBACKS: RouterModel[] = [
  'deepseek-v4-pro',
  'gpt-5.6-terra',
  'step-3.5-flash',
  'mistral-nemo',
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
 * Choose challengers based on profile + primary model using semantic roles.
 */
export function getDebatePlan(
  profile: DebateProfile,
  primary: RouterModel,
  challengerCount: 1 | 2 | 3 = 2,
): DebatePlan {
  const base = profile === 'code'
    ? [
        { role: 'critic', modelTier: 'deepseek-v4-flash' as RouterModel },
        { role: 'implementer', modelTier: 'deepseek-v4-pro' as RouterModel },
      ]
    : profile === 'video_ui'
    ? [
        { role: 'UI Designer Critic', modelTier: 'gemini-3.7-flash' as RouterModel },
        { role: 'Product QA / UX Researcher', modelTier: 'gemini-3.7-flash' as RouterModel },
        { role: 'Customer Persona', modelTier: 'gemini-3.7-flash' as RouterModel },
      ]
    : [
        { role: 'skeptic', modelTier: 'deepseek-v4-flash' as RouterModel },
        { role: 'alternative architect', modelTier: 'gpt-5.6-luna' as RouterModel },
      ];

  const filtered = profile === 'video_ui'
    ? base
    : base.filter((c) => c.modelTier !== primary);
  const challengers = uniq(uniqChallengers(filtered)).slice(0, challengerCount);

  return {
    profile,
    challengers,
    maxChallengerChars: profile === 'code' ? 2400 : profile === 'video_ui' ? 1800 : 2000,
  };
}
