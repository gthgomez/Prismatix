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
  if (!provider?.hasKey || !(provider.userEnabled ?? provider.enabled) || provider.status === 'invalid_revoked') return null;
  if (!outcome.verified && provider.inventoryStatus === 'verified' && (provider.qualifiedModelCount ?? 0) > 0) return null;
  return outcome;
}
