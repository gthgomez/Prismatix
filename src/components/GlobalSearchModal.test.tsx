// src/components/GlobalSearchModal.test.tsx
import React, { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalSearchModal } from './GlobalSearchModal';
import * as searchService from '../services/conversationSearch';
import type { SupabaseClient } from '@supabase/supabase-js';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../services/conversationSearch', () => ({
  searchChatHistory: vi.fn(),
  sanitizeSearchSnippet: (str: string) => str,
}));

function renderInto(container: HTMLElement, ui: ReactNode): Root {
  const root = createRoot(container);
  act(() => root.render(ui));
  return root;
}

async function flush(ms = 60): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;
  nativeInputValueSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('GlobalSearchModal', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  const mockClient = {} as SupabaseClient;
  const mockOnClose = vi.fn();
  const mockOnSelectResult = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    container.remove();
  });

  it('does not render dialog content when isOpen is false', () => {
    root = renderInto(
      container,
      <GlobalSearchModal
        client={mockClient}
        isOpen={false}
        onClose={mockOnClose}
        onSelectResult={mockOnSelectResult}
      />
    );
    expect(container.querySelector('.search-modal-container')).toBeNull();
  });

  it('renders input and modal dialog when isOpen is true', async () => {
    root = renderInto(
      container,
      <GlobalSearchModal
        client={mockClient}
        isOpen={true}
        onClose={mockOnClose}
        onSelectResult={mockOnSelectResult}
      />
    );
    await flush();

    const input = container.querySelector<HTMLInputElement>('.search-modal-input');
    expect(input).not.toBeNull();
    expect(input?.placeholder).toContain('Search messages and conversations');
  });

  it('triggers search on input and displays matching results', async () => {
    vi.mocked(searchService.searchChatHistory).mockResolvedValue([
      {
        conversationId: 'c1',
        conversationTitle: 'Budget Planning',
        messageId: 'm1',
        role: 'user',
        snippet: 'How to calculate quarterly taxes?',
        createdAt: '2026-11-07T00:00:00Z',
        matchType: 'message',
      },
    ]);

    root = renderInto(
      container,
      <GlobalSearchModal
        client={mockClient}
        isOpen={true}
        onClose={mockOnClose}
        onSelectResult={mockOnSelectResult}
      />
    );
    await flush();

    const input = container.querySelector<HTMLInputElement>('.search-modal-input');
    expect(input).not.toBeNull();

    act(() => {
      if (input) {
        setInputValue(input, 'quarterly');
      }
    });

    // Wait for debounce timer (200ms)
    await flush(300);

    expect(searchService.searchChatHistory).toHaveBeenCalled();
    const resultItem = container.querySelector('.search-result-item');
    expect(resultItem).not.toBeNull();
    expect(resultItem?.textContent).toContain('Budget Planning');
  });

  it('calls onSelectResult when clicking a result item', async () => {
    vi.mocked(searchService.searchChatHistory).mockResolvedValue([
      {
        conversationId: 'c1',
        conversationTitle: 'Project Apollo',
        messageId: 'm1',
        role: 'assistant',
        snippet: 'Apollo moon mission outline',
        createdAt: '2026-11-07T00:00:00Z',
        matchType: 'message',
      },
    ]);

    root = renderInto(
      container,
      <GlobalSearchModal
        client={mockClient}
        isOpen={true}
        onClose={mockOnClose}
        onSelectResult={mockOnSelectResult}
      />
    );
    await flush();

    const input = container.querySelector<HTMLInputElement>('.search-modal-input');
    act(() => {
      if (input) {
        setInputValue(input, 'Apollo');
      }
    });
    await flush(300);

    const resultItem = container.querySelector<HTMLButtonElement>('.search-result-item');
    expect(resultItem).not.toBeNull();

    act(() => {
      resultItem?.click();
    });

    expect(mockOnSelectResult).toHaveBeenCalledWith('c1', 'm1');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('closes on Escape key press', async () => {
    root = renderInto(
      container,
      <GlobalSearchModal
        client={mockClient}
        isOpen={true}
        onClose={mockOnClose}
        onSelectResult={mockOnSelectResult}
      />
    );
    await flush();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(mockOnClose).toHaveBeenCalled();
  });
});
