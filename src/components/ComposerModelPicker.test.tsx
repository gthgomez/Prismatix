// src/components/ComposerModelPicker.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ComposerModelPicker, type ComposerModelPickerProps } from './ComposerModelPicker';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe('ComposerModelPicker component', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    localStorage.clear();
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container.remove();
    root = null;
    vi.restoreAllMocks();
  });

  const mockPreferences = {
    favoriteModels: ['claude-haiku-5-5' as const, 'gemini-3.8-flash' as const],
    hiddenModels: [],
    activeProviderFilter: 'all' as const,
    toggleFavorite: vi.fn(),
    toggleModelVisibility: vi.fn(),
    setModelVisible: vi.fn(),
    setProviderFilter: vi.fn(),
    isFavorite: vi.fn((m) => ['claude-haiku-5-5', 'gemini-3.8-flash'].includes(m)),
    isModelHidden: vi.fn(() => false),
  };

  const defaultProps: ComposerModelPickerProps = {
    currentModel: 'gemini-3.8-flash',
    manualModelOverride: null,
    enabledProviders: new Set(['opencode']),
    preferences: mockPreferences,
    onModelSelect: vi.fn(),
    onClearOverride: vi.fn(),
    onOpenProviderSettings: vi.fn(),
  };

  it('renders in Auto mode with trigger pill', () => {
    root = createRoot(container);
    act(() => {
      root!.render(<ComposerModelPicker {...defaultProps} />);
    });

    const pill = container.querySelector<HTMLButtonElement>('.composer-model-pill')!;
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain('Auto Router');
    expect(pill.textContent).toContain('Auto');
  });

  it('shows exact account route IDs in its model list', () => {
    root = createRoot(container);
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 412 });
    act(() => root!.render(<ComposerModelPicker {...defaultProps} routes={[{
      id: 'openai:gpt-4.1', provider: 'openai', upstreamId: 'gpt-4.1', canonicalId: 'gpt-4.1',
      developer: 'OpenAI', name: 'GPT-4.1 (OpenAI)', protocol: 'responses', contextWindow: 1000,
      maxOutputTokens: 100, supportsImages: true, supportsTools: true, supportsReasoning: false,
      tariff: { version: 'test', source: 'test', inputPerMillion: 1, outputPerMillion: 2, billing: 'pay_as_you_go' },
    }]} />));
    act(() => container.querySelector<HTMLButtonElement>('.composer-model-pill')!.click());
    expect(document.body.querySelector<HTMLElement>('.composer-model-popover')?.style.getPropertyValue('--popover-width')).toBe('380px');
    expect(document.body.textContent).toContain('GPT-4.1 (OpenAI)');
    expect(document.body.textContent).toContain('openai:gpt-4.1');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
  });

  it('renders in Manual mode with model name and clear button', () => {
    const onClearOverride = vi.fn();
    root = createRoot(container);
    act(() => {
      root!.render(
        <ComposerModelPicker
          {...defaultProps}
          manualModelOverride='claude-haiku-5-5'
          onClearOverride={onClearOverride}
        />,
      );
    });

    const pill = container.querySelector<HTMLButtonElement>('.composer-model-pill')!;
    expect(pill.textContent).toContain('Haiku 5.5');
    expect(pill.textContent).toContain('Manual');

    const clearBtn = container.querySelector<HTMLButtonElement>('.composer-pill-clear-btn')!;
    expect(clearBtn).not.toBeNull();
    act(() => {
      clearBtn.click();
    });
    expect(onClearOverride).toHaveBeenCalled();
  });

  it('opens portal popover when trigger pill is clicked', () => {
    root = createRoot(container);
    act(() => {
      root!.render(<ComposerModelPicker {...defaultProps} />);
    });

    const pill = container.querySelector<HTMLButtonElement>('.composer-model-pill')!;
    act(() => {
      pill.click();
    });

    const popover = document.querySelector('.composer-model-popover');
    expect(popover).not.toBeNull();
    expect(popover?.textContent).toContain('Routing Intelligence');
    expect(popover?.textContent).toContain('Prismatix Smart Router');
  });

  it('allows model selection and favorite toggling from popover list', () => {
    const onModelSelect = vi.fn();
    root = createRoot(container);
    act(() => {
      root!.render(
        <ComposerModelPicker
          {...defaultProps}
          onModelSelect={onModelSelect}
        />,
      );
    });

    const pill = container.querySelector<HTMLButtonElement>('.composer-model-pill')!;
    act(() => {
      pill.click();
    });

    const modelSelectBtn = document.querySelector<HTMLButtonElement>(
      '.composer-model-item .composer-model-item-btn',
    )!;
    expect(modelSelectBtn).not.toBeNull();
    act(() => {
      modelSelectBtn.click();
    });
    expect(onModelSelect).toHaveBeenCalled();

    // Reopen popover and test star pin button
    act(() => {
      pill.click();
    });
    const starBtn = document.querySelector<HTMLButtonElement>('.composer-model-fav-btn')!;
    expect(starBtn).not.toBeNull();
    act(() => {
      starBtn.click();
    });
    expect(mockPreferences.toggleFavorite).toHaveBeenCalled();
  });
});
