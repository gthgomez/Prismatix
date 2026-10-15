// src/components/MessageActionToolbar.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MessageActionToolbar } from './MessageActionToolbar';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container.remove();
  root = null;
  vi.restoreAllMocks();
});

function render(ui: React.ReactNode): Root {
  const r = createRoot(container);
  act(() => {
    r.render(ui);
  });
  return r;
}

describe('MessageActionToolbar', () => {
  it('copies content to clipboard on copy click and shows copied state', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const onCopy = vi.fn();
    root = render(
      <MessageActionToolbar
        role='assistant'
        content='Hello from assistant'
        onCopy={onCopy}
      />,
    );

    const copyBtn = container.querySelector<HTMLButtonElement>('.message-action-btn');
    expect(copyBtn).not.toBeNull();

    await act(async () => {
      copyBtn?.click();
    });

    expect(writeTextMock).toHaveBeenCalledWith('Hello from assistant');
    expect(onCopy).toHaveBeenCalled();
    expect(container.textContent).toContain('Copied');
  });

  it('renders edit button for user message and calls onEdit', () => {
    const onEdit = vi.fn();
    root = render(
      <MessageActionToolbar
        role='user'
        content='My prompt'
        onEdit={onEdit}
      />,
    );

    const editBtn = container.querySelector<HTMLButtonElement>('.message-edit-btn');
    expect(editBtn).not.toBeNull();
    act(() => {
      editBtn?.click();
    });
    expect(onEdit).toHaveBeenCalled();
  });

  it('renders regenerate button for assistant message and calls onRegenerate', () => {
    const onRegenerate = vi.fn();
    root = render(
      <MessageActionToolbar
        role='assistant'
        content='Response to retry'
        onRegenerate={onRegenerate}
      />,
    );

    const regenBtn = container.querySelector<HTMLButtonElement>('.message-regenerate-btn');
    expect(regenBtn).not.toBeNull();
    act(() => {
      regenBtn?.click();
    });
    expect(onRegenerate).toHaveBeenCalledWith();
  });

  it('disables regenerate button when isStreaming is true', () => {
    const onRegenerate = vi.fn();
    root = render(
      <MessageActionToolbar
        role='assistant'
        content='Response streaming'
        isStreaming={true}
        onRegenerate={onRegenerate}
      />,
    );

    const regenBtn = container.querySelector<HTMLButtonElement>('.message-regenerate-btn');
    expect(regenBtn?.disabled).toBe(true);
    act(() => {
      regenBtn?.click();
    });
    expect(onRegenerate).not.toHaveBeenCalled();
  });

  it('opens regenerate dropdown and selects alternative model', () => {
    const onRegenerate = vi.fn();
    root = render(
      <MessageActionToolbar
        role='assistant'
        content='Response text'
        onRegenerate={onRegenerate}
      />,
    );

    const menuBtn = container.querySelector<HTMLButtonElement>('.message-regenerate-menu-btn');
    expect(menuBtn).not.toBeNull();
    act(() => {
      menuBtn?.click();
    });

    const dropdown = container.querySelector('.regenerate-model-dropdown');
    expect(dropdown).not.toBeNull();

    const flashOption = Array.from(container.querySelectorAll<HTMLButtonElement>('.regenerate-dropdown-item'))
      .find((el) => el.textContent?.includes('Gemini 3.8 Flash'));
    expect(flashOption).toBeDefined();

    act(() => {
      flashOption?.click();
    });

    expect(onRegenerate).toHaveBeenCalledWith('gemini-3.8-flash');
  });

  it('handles feedback up and down clicks', () => {
    const onFeedback = vi.fn();
    root = render(
      <MessageActionToolbar
        role='assistant'
        content='Response text'
        feedback='up'
        onFeedback={onFeedback}
      />,
    );

    const feedbackBtns = container.querySelectorAll<HTMLButtonElement>('.feedback-btn');
    expect(feedbackBtns.length).toBe(2);

    // First button (up) should have is-active
    expect(feedbackBtns[0]?.classList.contains('is-active')).toBe(true);

    act(() => {
      feedbackBtns[1]?.click();
    });
    expect(onFeedback).toHaveBeenCalledWith('down');
  });
});
