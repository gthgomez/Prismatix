// ConversationSidebar.test.tsx
// PX07: the sidebar lists conversations and wires select / New Chat / Delete.

import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { ConversationSidebar } from './ConversationSidebar';
import type { ConversationSummary } from '../services/conversationService';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function renderInto(container: HTMLElement, ui: ReactNode): Root {
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return root;
}

const CONVERSATIONS: ConversationSummary[] = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'First chat', lastActivityAt: '2026-10-01T00:00:00Z' },
  { id: '22222222-2222-4222-8222-222222222222', title: null, lastActivityAt: '2026-09-01T00:00:00Z' },
];

function noop() {}

describe('ConversationSidebar', () => {
  it('renders the conversation list with titles and activity, marking selection', () => {
    const container = document.createElement('div');
    const root = renderInto(
      container,
      <ConversationSidebar
        conversations={CONVERSATIONS}
        selectedId={CONVERSATIONS[0]!.id}
        isLoading={false}
        onSelect={noop}
        onNewChat={noop}
        onDelete={noop}
      />,
    );

    const text = container.textContent ?? '';
    expect(text).toContain('First chat');
    expect(text).toContain('Untitled conversation');
    expect(text).toContain('+ New Chat');

    const items = container.querySelectorAll('.conversation-item');
    expect(items).toHaveLength(2);
    expect(items[0]!.className).toContain('selected');
    expect(items[1]!.className).not.toContain('selected');

    act(() => root.unmount());
  });

  it('invokes onSelect with the clicked conversation id', () => {
    const onSelect = vi.fn();
    const container = document.createElement('div');
    const root = renderInto(
      container,
      <ConversationSidebar
        conversations={CONVERSATIONS}
        selectedId={null}
        isLoading={false}
        onSelect={onSelect}
        onNewChat={noop}
        onDelete={noop}
      />,
    );

    const buttons = container.querySelectorAll<HTMLButtonElement>('.conversation-item-button');
    act(() => buttons[1]!.click());
    expect(onSelect).toHaveBeenCalledWith(CONVERSATIONS[1]!.id);

    act(() => root.unmount());
  });

  it('invokes onNewChat and onDelete', () => {
    const onNewChat = vi.fn();
    const onDelete = vi.fn();
    const container = document.createElement('div');
    const root = renderInto(
      container,
      <ConversationSidebar
        conversations={CONVERSATIONS}
        selectedId={null}
        isLoading={false}
        onSelect={noop}
        onNewChat={onNewChat}
        onDelete={onDelete}
      />,
    );

    act(() => container.querySelector<HTMLButtonElement>('.conversation-new-button')!.click());
    expect(onNewChat).toHaveBeenCalledTimes(1);

    act(() => container.querySelectorAll<HTMLButtonElement>('.conversation-item-delete')[0]!.click());
    expect(onDelete).toHaveBeenCalledWith(CONVERSATIONS[0]!.id);

    act(() => root.unmount());
  });

  it('disables actions while a stream is in progress', () => {
    const container = document.createElement('div');
    const root = renderInto(
      container,
      <ConversationSidebar
        conversations={CONVERSATIONS}
        selectedId={null}
        isLoading={false}
        disabled
        onSelect={noop}
        onNewChat={noop}
        onDelete={noop}
      />,
    );

    expect(container.querySelector<HTMLButtonElement>('.conversation-new-button')!.disabled).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('.conversation-item-button')!.disabled,
    ).toBe(true);

    act(() => root.unmount());
  });

  it('shows the loading and empty states', () => {
    const container = document.createElement('div');
    const root = renderInto(
      container,
      <ConversationSidebar
        conversations={[]}
        selectedId={null}
        isLoading
        onSelect={noop}
        onNewChat={noop}
        onDelete={noop}
      />,
    );
    expect(container.textContent).toContain('Loading');

    act(() => root.render(
      <ConversationSidebar
        conversations={[]}
        selectedId={null}
        isLoading={false}
        onSelect={noop}
        onNewChat={noop}
        onDelete={noop}
      />,
    ));
    expect(container.textContent).toContain('No conversations yet');

    act(() => root.unmount());
  });

  it('renders open drawer class, close button, and backdrop when isOpen is true', () => {
    const onClose = vi.fn();
    const container = document.createElement('div');
    const root = renderInto(
      container,
      <ConversationSidebar
        conversations={CONVERSATIONS}
        selectedId={null}
        isLoading={false}
        isOpen
        onClose={onClose}
        onSelect={noop}
        onNewChat={noop}
        onDelete={noop}
      />,
    );

    expect(container.querySelector('.conversation-sidebar')?.className).toContain('open');
    const backdrop = container.querySelector<HTMLDivElement>('.conversation-sidebar-backdrop');
    expect(backdrop).not.toBeNull();
    const closeBtn = container.querySelector<HTMLButtonElement>('.conversation-sidebar-close');
    expect(closeBtn).not.toBeNull();

    act(() => closeBtn!.click());
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => backdrop!.click());
    expect(onClose).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
  });
});
