import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('KeyboardShortcutsModal', () => {
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container) {
      document.body.removeChild(container);
      container = null;
    }
  });

  it('renders nothing when isOpen is false', async () => {
    const root = createRoot(container!);
    await act(async () => {
      root.render(<KeyboardShortcutsModal isOpen={false} onClose={vi.fn()} />);
    });

    expect(container?.querySelector('.shortcuts-modal')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('renders shortcuts dialog and triggers onClose via close button and Escape', async () => {
    const onClose = vi.fn();
    const root = createRoot(container!);
    await act(async () => {
      root.render(<KeyboardShortcutsModal isOpen={true} onClose={onClose} />);
    });

    const modal = container?.querySelector('.shortcuts-modal');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('Keyboard Shortcuts');
    expect(modal?.textContent).toContain('Start new chat');
    expect(modal?.textContent).toContain('Toggle conversation sidebar');

    const closeBtn = container?.querySelector('.shortcuts-close-button') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();

    await act(async () => {
      closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Escape key
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
    });
  });

  it('stops immediate propagation on Escape to prevent sibling window listeners from firing', async () => {
    const onClose = vi.fn();
    const root = createRoot(container!);
    await act(async () => {
      root.render(<KeyboardShortcutsModal isOpen={true} onClose={onClose} />);
    });

    const siblingListener = vi.fn();
    window.addEventListener('keydown', siblingListener);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(siblingListener).not.toHaveBeenCalled();

    window.removeEventListener('keydown', siblingListener);
    await act(async () => {
      root.unmount();
    });
  });

  it('does not place aria-hidden="true" on the backdrop containing dialog', async () => {
    const root = createRoot(container!);
    await act(async () => {
      root.render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);
    });

    const backdrop = container?.querySelector('.shortcuts-modal-backdrop');
    expect(backdrop).not.toBeNull();
    expect(backdrop?.getAttribute('aria-hidden')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('does not re-steal focus when parent re-renders with a new onClose function reference', async () => {
    let onCloseHandler = vi.fn();
    const root = createRoot(container!);
    await act(async () => {
      root.render(<KeyboardShortcutsModal isOpen={true} onClose={onCloseHandler} />);
    });

    const closeBtn = container?.querySelector('.shortcuts-close-button') as HTMLButtonElement;
    expect(document.activeElement).toBe(closeBtn);

    // Create a temporary input inside the modal to move focus to
    const tempInput = document.createElement('input');
    container?.querySelector('.shortcuts-modal')?.appendChild(tempInput);
    tempInput.focus();
    expect(document.activeElement).toBe(tempInput);

    // Re-render with a new function reference
    onCloseHandler = vi.fn();
    await act(async () => {
      root.render(<KeyboardShortcutsModal isOpen={true} onClose={onCloseHandler} />);
    });

    // Focus must NOT have been stolen back to close button
    expect(document.activeElement).toBe(tempInput);

    await act(async () => {
      root.unmount();
    });
  });

  it('restores focus to trigger element on modal close', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const root = createRoot(container!);
    await act(async () => {
      root.render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);
    });

    const closeBtn = container?.querySelector('.shortcuts-close-button') as HTMLButtonElement;
    expect(document.activeElement).toBe(closeBtn);

    await act(async () => {
      root.unmount();
    });

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('traps Tab focus when multiple interactive elements are present', async () => {
    const root = createRoot(container!);
    await act(async () => {
      root.render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);
    });

    const modal = container?.querySelector('.shortcuts-modal') as HTMLElement;
    const closeBtn = container?.querySelector('.shortcuts-close-button') as HTMLButtonElement;

    // Add a second focusable element to test wrapping between first and last
    const secondBtn = document.createElement('button');
    secondBtn.textContent = 'Extra Action';
    modal.appendChild(secondBtn);

    // Focus last element (secondBtn) and press Tab -> should wrap to first element (closeBtn)
    secondBtn.focus();
    expect(document.activeElement).toBe(secondBtn);

    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    window.dispatchEvent(tabEvent);
    expect(document.activeElement).toBe(closeBtn);

    // Focus first element (closeBtn) and press Shift+Tab -> should wrap to last element (secondBtn)
    closeBtn.focus();
    const shiftTabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(shiftTabEvent);
    expect(document.activeElement).toBe(secondBtn);

    await act(async () => {
      root.unmount();
    });
  });
});
