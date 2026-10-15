// src/components/ChatMessageItem.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatMessageItem } from './ChatMessageItem';
import type { Message } from '../types';

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

describe('ChatMessageItem', () => {
  const sampleAssistantMessage: Message = {
    role: 'assistant',
    content: 'Here is an answer',
    timestamp: 1700000000000,
    model: 'gemini-3.8-flash',
    provider: 'google',
  };

  it('renders assistant message with model pill and invokes onToggleMetadata with index', () => {
    const onToggleMetadata = vi.fn();
    root = render(
      <ChatMessageItem
        message={sampleAssistantMessage}
        index={2}
        isStreaming={false}
        isWaitingFirstToken={false}
        defaultModelColor='#4ECDC4'
        isMetadataExpanded={false}
        onToggleMetadata={onToggleMetadata}
      />,
    );

    const pill = container.querySelector<HTMLButtonElement>('.message-model-pill');
    expect(pill).not.toBeNull();
    act(() => {
      pill?.click();
    });
    expect(onToggleMetadata).toHaveBeenCalledWith(2);
  });

  it('renders expanded metadata popover when isMetadataExpanded is true', () => {
    root = render(
      <ChatMessageItem
        message={sampleAssistantMessage}
        index={0}
        isStreaming={false}
        isWaitingFirstToken={false}
        defaultModelColor='#4ECDC4'
        isMetadataExpanded={true}
        onToggleMetadata={vi.fn()}
      />,
    );

    const popover = container.querySelector('.metadata-popover');
    expect(popover).not.toBeNull();
    expect(popover?.textContent).toContain('google');
  });

  it('renders placeholder when image attachment signature fails', () => {
    const messageWithBrokenImage: Message = {
      role: 'user',
      content: 'Look at this',
      timestamp: 1700000000000,
      attachments: [
        { name: 'photo.png', kind: 'image', isImage: true },
      ],
    };

    root = render(
      <ChatMessageItem
        message={messageWithBrokenImage}
        index={0}
        isStreaming={false}
        isWaitingFirstToken={false}
        defaultModelColor='#4ECDC4'
        isMetadataExpanded={false}
        onToggleMetadata={vi.fn()}
      />,
    );

    expect(container.querySelector('.message-image-placeholder')?.textContent).toContain('image unavailable');
  });

  it('renders MessageActionToolbar on assistant message and invokes onRegenerate and onFeedback', () => {
    const onRegenerate = vi.fn();
    const onFeedback = vi.fn();

    root = render(
      <ChatMessageItem
        message={sampleAssistantMessage}
        index={1}
        isStreaming={false}
        isWaitingFirstToken={false}
        defaultModelColor='#4ECDC4'
        isMetadataExpanded={false}
        onToggleMetadata={vi.fn()}
        onRegenerate={onRegenerate}
        onFeedback={onFeedback}
      />,
    );

    const toolbar = container.querySelector('.message-action-toolbar');
    expect(toolbar).not.toBeNull();

    const regenBtn = container.querySelector<HTMLButtonElement>('.message-regenerate-btn');
    expect(regenBtn).not.toBeNull();
    act(() => {
      regenBtn?.click();
    });
    expect(onRegenerate).toHaveBeenCalledWith(1, undefined);

    const feedbackBtns = container.querySelectorAll<HTMLButtonElement>('.feedback-btn');
    expect(feedbackBtns.length).toBe(2);
    act(() => {
      feedbackBtns[0]?.click();
    });
    expect(onFeedback).toHaveBeenCalledWith(1, 'up');
  });

  it('allows user to enter inline edit mode, modify prompt, and submit', () => {
    const onEditPrompt = vi.fn();
    const userMessage: Message = {
      role: 'user',
      content: 'Original user question',
      timestamp: 1700000000000,
    };

    root = render(
      <ChatMessageItem
        message={userMessage}
        index={0}
        isStreaming={false}
        isWaitingFirstToken={false}
        defaultModelColor='#4ECDC4'
        isMetadataExpanded={false}
        onToggleMetadata={vi.fn()}
        onEditPrompt={onEditPrompt}
      />,
    );

    // Click Edit button in toolbar
    const editBtn = container.querySelector<HTMLButtonElement>('.message-edit-btn');
    expect(editBtn).not.toBeNull();
    act(() => {
      editBtn?.click();
    });

    // Check textarea is displayed
    const textarea = container.querySelector<HTMLTextAreaElement>('.message-inline-edit-textarea');
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toBe('Original user question');

    // Change text
    act(() => {
      if (textarea) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        nativeSetter?.call(textarea, 'Updated question with more details');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    // Click Save & Submit
    const saveBtn = container.querySelector<HTMLButtonElement>('.message-inline-edit-save');
    expect(saveBtn).not.toBeNull();
    act(() => {
      saveBtn?.click();
    });

    expect(onEditPrompt).toHaveBeenCalledWith(0, 'Updated question with more details');
    // After submit, inline edit mode exits
    expect(container.querySelector('.message-inline-edit-textarea')).toBeNull();
  });

  it('cancels inline edit mode on Cancel click without calling onEditPrompt', () => {
    const onEditPrompt = vi.fn();
    const userMessage: Message = {
      role: 'user',
      content: 'Another prompt',
      timestamp: 1700000000000,
    };

    root = render(
      <ChatMessageItem
        message={userMessage}
        index={0}
        isStreaming={false}
        isWaitingFirstToken={false}
        defaultModelColor='#4ECDC4'
        isMetadataExpanded={false}
        onToggleMetadata={vi.fn()}
        onEditPrompt={onEditPrompt}
      />,
    );

    const editBtn = container.querySelector<HTMLButtonElement>('.message-edit-btn');
    act(() => {
      editBtn?.click();
    });

    const cancelBtn = container.querySelector<HTMLButtonElement>('.message-inline-edit-cancel');
    expect(cancelBtn).not.toBeNull();
    act(() => {
      cancelBtn?.click();
    });

    expect(onEditPrompt).not.toHaveBeenCalled();
    expect(container.querySelector('.message-inline-edit-textarea')).toBeNull();
  });
});
