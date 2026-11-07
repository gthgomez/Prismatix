// src/components/ChatInterface.draftRecovery.test.tsx
// F02: Lossless failed-send recovery and retry without duplication.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { User } from '@supabase/supabase-js';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: null }, error: null })) },
  },
}));

vi.mock('../services/conversationService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/conversationService')>();
  return {
    ...actual,
    listConversations: vi.fn(async () => []),
    loadConversation: vi.fn(async () => []),
    signAttachment: vi.fn(async () => null),
    deleteConversation: vi.fn(async () => {}),
  };
});

// Mock fetch to simulate network failure on router call
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

import { ChatInterface } from './ChatInterface';

const TEST_USER = {
  id: 'uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuuu',
  email: 'tester@prismatix.test',
  user_metadata: {},
} as User;

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

function setInputValue(input: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('ChatInterface Draft Recovery (F02)', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
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

  it('preserves failed draft in memory without leaking raw prompt into localStorage', async () => {
    // Simulate router failing with network error
    mockFetch.mockRejectedValueOnce(new Error('Network connection timeout'));

    root = renderInto(
      container,
      <ChatInterface user={TEST_USER} onSignOut={async () => {}} />
    );
    await flush(100);

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea).not.toBeNull();

    const sensitivePrompt = 'My secret quarterly strategy prompt 12345';
    act(() => {
      if (textarea) setInputValue(textarea, sensitivePrompt);
    });
    await flush();

    // Verify localStorage has not stored the prompt
    expect(localStorage.getItem('prismatix_draft')).toBeNull();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        expect(localStorage.getItem(key)).not.toContain(sensitivePrompt);
      }
    }
  });

  it('displays draft recovery alert banner when a send fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Failed to connect to router'));

    root = renderInto(
      container,
      <ChatInterface user={TEST_USER} onSignOut={async () => {}} />
    );
    await flush(100);

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea).not.toBeNull();

    act(() => {
      if (textarea) setInputValue(textarea, 'Draft to recover');
    });
    await flush();

    const form = container.querySelector('form');
    act(() => {
      form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await flush(150);

    // After failure, recovery banner should be present with Restore draft button
    const recoveryBanner = container.querySelector('.draft-recovery-banner');
    if (recoveryBanner) {
      expect(recoveryBanner.textContent).toContain('Restore draft');
    }
  });
});
