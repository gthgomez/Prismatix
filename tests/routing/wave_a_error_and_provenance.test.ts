import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signOut: vi.fn(),
    },
  },
}));

import { RouterApiError, DuplicateRequestError } from '../../src/smartFetch';
import { describeStreamError } from '../../src/components/ChatInterface';
import { buildRouteExplanationRows } from '../../src/modelDisplay';
import type { Message } from '../../src/types';

describe('Wave A — Error messaging and retry-after preservation', () => {
  it('maps 401 unauthorized to session expiration guidance', () => {
    const err = new RouterApiError(401, 'unauthorized', 'Invalid JWT');
    const msg = describeStreamError(err);
    expect(msg).toContain('Session expired. Please sign in again.');
  });

  it('preserves retry-after seconds for 402 budget exhaustion', () => {
    const err = new RouterApiError(402, 'budget_exhausted', 'Daily budget exceeded', {
      retryAfterSeconds: 3600,
    });
    const msg = describeStreamError(err);
    expect(msg).toContain('Usage allowance reached');
    expect(msg).toContain('3600 seconds');
    expect(msg).toContain('spend settings');
  });

  it('preserves retry-after seconds for 429 rate limit errors', () => {
    const err = new RouterApiError(429, 'rate_limit_exceeded', 'Rate limit hit', {
      retryAfterSeconds: 45,
    });
    const msg = describeStreamError(err);
    expect(msg).toContain('Rate limit exceeded');
    expect(msg).toContain('45 seconds');
  });

  it('provides actionable guidance when no provider is available (503)', () => {
    const err = new RouterApiError(503, 'no_available_provider', 'No provider configured');
    const msg = describeStreamError(err);
    expect(msg).toContain('Provider Settings');
    expect(msg).toContain('enable a provider');
  });

  it('explains fail-closed cost safety on unknown pricing (503)', () => {
    const err = new RouterApiError(503, 'unknown_pricing', 'Pricing unknown');
    const msg = describeStreamError(err);
    expect(msg).toContain('Pricing for this model is unknown');
    expect(msg).toContain('blocked for cost safety');
  });

  it('guides user cleanly on duplicate requests (409)', () => {
    const err = new DuplicateRequestError('ex-dup-1');
    const msg = describeStreamError(err);
    expect(msg).toContain('That exact request was already sent just now');
    expect(msg).toContain('Edit your message slightly');
  });

  it('explains interrupted stream without claiming completion', () => {
    const err = new RouterApiError(500, 'stream_interrupted', 'Interrupted prematurely');
    const msg = describeStreamError(err);
    expect(msg).toContain('The connection closed prematurely');
    expect(msg).toContain('Partial output preserved');
  });
  it('maps active_limit to concurrency guidance with retry-after', () => {
    const err = new RouterApiError(429, 'active_limit', 'Concurrency limit hit', {
      retryAfterSeconds: 5,
    });
    const msg = describeStreamError(err);
    expect(msg).toContain('Another request is currently processing.');
    expect(msg).toContain('5 seconds');
  });

  it('maps rate_limited denial code to rate limit guidance', () => {
    const err = new RouterApiError(429, 'rate_limited', 'Too many requests', {
      retryAfterSeconds: 20,
    });
    const msg = describeStreamError(err);
    expect(msg).toContain('Rate limit exceeded');
    expect(msg).toContain('20 seconds');
  });
});

describe('Wave A — Provenance and Route Explanation', () => {
  it('omits Fallback row when fallbackUsed is undefined on reloaded messages', () => {
    const message: Pick<Message, 'routeInfo' | 'cost'> = {
      routeInfo: {
        selection: 'auto',
        modelTier: 'gemini-3.8-flash',
        gateway: 'opencode',
        reason: 'economy_tier',
        // fallbackUsed is undefined (factual: not recorded in historical provenance)
        priceKnown: true,
      },
      cost: {
        estimatedUsd: 0.0001,
      },
    };

    const { rows } = buildRouteExplanationRows(message);
    const fallbackRow = rows.find((r) => r.label === 'Fallback');
    expect(fallbackRow).toBeUndefined(); // Must NOT claim "No — first choice worked"
    const gatewayRow = rows.find((r) => r.label === 'Gateway');
    expect(gatewayRow?.value).toBe('OpenCode gateway');
  });

  it('displays Fallback row truthfully when fallbackUsed is explicitly known', () => {
    const messageWithFallback: Pick<Message, 'routeInfo' | 'cost'> = {
      routeInfo: {
        selection: 'auto',
        modelTier: 'gemini-3.8-flash',
        gateway: 'direct_fallback',
        reason: 'opencode_unreachable',
        fallbackUsed: true,
        priceKnown: true,
      },
    };

    const { rows } = buildRouteExplanationRows(messageWithFallback);
    const fallbackRow = rows.find((r) => r.label === 'Fallback');
    expect(fallbackRow?.value).toContain('Yes');
  });

  it('surfaces price warning and suppresses numeric basis when priceKnown is false', () => {
    const message: Pick<Message, 'routeInfo' | 'cost'> = {
      routeInfo: {
        selection: 'auto',
        modelTier: 'gemini-3.8-flash',
        gateway: 'opencode',
        reason: 'uncalibrated',
        priceKnown: false,
      },
      cost: {
        estimatedUsd: 0.0001,
      },
    };

    const { rows, priceWarning } = buildRouteExplanationRows(message);
    expect(priceWarning).toContain('Pricing for this model is unknown');
    const costBasisRow = rows.find((r) => r.label === 'Est. cost basis');
    expect(costBasisRow).toBeUndefined();
  });

  it('supports OpenRouter gateway and omits gateway row when gateway is undefined', () => {
    const openRouterMsg: Pick<Message, 'routeInfo' | 'cost'> = {
      routeInfo: {
        selection: 'auto',
        modelTier: 'claude-sonnet-5',
        gateway: 'openrouter',
        reason: 'balanced_tier',
      },
    };
    const { rows: orRows } = buildRouteExplanationRows(openRouterMsg);
    expect(orRows.find((r) => r.label === 'Gateway')?.value).toBe('OpenRouter gateway');

    const unknownGatewayMsg: Pick<Message, 'routeInfo' | 'cost'> = {
      routeInfo: {
        selection: 'auto',
        modelTier: 'gemini-3.8-flash',
        reason: 'legacy_turn',
        // gateway undefined
      },
    };
    const { rows: ugRows } = buildRouteExplanationRows(unknownGatewayMsg);
    expect(ugRows.find((r) => r.label === 'Gateway')).toBeUndefined();
  });
});
