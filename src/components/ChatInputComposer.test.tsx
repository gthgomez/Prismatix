// src/components/ChatInputComposer.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatInputComposer } from './ChatInputComposer';
import { SEND_BLOCKED_TITLES } from './chatTypes';

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

describe('ChatInputComposer', () => {
  const defaultProps = {
    input: '',
    inputRef: { current: null } as React.RefObject<HTMLTextAreaElement>,
    onChange: vi.fn(),
    onKeyDown: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    isStreaming: false,
    isWaitingFirstToken: false,
    sendBlockedReason: 'empty' as const,
    sendBlockedTitles: SEND_BLOCKED_TITLES,
    hasPendingVideoUploads: false,
    draftAttachments: [],
    onRemoveAttachment: vi.fn(),
    onClearAllAttachments: vi.fn(),
    onFileSelect: vi.fn(),
    onMultipleFiles: vi.fn(),
    manualModelOverride: null,
    currentModel: 'gemini-3.8-flash' as const,
    modelConfigName: 'Gemini 3.8 Flash',
    modelConfigColor: '#4ECDC4',
    debateSelection: 'off' as const,
    enabledProviders: new Set(['opencode' as const]),
    onModelSelect: vi.fn(),
    onClearOverride: vi.fn(),
    onOpenProviderSettings: vi.fn(),
    openRoutingDebateMenu: vi.fn(),
    showPromptStarters: true,
    promptStarters: [
      { title: 'Quick Plan', prompt: 'Create a plan' },
    ],
    onSelectPromptStarter: vi.fn(),
    streamOutcome: null,
    contextExcludedCount: 0,
    duplicateNotice: null,
    composerValidationView: null,
  };

  it('renders input with prompt starters and handles selection', () => {
    const onSelectPromptStarter = vi.fn();
    root = render(
      <ChatInputComposer
        {...defaultProps}
        onSelectPromptStarter={onSelectPromptStarter}
      />,
    );

    const starterBtn = container.querySelector<HTMLButtonElement>('.prompt-starter-chip');
    expect(starterBtn?.textContent).toContain('Quick Plan');
    act(() => {
      starterBtn?.click();
    });
    expect(onSelectPromptStarter).toHaveBeenCalledWith('Create a plan');
  });

  it('disables send button and reflects sendBlockedReason aria-label when empty', () => {
    root = render(<ChatInputComposer {...defaultProps} sendBlockedReason='empty' />);

    const sendBtn = container.querySelector<HTMLButtonElement>('.send-button')!;
    expect(sendBtn.disabled).toBe(true);
    expect(sendBtn.getAttribute('aria-label')).toBe(SEND_BLOCKED_TITLES.empty);
  });

  it('shows stop button and streaming status during active generation', () => {
    const onStop = vi.fn();
    root = render(
      <ChatInputComposer
        {...defaultProps}
        isStreaming
        sendBlockedReason='streaming'
        onStop={onStop}
      />,
    );

    const stopBtn = container.querySelector<HTMLButtonElement>('.stop-button')!;
    expect(stopBtn).not.toBeNull();
    act(() => {
      stopBtn.click();
    });
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
