import type { ProviderState } from '../types';

export interface FirstRunOutcome {
  message: string;
  verified: boolean;
}

/** Keep the onboarding notice aligned with the provider's current key state. */
export function reconcileFirstRunOutcome(
  outcome: FirstRunOutcome | null,
  provider: ProviderState | undefined,
): FirstRunOutcome | null {
  if (!outcome) return null;
  if (!provider?.hasKey || !provider.enabled || provider.status === 'invalid_revoked') return null;

  if (provider.status === 'enabled' && !outcome.verified) {
    return { message: 'Key saved and verified. You are ready to chat.', verified: true };
  }
  if (provider.status !== 'enabled' && outcome.verified) {
    return {
      message: 'Key saved, but could not be verified. Check Provider Settings before chatting.',
      verified: false,
    };
  }
  return outcome;
}
