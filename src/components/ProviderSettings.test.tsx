import React, { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderPlugins } from '../hooks/useProviderPlugins';
import type { ProviderState } from '../types';
import { ProviderSettings } from './ProviderSettings';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function renderInto(container: HTMLElement, ui: ReactNode): Root {
  const root = createRoot(container);
  act(() => root.render(ui));
  return root;
}

function makeProvider(hasKey: boolean): ProviderState {
  return {
    id: 'opencode',
    label: 'OpenCode',
    enabled: true,
    hasKey,
    keyLast4: null,
    offeredByDefault: true,
    defaultProvider: true,
  };
}

function makePlugins(provider: ProviderState): ProviderPlugins {
  return {
    providers: [provider],
    defaultProvider: 'opencode',
    enabledProviders: new Set(['opencode']),
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    setEnabled: vi.fn(async () => true),
    setKey: vi.fn(async () => true),
    removeKey: vi.fn(async () => true),
    setDefault: vi.fn(async () => true),
  };
}

function makePreferences(overrides = {}) {
  return {
    favoriteModels: ['claude-sonnet-5' as const, 'gemini-3.8-flash' as const],
    hiddenModels: [],
    activeProviderFilter: 'all' as const,
    toggleFavorite: vi.fn(),
    toggleModelVisibility: vi.fn(),
    setModelVisible: vi.fn(),
    setProviderFilter: vi.fn(),
    isFavorite: vi.fn((m) => ['claude-sonnet-5', 'gemini-3.8-flash'].includes(m)),
    isModelHidden: vi.fn(() => false),
    ...overrides,
  };
}

describe('ProviderSettings', () => {
  const roots: Root[] = [];
  afterEach(() => {
    roots.splice(0).forEach((root) => act(() => root.unmount()));
  });

  it('keeps reverse keyboard navigation inside the dialog from initial focus', () => {
    const container = document.createElement('div');
    document.body.append(container);
    roots.push(
      renderInto(
        container,
        <ProviderSettings
          plugins={makePlugins(makeProvider(true))}
          preferences={makePreferences()}
          onClose={vi.fn()}
        />,
      ),
    );
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(document.activeElement).toBe(dialog);
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    act(() => dialog.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    const focusables = container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const lastFocusable = focusables[focusables.length - 1];
    expect(document.activeElement).toBe(lastFocusable);
    act(() => roots.pop()!.unmount());
    container.remove();
  });

  it('describes deployment-provided credentials only when configured', () => {
    for (const hasKey of [true, false]) {
      const container = document.createElement('div');
      roots.push(
        renderInto(
          container,
          <ProviderSettings
            plugins={makePlugins(makeProvider(hasKey))}
            preferences={makePreferences()}
            onClose={vi.fn()}
          />,
        ),
      );
      const note = container.querySelector('.provider-card-note')?.textContent ?? '';
      expect(note).toContain(hasKey ? 'Server key configured' : 'No server key is configured');
      expect(note).not.toContain('always available');
      expect(container.querySelector('.provider-badge:not(.provider-badge--default)')?.textContent)
        .toBe(hasKey ? 'Server key set' : 'No server key');
      act(() => roots.pop()!.unmount());
    }
  });

  it('allows expanding provider models and toggling visibility and favorites', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const prefs = makePreferences();
    roots.push(
      renderInto(
        container,
        <ProviderSettings
          plugins={makePlugins(makeProvider(true))}
          preferences={prefs}
          onClose={vi.fn()}
        />,
      ),
    );

    const toggleBtn = container.querySelector<HTMLButtonElement>('.provider-models-toggle')!;
    expect(toggleBtn).not.toBeNull();
    act(() => toggleBtn.click());

    // Check models list rendered
    const modelsList = container.querySelector('.provider-models-list');
    expect(modelsList).not.toBeNull();

    // Check visibility toggle
    const checkbox = container.querySelector<HTMLInputElement>('.provider-model-checkbox')!;
    expect(checkbox).not.toBeNull();
    act(() => checkbox.click());
    expect(prefs.setModelVisible).toHaveBeenCalled();

    // Check favorite toggle
    const starBtn = container.querySelector<HTMLButtonElement>('.provider-model-star')!;
    expect(starBtn).not.toBeNull();
    act(() => starBtn.click());
    expect(prefs.toggleFavorite).toHaveBeenCalled();

    act(() => roots.pop()!.unmount());
    container.remove();
  });
});
