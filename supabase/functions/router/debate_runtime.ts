// debate_runtime.ts
// Shared pure helpers for Debate Mode runtime decisions.

import {
  CODE_CRITIC_FALLBACKS,
  CODE_IMPLEMENTER_FALLBACKS,
  GENERAL_CHALLENGER_FALLBACKS,
  type DebateProfile,
  type DebateTrigger,
} from './debate_profiles.ts';
import type { Message, RouterModel } from './router_logic.ts';

export function normalizeDebateProfile(input?: string): DebateProfile {
  const v = String(input || '').trim().toLowerCase();
  if (v === 'video_ui' || v === 'video-ui' || v === 'videoui') return 'video_ui';
  if (v === 'code' || v === 'coding') return 'code';
  return 'general';
}

export function parseDebateRequest(inputMode?: string, rawModelOverride?: string, profile?: string): {
  requested: boolean;
  optOut: boolean;
  profile: DebateProfile;
  trigger: DebateTrigger;
  suppressModelOverride: boolean;
  overrideHeaderValue: string;
} {
  const p = normalizeDebateProfile(profile);
  const mode = String(inputMode || '').trim().toLowerCase();
  const raw = String(rawModelOverride || '').trim().toLowerCase();
  const prof = String(profile || '').trim().toLowerCase();

  // Explicit opt-out via mode="off", profile="off", or override="off" / "debate:off"
  const isOptOut = mode === 'off' || raw === 'off' || raw === 'debate:off' || prof === 'off';
  if (isOptOut) {
    return {
      requested: false,
      optOut: true,
      profile: p,
      trigger: 'off',
      suppressModelOverride: raw === 'off' || raw === 'debate:off',
      overrideHeaderValue: '',
    };
  }

  // Explicit via body.mode = "debate"
  if (mode === 'debate') {
    return {
      requested: true,
      optOut: false,
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
      optOut: false,
      profile: pp,
      trigger: 'explicit',
      suppressModelOverride: true,
      overrideHeaderValue: `debate:${pp}`,
    };
  }

  return {
    requested: false,
    optOut: false,
    profile: p,
    trigger: 'off',
    suppressModelOverride: false,
    overrideHeaderValue: '',
  };
}

export function selectDebateWorkerMaxTokens(
  profile: DebateProfile,
  generalCap: number,
  codeCap: number,
  videoUiCap: number,
): number {
  if (profile === 'code') return codeCap;
  if (profile === 'video_ui') return videoUiCap;
  return generalCap;
}

export function computeDebateEligibility(params: {
  profile: DebateProfile;
  enableDebateMode: boolean;
  enableDebateAuto: boolean;
  debateRequested: boolean;
  debateOptOut?: boolean;
  hasImages: boolean;
  hasVideoAssets: boolean;
  complexityScore: number;
  threshold: number;
}): {
  hasAnyMedia: boolean;
  shouldAutoDebate: boolean;
  doDebate: boolean;
  trigger: DebateTrigger;
} {
  const hasAnyMedia = params.hasImages || params.hasVideoAssets;

  if (params.debateOptOut) {
    return { hasAnyMedia, shouldAutoDebate: false, doDebate: false, trigger: 'off' };
  }

  if (params.profile === 'video_ui') {
    const doDebate = params.enableDebateMode &&
      params.debateRequested &&
      params.hasVideoAssets &&
      !params.hasImages;
    const trigger: DebateTrigger = params.debateRequested ? 'explicit' : 'off';
    return { hasAnyMedia, shouldAutoDebate: false, doDebate, trigger };
  }

  const shouldAutoDebate = params.enableDebateMode &&
    params.enableDebateAuto &&
    !params.debateRequested &&
    !hasAnyMedia &&
    params.complexityScore >= params.threshold;
  const doDebate = params.enableDebateMode &&
    (params.debateRequested || shouldAutoDebate) &&
    !hasAnyMedia;
  const trigger: DebateTrigger = params.debateRequested
    ? 'explicit'
    : shouldAutoDebate
    ? 'auto'
    : 'off';
  return { hasAnyMedia, shouldAutoDebate, doDebate, trigger };
}

export function buildDebateHeaders(params: {
  debateActive: boolean;
  debateProfile: DebateProfile;
  debateTrigger: DebateTrigger;
  debateModelTier?: string;
  costNote?: 'full' | 'partial';
}): Record<string, string> {
  if (!params.debateActive) return {};
  return {
    'X-Debate-Mode': 'true',
    'X-Debate-Profile': params.debateProfile,
    'X-Debate-Trigger': params.debateTrigger,
    ...(params.debateModelTier ? { 'X-Debate-Model': params.debateModelTier } : {}),
    'X-Debate-Cost-Note': params.costNote ?? 'full',
  };
}

export function serializeMessagesForCost(messages: Message[]): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n');
}

/**
 * Returns the ordered fallback sequence for a challenger.
 * Uses a role-aware cascade:
 *   - code critic role  → CODE_CRITIC_FALLBACKS
 *   - code implementer  → CODE_IMPLEMENTER_FALLBACKS
 *   - everything else   → GENERAL_CHALLENGER_FALLBACKS
 * Assigned tier is tried first; remaining cascade models follow in cost order.
 */
export function buildFallbackSequence(
  assignedTier: RouterModel,
  profile: DebateProfile = 'general',
  role = '',
): RouterModel[] {
  let cascade: RouterModel[];
  if (profile === 'code') {
    cascade = role === 'implementer' ? CODE_IMPLEMENTER_FALLBACKS : CODE_CRITIC_FALLBACKS;
  } else {
    cascade = GENERAL_CHALLENGER_FALLBACKS;
  }
  const rest = cascade.filter((t) => t !== assignedTier);
  return [assignedTier, ...rest];
}

export async function runDebateStageWithTimeout<T>(params: {
  parentSignal: AbortSignal;
  timeoutMs: number;
  run: (signal: AbortSignal) => Promise<T>;
}): Promise<T | null> {
  if (params.timeoutMs <= 0) {
    return await params.run(params.parentSignal);
  }

  const stageController = new AbortController();
  let timedOut = false;

  const onParentAbort = () => {
    stageController.abort();
  };
  params.parentSignal.addEventListener('abort', onParentAbort, { once: true });

  let tid: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<{ kind: 'timeout' }>((resolve) => {
    tid = setTimeout(() => {
      timedOut = true;
      stageController.abort();
      resolve({ kind: 'timeout' });
    }, params.timeoutMs);
  });

  const runPromise = params.run(stageController.signal)
    .then((value) => ({ kind: 'value' as const, value }))
    .catch((error) => ({ kind: 'error' as const, error }));

  try {
    const winner = await Promise.race([runPromise, timeoutPromise]);
    if (winner.kind === 'timeout') return null;
    if (winner.kind === 'error') {
      if (timedOut || stageController.signal.aborted) return null;
      throw winner.error;
    }
    return winner.value;
  } catch (error) {
    if (timedOut || stageController.signal.aborted) {
      return null;
    }
    throw error;
  } finally {
    if (tid) clearTimeout(tid);
    params.parentSignal.removeEventListener('abort', onParentAbort);
  }
}
