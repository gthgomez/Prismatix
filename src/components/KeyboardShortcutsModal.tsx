import React, { useEffect, useRef } from 'react';

export interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface ShortcutCategory {
  title: string;
  shortcuts: ShortcutItem[];
}

const KEYBOARD_SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    title: 'Navigation & Workspace',
    shortcuts: [
      { keys: ['Ctrl / ⌘', 'Shift', 'O'], description: 'Start new chat' },
      { keys: ['Ctrl / ⌘', 'Shift', 'S'], description: 'Toggle conversation sidebar' },
      { keys: ['Ctrl / ⌘', 'K'], description: 'Focus model & route picker' },
      { keys: ['?'], description: 'Open keyboard shortcuts cheatsheet' },
      { keys: ['Esc'], description: 'Stop streaming response / dismiss popovers' },
    ],
  },
  {
    title: 'Chat Composer',
    shortcuts: [
      { keys: ['Enter'], description: 'Send message' },
      { keys: ['Shift', 'Enter'], description: 'Insert new line' },
      { keys: ['↑'], description: 'Recall previous prompt (when composer is empty)' },
    ],
  },
];

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({ isOpen, onClose }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === modalRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className='modal-backdrop shortcuts-modal-backdrop'
      onClick={onClose}
    >
      <div
        className='shortcuts-modal'
        role='dialog'
        aria-modal='true'
        aria-labelledby='shortcuts-modal-title'
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className='shortcuts-modal-header'>
          <div className='shortcuts-modal-title-wrap'>
            <span className='shortcuts-icon' aria-hidden='true'>⌨️</span>
            <h2 id='shortcuts-modal-title'>Keyboard Shortcuts</h2>
          </div>
          <button
            ref={closeButtonRef}
            type='button'
            className='shortcuts-close-button'
            onClick={onClose}
            aria-label='Close keyboard shortcuts'
          >
            ✕
          </button>
        </div>

        <div className='shortcuts-modal-body'>
          {KEYBOARD_SHORTCUT_CATEGORIES.map((category) => (
            <div key={category.title} className='shortcuts-section'>
              <h3 className='shortcuts-section-heading'>{category.title}</h3>
              <div className='shortcuts-list'>
                {category.shortcuts.map((shortcut) => (
                  <div key={shortcut.description} className='shortcut-row'>
                    <span className='shortcut-desc'>{shortcut.description}</span>
                    <span className='shortcut-keys'>
                      {shortcut.keys.map((key) => (
                        <kbd key={key} className='shortcut-key'>
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className='shortcuts-modal-footer'>
          <span>Press <kbd className='shortcut-key'>Esc</kbd> to close at any time</span>
        </div>
      </div>
    </div>
  );
};
