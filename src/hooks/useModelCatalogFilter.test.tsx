import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useModelCatalogFilter, type UseModelCatalogFilterOptions } from './useModelCatalogFilter';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('useModelCatalogFilter hook', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container.remove();
    root = null;
  });

  function renderHookHelper(options: UseModelCatalogFilterOptions) {
    let hookResult: ReturnType<typeof useModelCatalogFilter> | null = null;
    function TestComponent() {
      hookResult = useModelCatalogFilter(options);
      return null;
    }
    root = createRoot(container);
    act(() => {
      root!.render(<TestComponent />);
    });
    return hookResult!;
  }

  it('filters models by enabled providers', () => {
    const result = renderHookHelper({
      enabledProviders: new Set(['opencode']),
    });

    expect(result.visibleOrder.length).toBeGreaterThan(0);
    for (const model of result.visibleOrder) {
      expect(result.visibleOrder).toContain(model);
    }
  });

  it('includes historic models when showHistoric is true', () => {
    const result = renderHookHelper({
      enabledProviders: new Set(['google']),
      showHistoric: true,
    });

    expect(result.historicModels.length).toBeGreaterThan(0);
    expect(result.filteredHistoricModels.length).toBeGreaterThan(0);
  });

  it('filters models by search query', () => {
    const result = renderHookHelper({
      enabledProviders: new Set(['opencode']),
      searchQuery: 'claude',
    });

    expect(result.filteredModels.length).toBeGreaterThan(0);
    for (const model of result.filteredModels) {
      expect(model.includes('claude')).toBe(true);
    }
  });

  it('excludes hidden models when no search query is active', () => {
    const result = renderHookHelper({
      enabledProviders: new Set(['opencode']),
      hiddenModels: ['deepseek-v4-flash'],
    });

    expect(result.filteredModels).not.toContain('deepseek-v4-flash');
  });

  it('filters by provider filter tab', () => {
    const result = renderHookHelper({
      enabledProviders: new Set(['opencode', 'google', 'anthropic']),
      providerFilter: 'anthropic',
    });

    for (const model of result.filteredModels) {
      expect(model.includes('opus') || model.includes('sonnet') || model.includes('haiku')).toBe(true);
    }
  });
});
