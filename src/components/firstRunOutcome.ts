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

  // GET settings status describes whether the key is saved and enabled. It is
  // not evidence that the provider accepted the key; only validate_key can
  // move an unverified key to the ready state.
  return outcome;
}
