// ConversationSidebar.test.tsx
// PX07: the sidebar lists conversations and wires select / New Chat / Delete.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConversationSidebar } from './ConversationSidebar';
import type { ConversationSummary } from '../services/conversationService';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function setNativeValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

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
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

  it('moves focus into a mobile drawer and restores the trigger on close', () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    const container = document.createElement('div');
    const trigger = document.createElement('button');
    document.body.append(trigger, container);
    trigger.focus();
    const props = { conversations: CONVERSATIONS, selectedId: null, isLoading: false, onClose: noop, onSelect: noop, onNewChat: noop, onDelete: noop };
    const root = renderInto(container, <ConversationSidebar {...props} isOpen />);
    expect(container.querySelector('aside')?.contains(document.activeElement)).toBe(true);
    act(() => root.render(<ConversationSidebar {...props} isOpen={false} />));
    expect(document.activeElement).toBe(trigger);
    act(() => root.unmount());
    container.remove();
    trigger.remove();
    Object.defineProperty(window, 'innerWidth', { value: previousWidth, configurable: true });
  });

  it('keeps the row-density select inside the mobile tab cycle', () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 320, configurable: true });
    const container = document.createElement('div');
    document.body.append(container);
    const root = renderInto(container, <ConversationSidebar conversations={[]} selectedId={null} isLoading={false} isOpen onSelect={noop} onNewChat={noop} onDelete={noop} />);
    act(() => container.querySelector<HTMLButtonElement>('.conversation-display-toggle')!.click());
    const width = container.querySelector<HTMLInputElement>('[aria-label="Sidebar width"]')!;
    width.style.display = 'none';
    const density = container.querySelector<HTMLSelectElement>('[aria-label="Chat row density"]')!;
    density.focus();
    act(() => density.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(container.querySelector('.conversation-display-toggle'));
    act(() => root.unmount());
    container.remove();
    Object.defineProperty(window, 'innerWidth', { value: previousWidth, configurable: true });
  });

  it('closes the drawer on Escape without cancelling rename or an open actions menu', () => {
    const onClose = vi.fn();
    const onRename = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = renderInto(container, <ConversationSidebar conversations={CONVERSATIONS} selectedId={null} isLoading={false} isOpen onClose={onClose} onRename={onRename} onSelect={noop} onNewChat={noop} onDelete={noop} />);
    act(() => container.querySelector('aside')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(onClose).toHaveBeenCalledOnce();
    act(() => container.querySelector<HTMLButtonElement>('.conversation-actions-trigger')!.click());
    act(() => container.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(onClose).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="menu"]')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('.conversation-actions-trigger')!.click());
    act(() => container.querySelector<HTMLButtonElement>('.conversation-item-rename')!.click());
    const input = container.querySelector<HTMLInputElement>('.conversation-rename-input')!;
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(onRename).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    act(() => root.unmount());
    container.remove();
  });

  it('does not label a chat from two calendar days ago as Yesterday', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 13, 10));
    const container = document.createElement('div');
    const root = renderInto(container, <ConversationSidebar conversations={[{ id: 'old', title: 'Older chat', lastActivityAt: new Date(2026, 9, 11, 23).toISOString() }]} selectedId={null} isLoading={false} onSelect={noop} onNewChat={noop} onDelete={noop} />);
    expect(container.querySelector('.conversation-item-activity')?.textContent).not.toBe('Yesterday');
    act(() => root.unmount());
  });

  it('moves focus with arrow keys without opening another chat', () => {
    const onSelect = vi.fn();
    const container = document.createElement('div'); document.body.append(container);
    const root = renderInto(container, <ConversationSidebar conversations={CONVERSATIONS} selectedId={null} isLoading={false} onSelect={onSelect} onNewChat={noop} onDelete={noop} />);
    const buttons = container.querySelectorAll<HTMLButtonElement>('.conversation-item-button');
    buttons[0]!.focus();
    act(() => buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(buttons[1]);
    expect(onSelect).not.toHaveBeenCalled();
    act(() => root.unmount()); container.remove();
  });

  it('keeps destructive actions in a menu and returns focus on Escape', () => {
    const container = document.createElement('div'); document.body.append(container);
    const root = renderInto(container, <ConversationSidebar conversations={CONVERSATIONS} selectedId={null} isLoading={false} onRename={noop} onSelect={noop} onNewChat={noop} onDelete={noop} />);
    expect(container.querySelector('.conversation-item-delete')).toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>('.conversation-actions-trigger');
    expect(trigger).not.toBeNull();
    act(() => trigger!.click());
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    act(() => container.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    act(() => root.unmount()); container.remove();
  });

  it('closes an open actions menu when its trigger receives pointer focus before click', () => {
    const container = document.createElement('div'); document.body.append(container);
    const root = renderInto(container, <ConversationSidebar conversations={CONVERSATIONS} selectedId={null} isLoading={false} onRename={noop} onSelect={noop} onNewChat={noop} onDelete={noop} />);
    const trigger = container.querySelector<HTMLButtonElement>('.conversation-actions-trigger')!;
    act(() => trigger.click());
    expect(document.activeElement).toBe(container.querySelector('[role="menuitem"]'));
    // Native pointer clicks focus the trigger (and blur the menu) before click.
    act(() => trigger.focus());
    act(() => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[role="menu"]')).toBeNull();
    act(() => root.unmount()); container.remove();
  });

  it('isolates display preferences by account and clamps stored widths', () => {
    localStorage.setItem('prismatix:chat-list:user-a', JSON.stringify({ density: 'comfortable', width: 9999 }));
    const container = document.createElement('div');
    const props = { conversations: CONVERSATIONS, selectedId: null, isLoading: false, onSelect: noop, onNewChat: noop, onDelete: noop };
    const root = renderInto(container, <ConversationSidebar {...props} preferenceScope='user-a' />);
    expect(container.querySelector('aside')?.getAttribute('data-density')).toBe('comfortable');
    expect(container.querySelector('[role="separator"]')?.getAttribute('aria-valuenow')).toBe('360');
    act(() => root.render(<ConversationSidebar {...props} preferenceScope='user-b' />));
    expect(container.querySelector('aside')?.getAttribute('data-density')).toBe('compact');
    expect(container.querySelector('[role="separator"]')?.getAttribute('aria-valuenow')).toBe('296');
    act(() => root.unmount());
  });

  it('keeps the list usable when browser storage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const container = document.createElement('div');
    let root: Root | undefined;
    try {
      expect(() => { root = renderInto(container, <ConversationSidebar preferenceScope='user' conversations={CONVERSATIONS} selectedId={null} isLoading={false} onSelect={noop} onNewChat={noop} onDelete={noop} />); }).not.toThrow();
      expect(container.querySelector('aside')?.getAttribute('data-density')).toBe('compact');
    } finally { if (root) act(() => root!.unmount()); getItem.mockRestore(); }
  });

  it('persists keyboard resizing and density changes for the active account only', () => {
    const container = document.createElement('div');
    const props = { conversations: CONVERSATIONS, selectedId: null, isLoading: false, onSelect: noop, onNewChat: noop, onDelete: noop };
    const root = renderInto(container, <ConversationSidebar {...props} preferenceScope='user-a' />);
    act(() => container.querySelector('[role="separator"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    act(() => container.querySelector<HTMLButtonElement>('.conversation-display-toggle')!.click());
    const density = container.querySelector<HTMLSelectElement>('[aria-label="Chat row density"]')!;
    act(() => { density.value = 'comfortable'; density.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(JSON.parse(localStorage.getItem('prismatix:chat-list:user-a')!)).toEqual({ width: 306, density: 'comfortable' });
    act(() => root.render(<ConversationSidebar {...props} preferenceScope='user-b' />));
    expect(localStorage.getItem('prismatix:chat-list:user-b')).toBeNull();
    act(() => root.render(<ConversationSidebar {...props} preferenceScope='user-a' />));
    expect(container.querySelector('aside')?.getAttribute('data-density')).toBe('comfortable');
    expect(container.querySelector('[role="separator"]')?.getAttribute('aria-valuenow')).toBe('306');
    act(() => root.unmount());
  });

  it('cancels rename with Escape and dismisses a menu after an outside pointer event', () => {
    const onRename = vi.fn();
    const container = document.createElement('div'); document.body.append(container);
    const root = renderInto(container, <ConversationSidebar conversations={CONVERSATIONS} selectedId={null} isLoading={false} onRename={onRename} onSelect={noop} onNewChat={noop} onDelete={noop} />);
    act(() => container.querySelector<HTMLButtonElement>('.conversation-actions-trigger')!.click());
    act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('.conversation-actions-trigger')!.click());
    act(() => container.querySelector<HTMLButtonElement>('.conversation-item-rename')!.click());
    const input = container.querySelector<HTMLInputElement>('.conversation-rename-input')!;
    act(() => setNativeValue(input, 'Discard this rename'));
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(onRename).not.toHaveBeenCalled();
    expect(container.querySelector('.conversation-rename-input')).toBeNull();
    act(() => root.unmount()); container.remove();
  });
  it('groups chats by local calendar day while preserving selection order', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 13, 12));
    const container = document.createElement('div');
    const root = renderInto(container, <ConversationSidebar conversations={[
      { id: 'today', title: 'Today chat', lastActivityAt: new Date(2026, 9, 13, 1).toISOString() },
      { id: 'yesterday', title: 'Yesterday chat', lastActivityAt: new Date(2026, 9, 12, 23).toISOString() },
      { id: 'older', title: 'Older chat', lastActivityAt: new Date(2026, 9, 10, 12).toISOString() },
    ]} selectedId='today' isLoading={false} onSelect={noop} onNewChat={noop} onDelete={noop} />);
    expect(Array.from(container.querySelectorAll('.conversation-group-heading')).map(node => node.textContent)).toEqual(['Today', 'Yesterday', 'Last 7 days']);
    act(() => root.unmount());
    vi.useRealTimers();
  });
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

    act(() => container.querySelector<HTMLButtonElement>('.conversation-actions-trigger')!.click());
    const deleteBtn = container.querySelector<HTMLButtonElement>('.conversation-item-delete')!;
    // First click: prompts for confirmation, does not delete yet
    act(() => deleteBtn.click());
    expect(deleteBtn.textContent).toBe('Confirm delete?');
    expect(deleteBtn.classList.contains('confirm')).toBe(true);
    expect(onDelete).not.toHaveBeenCalled();

    // Second click: commits deletion
    act(() => deleteBtn.click());
    expect(onDelete).toHaveBeenCalledWith(CONVERSATIONS[0]!.id);

    act(() => root.unmount());
  });

  it('resets delete confirmation when menu is closed with Escape', () => {
    const onDelete = vi.fn();
    const container = document.createElement('div');
    const root = renderInto(
      container,
      <ConversationSidebar
        conversations={CONVERSATIONS}
        selectedId={null}
        isLoading={false}
        onSelect={noop}
        onNewChat={noop}
        onDelete={onDelete}
      />,
    );

    act(() => container.querySelector<HTMLButtonElement>('.conversation-actions-trigger')!.click());
    const deleteBtn = container.querySelector<HTMLButtonElement>('.conversation-item-delete')!;
    act(() => deleteBtn.click());
    expect(deleteBtn.textContent).toBe('Confirm delete?');

    // Dismiss with Escape
    act(() => {
      container.querySelector('[role="menu"]')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });

    // Reopen menu: confirm state must be reset
    act(() => container.querySelector<HTMLButtonElement>('.conversation-actions-trigger')!.click());
    expect(container.querySelector<HTMLButtonElement>('.conversation-item-delete')!.textContent).toBe('Delete chat');
    expect(onDelete).not.toHaveBeenCalled();

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

  it('filters conversations by search query and shows a no-match status', () => {
    const container = document.createElement('div');
    const root = renderInto(
      container,
      <ConversationSidebar
        conversations={CONVERSATIONS}
        selectedId={null}
        isLoading={false}
        onSelect={noop}
        onNewChat={noop}
        onDelete={noop}
      />,
    );

    const search = container.querySelector<HTMLInputElement>('.conversation-search')!;
    expect(search).not.toBeNull();

    act(() => setNativeValue(search, 'first'));
    const items = container.querySelectorAll('.conversation-item');
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('First chat');

    act(() => setNativeValue(search, 'zzz-no-match'));
    expect(container.textContent).toContain('No matching chats');

    act(() => root.unmount());
  });

  it('renames a conversation inline via the rename affordance', () => {
    const onRename = vi.fn();
    const container = document.createElement('div');
    const root = renderInto(
      container,
      <ConversationSidebar
        conversations={CONVERSATIONS}
        selectedId={null}
        isLoading={false}
        onRename={onRename}
        onSelect={noop}
        onNewChat={noop}
        onDelete={noop}
      />,
    );

    act(() => container.querySelector<HTMLButtonElement>('.conversation-actions-trigger')!.click());
    const renameBtn = container.querySelector<HTMLButtonElement>('.conversation-item-rename')!;
    expect(renameBtn).not.toBeNull();
    act(() => renameBtn.click());

    const input = container.querySelector<HTMLInputElement>('.conversation-rename-input')!;
    expect(input).not.toBeNull();
    act(() => setNativeValue(input, 'Renamed chat'));
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onRename).toHaveBeenCalledWith(CONVERSATIONS[0]!.id, 'Renamed chat');
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.conversation-rename-input')).toBeNull();

    act(() => root.unmount());
  });

  it('pins and unpins a conversation via the actions menu', () => {
    const container = document.createElement('div');
    const root = renderInto(
      container,
      <ConversationSidebar
        conversations={CONVERSATIONS}
        selectedId={null}
        isLoading={false}
        preferenceScope='pin-test'
        onSelect={noop}
        onNewChat={noop}
        onDelete={noop}
      />,
    );

    expect(container.querySelector('.conversation-pinned-heading')).toBeNull();

    // Open menu on first chat and click 'Pin chat'
    act(() => container.querySelector<HTMLButtonElement>('.conversation-actions-trigger')!.click());
    const pinBtn = container.querySelector<HTMLButtonElement>('.conversation-item-pin')!;
    expect(pinBtn).not.toBeNull();
    expect(pinBtn.textContent).toBe('Pin chat');
    act(() => pinBtn.click());

    // Pinned section heading and pin badge appear
    expect(container.querySelector('.conversation-pinned-heading')).not.toBeNull();
    expect(container.querySelector('.conversation-pin-badge')).not.toBeNull();

    // Open menu on the pinned item and click 'Unpin chat'
    act(() => container.querySelector<HTMLButtonElement>('.conversation-actions-trigger')!.click());
    const unpinBtn = container.querySelector<HTMLButtonElement>('.conversation-item-pin')!;
    expect(unpinBtn.textContent).toBe('Unpin chat');
    act(() => unpinBtn.click());

    // Pinned heading goes away
    expect(container.querySelector('.conversation-pinned-heading')).toBeNull();

    act(() => root.unmount());
  });

  it('prunes deleted pinned conversation from state and localStorage', () => {
    const onDelete = vi.fn();
    const container = document.createElement('div');
    const scope = 'delete-pin-test';
    const storageKey = `prismatix:pinned-chats:${scope}`;
    localStorage.setItem(storageKey, JSON.stringify([CONVERSATIONS[0]!.id]));

    const root = renderInto(
      container,
      <ConversationSidebar
        conversations={CONVERSATIONS}
        selectedId={null}
        isLoading={false}
        preferenceScope={scope}
        onSelect={noop}
        onNewChat={noop}
        onDelete={onDelete}
      />,
    );

    expect(container.querySelector('.conversation-pinned-heading')).not.toBeNull();

    // Open menu on pinned conversation
    act(() => container.querySelector<HTMLButtonElement>('.conversation-actions-trigger')!.click());
    const deleteBtn = container.querySelector<HTMLButtonElement>('.conversation-item-delete')!;
    expect(deleteBtn.textContent).toBe('Delete chat');
    // First click asks confirmation
    act(() => deleteBtn.click());
    expect(deleteBtn.textContent).toBe('Confirm delete?');
    // Second click deletes
    act(() => deleteBtn.click());

    expect(onDelete).toHaveBeenCalledWith(CONVERSATIONS[0]!.id);
    expect(JSON.parse(localStorage.getItem(storageKey) || '[]')).toEqual([]);

    act(() => root.unmount());
  });
});

