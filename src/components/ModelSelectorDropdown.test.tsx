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
    preferences: {
      favoriteModels: ['claude-haiku-5-5' as const, 'gemini-3.8-flash' as const],
      hiddenModels: [],
      activeProviderFilter: 'all' as const,
      toggleFavorite: vi.fn(),
      toggleModelVisibility: vi.fn(),
      setModelVisible: vi.fn(),
      setProviderFilter: vi.fn(),
      isFavorite: vi.fn(() => true),
      isModelHidden: vi.fn(() => false),
    },
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

  it('keeps historic models collapsed until requested and selects them only manually', () => {
    localStorage.setItem('prismatix.modelSelector.activeTab', 'models');
    const props = makeProps({ currentModel: 'deepseek-v4-1-flash' });
    const container = document.createElement('div');
    roots.push(renderInto(container, <ModelSelectorDropdown {...props} />));
    expect(container.textContent).not.toContain('Gemini 2.5 Flash');
    const historicToggle = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.startsWith('Historic models'))!;
    act(() => historicToggle.click());
    const historicModel = Array.from(container.querySelectorAll('.model-option'))
      .find((button) => button.textContent?.includes('Gemini 2.5 Flash')) as HTMLButtonElement;
    expect(historicModel).toBeDefined();
    act(() => historicModel.click());
    expect(props.onModelSelect).toHaveBeenCalledWith('gemini-2.5-flash');
    expect(props.onClearOverride).not.toHaveBeenCalled();
  });

  it('filters searchable models and reports an empty result', () => {
    localStorage.setItem('prismatix.modelSelector.activeTab', 'models');
    const container = document.createElement('div');
    roots.push(renderInto(container, <ModelSelectorDropdown {...makeProps()} />));

    const search = container.querySelector<HTMLInputElement>('.model-search-input')!;
    expect(container.querySelectorAll('.model-option').length).toBeGreaterThan(0);
    const matchingModel = 'deepseek-v4-1-flash' as RouterModel;
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
