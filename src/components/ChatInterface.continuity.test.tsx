// ChatInterface.continuity.test.tsx
// PX07 fix round 2: an in-flight conversation load must NOT apply its messages
// after the user starts a New Chat or the account changes (both cleared paths).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import type { User } from '@supabase/supabase-js';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/supabase', () => ({
  supabase: {
    // SpendTracker polls auth on mount; a no-session result makes it no-op.
    auth: { getSession: vi.fn(async () => ({ data: { session: null }, error: null })) },
  },
}));

vi.mock('../services/conversationService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/conversationService')>();
  return {
    ...actual,
    listConversations: vi.fn(async () => []),
    loadConversation: vi.fn(),
    signAttachment: vi.fn(async () => null),
    deleteConversation: vi.fn(async () => {}),
  };
});

import { ChatInterface } from './ChatInterface';
import { writeSelectedConversation } from '../services/conversationState';
import { loadConversation, signAttachment, type LoadedMessage } from '../services/conversationService';

const USER_A = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'a@example.test', user_metadata: {} } as User;
const USER_B = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'b@example.test', user_metadata: {} } as User;
const CONV_A = '33333333-3333-4333-8333-333333333333';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function loadedMessage(content: string): LoadedMessage {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    role: 'user',
    content,
    createdAt: '2026-10-01T00:00:00Z',
    attachments: [],
  };
}

function renderInto(container: HTMLElement, ui: ReactNode): Root {
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return root;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

let container: HTMLDivElement;
let root: Root | null = null;
const onSignOut = vi.fn(async () => {});

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  vi.mocked(loadConversation).mockReset();
  vi.mocked(signAttachment).mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container.remove();
  root = null;
  vi.restoreAllMocks();
});

describe('ChatInterface in-flight conversation load invalidation', () => {
  it('does not apply an in-flight load after New Chat clears the conversation', async () => {
    writeSelectedConversation(USER_A.id, CONV_A);
    const load = deferred<LoadedMessage[]>();
    vi.mocked(loadConversation).mockReturnValue(load.promise);

    root = renderInto(container, <ChatInterface user={USER_A} onSignOut={onSignOut} />);
    await flush();
    expect(loadConversation).toHaveBeenCalledWith(expect.anything(), CONV_A, { limit: 200 });

    // New Chat before A's load resolves.
    act(() => container.querySelector<HTMLButtonElement>('.conversation-new-button')!.click());

    // A's load now resolves with a message that must NOT be applied.
    await act(async () => {
      load.resolve([loadedMessage('A message from conversation A')]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent ?? '').not.toContain('A message from conversation A');
  });

  it('does not apply a prior account\'s in-flight load after an account change', async () => {
    writeSelectedConversation(USER_A.id, CONV_A);
    const load = deferred<LoadedMessage[]>();
    vi.mocked(loadConversation).mockReturnValue(load.promise);

    root = renderInto(container, <ChatInterface user={USER_A} onSignOut={onSignOut} />);
    await flush();
    expect(loadConversation).toHaveBeenCalledWith(expect.anything(), CONV_A, { limit: 200 });

    // Switch to account B (no stored selection) before A's load resolves.
    act(() => root!.render(<ChatInterface user={USER_B} onSignOut={onSignOut} />));
    await flush();

    await act(async () => {
      load.resolve([loadedMessage('A message from conversation A')]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent ?? '').not.toContain('A message from conversation A');
  });

  it('does not apply an in-flight load when New Chat is clicked while signAttachment is pending', async () => {
    writeSelectedConversation(USER_A.id, CONV_A);
    const sign = deferred<string | null>();
    vi.mocked(signAttachment).mockReturnValue(sign.promise);
    vi.mocked(loadConversation).mockResolvedValue([
      {
        id: '44444444-4444-4444-8444-444444444444',
        role: 'user',
        content: 'Image attachment message',
        createdAt: '2026-10-01T00:00:00Z',
        attachments: [
          {
            ordinal: 0,
            kind: 'image',
            storageRef: 'supabase://chat-uploads/u/img.png',
            videoAssetId: null,
            available: true,
          },
        ],
      },
    ]);

    root = renderInto(container, <ChatInterface user={USER_A} onSignOut={onSignOut} />);
    await flush();

    // User clicks New Chat while signAttachment is still pending
    act(() => container.querySelector<HTMLButtonElement>('.conversation-new-button')!.click());

    // signAttachment now resolves
    await act(async () => {
      sign.resolve('https://signed.example/img.png');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent ?? '').not.toContain('Image attachment message');
  });
});
