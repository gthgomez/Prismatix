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

describe('ProviderSettings', () => {
  const roots: Root[] = [];
  afterEach(() => {
    roots.splice(0).forEach((root) => act(() => root.unmount()));
  });

  it('describes deployment-provided credentials only when configured', () => {
    for (const hasKey of [true, false]) {
      const container = document.createElement('div');
      roots.push(
        renderInto(container, <ProviderSettings plugins={makePlugins(makeProvider(hasKey))} onClose={vi.fn()} />),
      );
      const note = container.querySelector('.provider-card-note')?.textContent ?? '';
      expect(note).toContain(hasKey ? 'Server key configured' : 'No server key is configured');
      expect(note).not.toContain('always available');
      expect(container.querySelector('.provider-badge:not(.provider-badge--default)')?.textContent)
        .toBe(hasKey ? 'Server key set' : 'No server key');
      act(() => roots.pop()!.unmount());
    }
  });
});
