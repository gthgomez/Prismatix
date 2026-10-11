import React, { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCatalogEntry, MODEL_ORDER } from '../modelCatalog';
import { PROVIDER_PLUGIN_ORDER, type ProviderId } from '../providerRegistry';
import type { RouterModel } from '../types';
import { ModelSelectorDropdown } from './ModelSelectorDropdown';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function renderInto(container: HTMLElement, ui: ReactNode): Root {
  const root = createRoot(container);
  act(() => root.render(ui));
  return root;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  act(() => input.dispatchEvent(new Event('input', { bubbles: true })));
}

function makeProps(overrides: Partial<React.ComponentProps<typeof ModelSelectorDropdown>> = {}) {
  return {
    currentModel: MODEL_ORDER[0] as RouterModel,
    currentComplexity: 30,
    manualModelOverride: null,
    geminiFlashThinkingLevel: 'low' as const,
    debateSelection: 'off' as const,
    sendValidationError: null,
    enabledProviders: new Set<ProviderId>(PROVIDER_PLUGIN_ORDER),
    onModelSelect: vi.fn(),
    onClearOverride: vi.fn(),
    onGeminiThinkingChange: vi.fn(),
    onDebateChange: vi.fn(),
    onClearValidationError: vi.fn(),
    onOpenProviderSettings: vi.fn(),
    ...overrides,
  };
}

describe('ModelSelectorDropdown', () => {
  const roots: Root[] = [];
  afterEach(() => {
    roots.splice(0).forEach((root) => act(() => root.unmount()));
    localStorage.clear();
  });

  it('filters searchable models and reports an empty result', () => {
    localStorage.setItem('prismatix.modelSelector.activeTab', 'models');
    const container = document.createElement('div');
    roots.push(renderInto(container, <ModelSelectorDropdown {...makeProps()} />));

    const search = container.querySelector<HTMLInputElement>('.model-search-input')!;
    expect(container.querySelectorAll('.model-option').length).toBeGreaterThan(0);
    const matchingModel = MODEL_ORDER[0] as RouterModel;
    setInputValue(search, getCatalogEntry(matchingModel).shortName);
    expect(
      Array.from(container.querySelectorAll('.model-option')).some((option) =>
        option.textContent?.includes(getCatalogEntry(matchingModel).shortName),
      ),
    ).toBe(true);
    setInputValue(search, 'no-model-can-match-this');
    expect(container.querySelectorAll('.model-option')).toHaveLength(0);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('No models match');
  });

  it('explains automatic routing and marks an explicit override as selected', () => {
    localStorage.setItem('prismatix.modelSelector.activeTab', 'models');
    const model = MODEL_ORDER[0] as RouterModel;
    const container = document.createElement('div');
    const automaticRoot = renderInto(container, <ModelSelectorDropdown {...makeProps({ currentModel: model })} />);
    roots.push(automaticRoot);
    expect(container.textContent).toContain('Automatic routing · currently using');
    act(() => automaticRoot.unmount());
    roots.splice(roots.indexOf(automaticRoot), 1);

    roots.push(
      renderInto(
        container,
        <ModelSelectorDropdown {...makeProps({ currentModel: model, manualModelOverride: model })} />,
      ),
    );
    expect(container.textContent).toContain('Manual model:');
    expect(container.querySelector<HTMLButtonElement>('.model-option[aria-pressed="true"]'))
      .not.toBeNull();
  });
});
