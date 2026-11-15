// src/providerSetupPresentation.ts
// One truthful label for a provider's key state. "Saved" and "verified" are
// different facts: the server only knows a key exists, while the client can
// remember the result of an explicit metadata check.

import type { ProviderState } from './types';
import type { ProviderVerification } from './hooks/useProviderPlugins';

export type ProviderStateTone = 'neutral' | 'checking' | 'success' | 'warning' | 'error';

export interface ProviderStatePresentation {
  label: string;
  detail?: string;
  tone: ProviderStateTone;
}

export function describeProviderState(
  provider: ProviderState,
  verification?: ProviderVerification,
): ProviderStatePresentation {
  if (verification?.state === 'checking') {
    return {
      label: 'Checking…',
      detail: verification.message ?? 'Contacting the provider metadata endpoint.',
      tone: 'checking',
    };
  }
  if (verification?.state === 'rejected') {
    return {
      label: 'Rejected by provider',
      detail: verification.message,
      tone: 'error',
    };
  }
  if (!provider.hasKey) {
    return { label: 'Not configured', tone: 'neutral' };
  }
  if (provider.status === 'invalid_revoked') {
    return {
      label: 'Rejected by provider',
      detail: provider.statusMessage,
      tone: 'error',
    };
  }
  if (verification?.state === 'verified') {
    return {
      label: provider.enabled ? 'Verified & enabled' : 'Verified · disabled',
      detail: verification.message,
      tone: 'success',
    };
  }
  if (verification?.state === 'unverified') {
    return {
      label: provider.enabled ? 'Saved · not verified' : 'Saved · disabled · not verified',
      detail: verification.message,
      tone: 'warning',
    };
  }
  return {
    label: provider.enabled ? 'Saved · verification unknown' : 'Saved · disabled',
    detail: 'Run Test to verify this key.',
    tone: 'warning',
  };
}

export function providerStateClass(tone: ProviderStateTone): string {
  if (tone === 'checking') return 'is-checking';
  if (tone === 'success') return 'is-on';
  if (tone === 'warning') return 'is-warning';
  if (tone === 'error') return 'is-error';
  return 'needs-setup';
}

export function describeProviderSettingsError(error?: string | null): string {
  if (!error) return '';
  if (/byok_unavailable/i.test(error)) {
    return 'The server cannot store provider keys right now. Retry; if it persists, the deployment is missing its encryption key.';
  }
  if (/provider_settings_unavailable/i.test(error)) {
    return 'Provider settings are not configured for this deployment.';
  }
  if (/unauthorized|invalid or expired token|401/i.test(error)) {
    return 'Your session expired. Sign in again.';
  }
  if (/timeout|abort|network|fetch/i.test(error)) {
    return 'Provider settings could not be reached. Check your connection and retry.';
  }
  return 'Provider settings are temporarily unavailable. Retry to check again.';
}
