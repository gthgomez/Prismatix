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
    enabled: false,
    hasKey,
    keyLast4: null,
    offeredByDefault: false,
    defaultProvider: false,
  };
}

function makePlugins(provider: ProviderState): ProviderPlugins {
  return {
    providers: [provider],
    routes: [],
    defaultProvider: 'openrouter',
    enabledProviders: new Set(['openrouter']),
    isConfigured: true,
    isVerified: true,
    verificationStatus: 'verified',
    verificationLoading: false,
    verifyEnabledProviders: vi.fn(async () => true),
    invalidateVerification: vi.fn(),
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    setEnabled: vi.fn(async () => true),
    setKey: vi.fn(async () => ({ saved: true, verified: true, inventoryStatus: 'verified' as const, availableModelCount: 1, qualifiedModelCount: 1 })),
    removeKey: vi.fn(async () => true),
    refreshInventory: vi.fn(async () => true),
    setDefault: vi.fn(async () => true),
    validateKey: vi.fn(async () => ({ provider: 'openrouter' as const, status: 'enabled' as const })),
  };
}

function makePreferences(overrides = {}) {
  return {
    favoriteModels: ['claude-haiku-5-5' as const, 'gemini-3.8-flash' as const],
    hiddenModels: [],
    activeProviderFilter: 'all' as const,
    toggleFavorite: vi.fn(),
    toggleModelVisibility: vi.fn(),
    setModelVisible: vi.fn(),
    setProviderFilter: vi.fn(),
    isFavorite: vi.fn((m) => ['claude-haiku-5-5', 'gemini-3.8-flash'].includes(m)),
    isModelHidden: vi.fn(() => false),
    ...overrides,
  };
}

describe('ProviderSettings', () => {
  const roots: Root[] = [];
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  afterEach(() => {
    roots.splice(0).forEach((root) => act(() => root.unmount()));
  });

  it('allows connecting OpenCode Zen as an account provider', () => {
    const container = document.createElement('div');
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
    const note = document.body.querySelector('.provider-card-note')?.textContent ?? '';
    expect(note).toContain('No verified model inventory');
    expect(document.body.querySelector('[role="switch"]')).not.toBeNull();
    expect(document.body.querySelector('[aria-label="OpenCode Zen API key"]')).not.toBeNull();
    act(() => roots.pop()!.unmount());
  });

  it('explains when a saved provider key cannot be checked rather than claiming verification', async () => {
    const provider: ProviderState = { ...makeProvider(true), id: 'nvidia', label: 'NVIDIA', enabled: true };
    const plugins = makePlugins(provider);
    plugins.validateKey = vi.fn(async () => ({
      provider: 'nvidia' as const,
      status: 'unknown' as const,
      message: 'A metadata verification check is not available in Prismatix for this provider.',
    }));
    const container = document.createElement('div');
    document.body.append(container);
    roots.push(renderInto(container, <ProviderSettings plugins={plugins} preferences={makePreferences()} onClose={vi.fn()} />));

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[aria-label="Test connection for NVIDIA"]')!.click();
    });
    expect(document.body.querySelector('.provider-settings-notice')?.textContent)
      .toContain('A metadata verification check is not available in Prismatix for this provider.');
    expect(document.body.textContent).not.toContain('Saved key verified.');
    container.remove();
  });

  it('does not display unknown validation messages from an older backend', async () => {
    const provider: ProviderState = { ...makeProvider(true), id: 'openrouter', label: 'OpenRouter', enabled: true };
    const plugins = makePlugins(provider);
    plugins.validateKey = vi.fn(async () => ({
      provider: 'openrouter' as const,
      status: 'unknown' as const,
      message: 'Unexpected upstream error with synthetic-private-key',
    }));
    const container = document.createElement('div');
    document.body.append(container);
    roots.push(renderInto(container, <ProviderSettings plugins={plugins} preferences={makePreferences()} onClose={vi.fn()} />));

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[aria-label="Test connection for OpenRouter"]')!.click();
    });
    expect(document.body.querySelector('.provider-settings-notice')?.textContent).toContain('Verification was inconclusive.');
    expect(document.body.textContent).not.toContain('synthetic-private-key');
    container.remove();
  });

  it('does not display older backend error details after saving a key', async () => {
    const provider: ProviderState = { ...makeProvider(false), id: 'openrouter', label: 'OpenRouter' };
    const plugins = makePlugins(provider);
    plugins.validateKey = vi.fn(async () => ({
      provider: 'openrouter' as const,
      status: 'unknown' as const,
      message: 'Unexpected upstream error with synthetic-private-key',
    }));
    const container = document.createElement('div');
    document.body.append(container);
    roots.push(renderInto(container, <ProviderSettings plugins={plugins} preferences={makePreferences()} onClose={vi.fn()} />));

    const input = document.body.querySelector<HTMLInputElement>('[aria-label="OpenRouter API key"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'sk-synthetic-key');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { document.body.querySelector<HTMLButtonElement>('.provider-key-save')!.click(); });
    expect(plugins.setKey).toHaveBeenCalled();
    expect(document.body.querySelector('.provider-settings-notice')?.textContent).toContain('Key saved and verified. 1 models are ready.');
    expect(document.body.querySelector('.provider-settings-notice')?.textContent).not.toContain('synthetic-private-key');
    container.remove();
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

    const toggleBtn = document.body.querySelector<HTMLButtonElement>('.provider-models-toggle')!;
    expect(toggleBtn).not.toBeNull();
    act(() => toggleBtn.click());

    // Check models list rendered
    const modelsList = document.body.querySelector('.provider-models-list');
    expect(modelsList).not.toBeNull();

    // Check visibility toggle
    const checkbox = document.body.querySelector<HTMLInputElement>('.provider-model-checkbox')!;
    expect(checkbox).not.toBeNull();
    act(() => checkbox.click());
    expect(prefs.setModelVisible).toHaveBeenCalled();

    // Check favorite toggle
    const starBtn = document.body.querySelector<HTMLButtonElement>('.provider-model-star')!;
    expect(starBtn).not.toBeNull();
    act(() => starBtn.click());
    expect(prefs.toggleFavorite).toHaveBeenCalled();

    act(() => roots.pop()!.unmount());
    container.remove();
  });
});
