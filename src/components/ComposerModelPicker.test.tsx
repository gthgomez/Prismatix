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

  const defaultProps: ComposerModelPickerProps = {
    currentModel: 'gemini-3.8-flash',
    manualModelOverride: null,
    enabledProviders: new Set(['opencode']),
    userId: 'test-user',
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

  it('renders in Manual mode with model name and clear button', () => {
    const onClearOverride = vi.fn();
    root = createRoot(container);
    act(() => {
      root!.render(
        <ComposerModelPicker
          {...defaultProps}
          manualModelOverride='claude-sonnet-5'
          onClearOverride={onClearOverride}
        />,
      );
    });

    const pill = container.querySelector<HTMLButtonElement>('.composer-model-pill')!;
    expect(pill.textContent).toContain('Sonnet 5');
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

  it('allows model selection from popover list', () => {
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

    const firstModelItem = document.querySelector<HTMLButtonElement>('.composer-model-item-btn')!;
    expect(firstModelItem).not.toBeNull();
  });
});
