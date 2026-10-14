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
});
