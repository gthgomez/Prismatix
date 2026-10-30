import { describe, expect, it } from 'vitest';
import { resolveProductionRoute } from '../../supabase/functions/router/production_routing.ts';
import {
  applyOpenRouterFallback,
  normalizeDecisionAgainstProviderAvailability,
} from '../../supabase/functions/router/provider_availability.ts';
import { createProviderResolver } from '../../supabase/functions/router/provider_resolver.ts';
import type { RouterParams } from '../../supabase/functions/router/router_logic.ts';
import type { RawUserProviderConfig } from '../../supabase/functions/_shared/provider_registry.ts';

const PARAMS: RouterParams = {
  userQuery: 'hi',
  currentSessionTokens: 0,
  platform: 'web',
  history: [],
};

function resolver(config: RawUserProviderConfig | null) {
  return createProviderResolver(config, {
    globalEnabled: () => true,
    fetchUserKey: async () => 'fake-user-byok-key',
  });
}

describe('auto-routing provider gating', () => {
  it('keeps the decision when the decided provider is enabled', async () => {
    const r = resolver(
      { default_provider: 'openrouter', providers: [{ provider: 'google', enabled: true, has_key: true }] },
    );

    const decided = await resolveProductionRoute(PARAMS, undefined, { openCodePrimary: false });
    const { decision, error } = normalizeDecisionAgainstProviderAvailability(
      decided,
      undefined,
      (p) => r.isReady(p),
    );

    expect(error).toBeUndefined();
    expect(decision.provider).toBe('google');
  });

  it('allows the current cheaper Haiku fallback only when Anthropic is enabled', async () => {
    // Only anthropic is enabled; the decided model is the cheaper google tier.
    // The guard must NOT silently substitute a pricier provider.
    const r = resolver(
      { default_provider: 'openrouter', providers: [{ provider: 'anthropic', enabled: true, has_key: true }] },
    );

    const decided = await resolveProductionRoute(PARAMS, undefined, { openCodePrimary: false });
    const { decision, error } = normalizeDecisionAgainstProviderAvailability(
      decided,
      undefined,
      (p) => r.isReady(p),
    );

    expect(error).toBeUndefined();
    expect(decision.provider).toBe('anthropic');
    expect(decision.modelTier).toBe('claude-haiku-5-5');
  });

  it('fails closed when a manual pick targets a disabled provider', async () => {
    const r = resolver(
      { default_provider: 'openrouter', providers: [{ provider: 'anthropic', enabled: true, has_key: true }] },
    );

    const decided = await resolveProductionRoute(PARAMS, 'gemini-2.5-flash', { openCodePrimary: false });
    const { error } = normalizeDecisionAgainstProviderAvailability(
      decided,
      'gemini-2.5-flash',
      (p) => r.isReady(p),
    );
    expect(error).toBeTruthy();
    expect(error).toContain('gemini-2.5-flash');
  });

  it('unlocks a disabled native model through OpenRouter when it is enabled', async () => {
    const r = resolver(
      { default_provider: 'openrouter', providers: [{ provider: 'openrouter', enabled: true, has_key: true }] },
    );

    const decided = await resolveProductionRoute(PARAMS, 'sonnet-4.6', { openCodePrimary: false });
    expect(decided.provider).toBe('anthropic');

    const routed = applyOpenRouterFallback(
      decided,
      (p) => r.isReady(p),
      r.isReady('openrouter'),
    );
    expect(routed.provider).toBe('openrouter');
    expect(routed.model).toBe('anthropic/claude-sonnet-4.6');
  });
});
