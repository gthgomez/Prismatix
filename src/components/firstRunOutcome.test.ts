import { describe, expect, it } from 'vitest';
import { reconcileFirstRunOutcome } from './firstRunOutcome';
import type { ProviderState } from '../types';

const enabledProvider: ProviderState = {
  id: 'openrouter', label: 'OpenRouter', enabled: true, hasKey: true,
  keyLast4: '0701', offeredByDefault: true, defaultProvider: true, status: 'enabled',
};

describe('reconcileFirstRunOutcome', () => {
  it('clears a previously verified notice when the saved provider is disabled or removed', () => {
    const verified = { message: 'Key saved and verified. You are ready to chat.', verified: true };
    expect(reconcileFirstRunOutcome(verified, { ...enabledProvider, enabled: false })).toBeNull();
    expect(reconcileFirstRunOutcome(verified, { ...enabledProvider, hasKey: false })).toBeNull();
  });

  it('does not upgrade an unverified notice from saved/enabled settings metadata alone', () => {
    const unverified = { message: 'Key saved, but could not be verified.', verified: false };
    expect(reconcileFirstRunOutcome(unverified, enabledProvider)).toBe(unverified);
  });

  it('does not call a key verified while its current provider status is unavailable', () => {
    const unverified = { message: 'Key saved, but could not be verified.', verified: false };
    expect(reconcileFirstRunOutcome(unverified, { ...enabledProvider, status: 'unavailable' })).toBe(unverified);
  });
});
