import { describe, expect, it } from 'vitest';
import {
  applyOpenRouterFallback,
  decisionFromModel,
} from '../../supabase/functions/router/provider_availability.ts';
import type { Provider } from '../../supabase/functions/router/router_logic.ts';

const OPENROUTER_ROUTE = 'anthropic/claude-sonnet-4.6';

function openRouterDecision() {
  return applyOpenRouterFallback(
    decisionFromModel('sonnet-4.6', 50, 'test'),
    () => false,
    true,
  );
}

describe('applyOpenRouterFallback', () => {
  it('keeps the decision when the native provider is ready', () => {
    const decision = decisionFromModel('sonnet-4.6', 50, 'test');
    const out = applyOpenRouterFallback(decision, (p: Provider) => p === 'anthropic', true);
    expect(out).toBe(decision);
    expect(out.provider).toBe('anthropic');
  });

  it('re-points an unavailable native model at its OpenRouter route', () => {
    const out = openRouterDecision();
    expect(out.provider).toBe('openrouter');
    expect(out.model).toBe(OPENROUTER_ROUTE);
    // The catalog tier is preserved for pricing/provenance.
    expect(out.modelTier).toBe('sonnet-4.6');
    expect(out.explanation?.gateway).toBe('direct_fallback');
    expect(out.explanation?.fallbackUsed).toBe(true);
    expect(out.explanation?.reason).toContain('OpenRouter');
  });

  it('keeps the native decision when OpenRouter is not ready', () => {
    const decision = decisionFromModel('sonnet-4.6', 50, 'test');
    const out = applyOpenRouterFallback(decision, () => false, false);
    expect(out).toBe(decision);
    expect(out.provider).toBe('anthropic');
  });

  it('keeps the native decision when the model has no OpenRouter route', () => {
    // opencode models are not in OPENROUTER_MODEL_MAP.
    const decision = decisionFromModel('deepseek-v4-1-flash', 50, 'test');
    const out = applyOpenRouterFallback(decision, () => false, true);
    expect(out).toBe(decision);
    expect(out.provider).toBe('opencode');
  });

  it('is idempotent for a decision already routed via OpenRouter', () => {
    const routed = openRouterDecision();
    const out = applyOpenRouterFallback(routed, () => false, true);
    expect(out).toBe(routed);
  });
});
