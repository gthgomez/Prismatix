// RouteExplanationList.test.tsx
// UI regression: the "why Auto picked this" explanation renders in an
// understandable way, including the unknown-price warning state.

import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { RouteExplanationList } from './RouteExplanationList';
import { buildRouteExplanationRows } from '../modelDisplay';
import type { Message } from '../types';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function renderInto(container: HTMLElement, ui: ReactNode): Root {
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return root;
}

const autoMsg = {
  routeInfo: {
    selection: 'auto' as const,
    role: 'economy' as const,
    modelTier: 'deepseek-v4-flash' as const,
    gateway: 'opencode' as const,
    reason: "Highest-ranked available model for role 'economy'.",
    fallbackUsed: false,
    attemptedModels: [],
    priceKnown: true,
  },
  cost: { estimatedUsd: 0.001234, pricingVersion: '2026-08-16-v7' },
} as Pick<Message, 'routeInfo' | 'cost'>;

const overrideMsg = {
  routeInfo: {
    selection: 'override' as const,
    modelTier: 'gpt-5.6-sol' as const,
    gateway: 'opencode' as const,
    reason: "Manually selected model 'gpt-5.6-sol'.",
    fallbackUsed: false,
    priceKnown: true,
  },
} as Pick<Message, 'routeInfo' | 'cost'>;

describe('RouteExplanationList (why Auto picked this)', () => {
  it('renders role, reason, gateway, fallback status and cost basis for an Auto route', () => {
    const container = document.createElement('div');
    const { rows } = buildRouteExplanationRows(autoMsg);
    const root = renderInto(
      container,
      <RouteExplanationList rows={rows} />,
    );

    const text = container.textContent ?? '';
    expect(container.querySelector('[data-testid="route-explanation"]')).not.toBeNull();
    expect(text).toContain('Auto routing');
    expect(text).toContain('Economy (cheapest)');
    expect(text).toContain('Highest-ranked available model');
    expect(text).toContain('OpenCode gateway');
    expect(text).toContain('No — first choice worked');
    expect(text).toContain('≈$0.001234');
    expect(text).toContain('2026-08-16-v7');

    act(() => root.unmount());
  });

  it('marks manual overrides as user-chosen, not Auto', () => {
    const container = document.createElement('div');
    const { rows } = buildRouteExplanationRows(overrideMsg);
    const root = renderInto(container, <RouteExplanationList rows={rows} />);

    const text = container.textContent ?? '';
    expect(text).toContain('Your manual pick');
    expect(text).not.toContain('Auto routing');

    act(() => root.unmount());
  });

  it('shows the fail-closed price warning when the price is unknown', () => {
    const container = document.createElement('div');
    const unknownMsg = {
      routeInfo: {
        selection: 'auto' as const,
        role: 'economy' as const,
        modelTier: 'deepseek-v4-flash' as const,
        gateway: 'opencode' as const,
        reason: "Highest-ranked available model for role 'economy'.",
        fallbackUsed: false,
        attemptedModels: [],
        priceKnown: false,
      },
      cost: { estimatedUsd: 0.001234, pricingVersion: '2026-08-16-v7' },
    } as Pick<Message, 'routeInfo' | 'cost'>;
    const { rows, priceWarning } = buildRouteExplanationRows(unknownMsg);
    expect(priceWarning).toContain('unknown');
    expect(priceWarning).toContain('fail-closed');

    const root = renderInto(
      container,
      <RouteExplanationList rows={rows} priceWarning={priceWarning} />,
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Auto blocked');

    act(() => root.unmount());
  });

  it('renders nothing for messages without route info (legacy messages degrade gracefully)', () => {
    const container = document.createElement('div');
    const { rows, priceWarning } = buildRouteExplanationRows({} as Pick<Message, 'routeInfo' | 'cost'>);
    expect(rows).toEqual([]);
    expect(priceWarning).toBeUndefined();

    const root = renderInto(
      container,
      <RouteExplanationList rows={rows} priceWarning={priceWarning} />,
    );
    expect(container.querySelector('[data-testid="route-explanation"]')).toBeNull();

    act(() => root.unmount());
  });
});
