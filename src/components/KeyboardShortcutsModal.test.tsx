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
});
