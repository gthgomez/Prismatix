// Streaming updates must not rerender earlier messages when their props are unchanged.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { User } from '@supabase/supabase-js';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: null }, error: null })) },
  },
}));

vi.mock('../services/conversationService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/conversationService')>();
  return {
    ...actual,
    listConversations: vi.fn(async () => []),
    loadConversation: vi.fn(async () => []),
    signAttachment: vi.fn(async () => null),
    deleteConversation: vi.fn(async () => {}),
  };
});

vi.mock('../smartFetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../smartFetch')>();
  return {
    ...actual,
    askPrismatix: vi.fn(),
  };
});

import { ChatInterface } from './ChatInterface';
import { chatMessageItemRenderLog } from './chatMessageItemRenderLog';
import { askPrismatix } from '../smartFetch';

const TEST_USER = {
  id: 'user-1111-2222-3333-444444444444',
  email: 'test@example.com',
  user_metadata: {},
} as User;

function renderInto(container: HTMLElement, ui: ReactNode): Root {
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return root;
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

function openStream() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(control) {
      controller = control;
    },
  });
  const send = (frame: string) => {
    if (!controller) throw new Error('stream is not open');
    controller.enqueue(encoder.encode(frame));
  };
  return {
    stream,
    push(text: string) {
      send(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { text } })}\n\n`);
    },
    finish() {
      send('data: [DONE]\n\n');
      controller?.close();
    },
  };
}

function routeResult(stream: ReadableStream<Uint8Array>) {
  return {
    clientRequestId: 'req-memo',
    executionId: 'exec-memo',
    model: 'deepseek-v4-flash' as const,
    modelId: 'deepseek-v4-flash',
    provider: 'opencode' as const,
    routeRole: 'fast' as const,
    complexityScore: 20,
    cost: { estimatedUsd: 0.00001, finalUsd: 0.00001, pricingVersion: '2026-10-07' },
    explanation: {
      selection: 'auto' as const,
      role: 'fast' as const,
      modelTier: 'deepseek-v4-flash',
      gateway: 'opencode' as const,
      reason: 'memo fixture',
      fallbackUsed: false,
      priceKnown: true,
    },
    stream,
  };
}

function rendersOf(index: number): number {
  return chatMessageItemRenderLog.filter((value) => value === index).length;
}

describe('ChatInterface message memo', () => {
  let host: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    localStorage.clear();
    chatMessageItemRenderLog.length = 0;
    Element.prototype.scrollIntoView = () => {};
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    host.remove();
    root = null;
    vi.clearAllMocks();
  });

  it('keeps earlier messages mounted while the streaming message updates', async () => {
    const first = openStream();
    (askPrismatix as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(routeResult(first.stream));
    root = renderInto(host, <ChatInterface user={TEST_USER} onSignOut={async () => {}} />);
    await act(async () => { await flushPromises(); });

    act(() => host.querySelector<HTMLButtonElement>('.prompt-starter-chip')!.click());
    const sendButton = host.querySelector<HTMLButtonElement>('.send-button')!;
    await act(async () => {
      sendButton.click();
      await flushPromises();
      await flushPromises();
    });

    await act(async () => {
      first.push('Alpha');
      await flushPromises();
    });
    expect(host.querySelector('.message-assistant')?.textContent).toContain('Alpha');
    const userRenders = rendersOf(0);
    const assistantRenders = rendersOf(1);
    expect(userRenders).toBeGreaterThan(0);
    expect(assistantRenders).toBeGreaterThan(0);

    await act(async () => {
      first.push(' Beta');
      await flushPromises();
    });
    expect(host.querySelector('.message-assistant')?.textContent).toContain('Alpha Beta');
    expect(rendersOf(0)).toBe(userRenders);
    expect(rendersOf(1)).toBeGreaterThan(assistantRenders);

    const followUp = openStream();
    (askPrismatix as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(routeResult(followUp.stream));
    await act(async () => {
      first.finish();
      await flushPromises();
    });

    const feedback = host.querySelector<HTMLButtonElement>('.message-assistant .feedback-btn')!;
    await act(async () => {
      feedback.click();
      await flushPromises();
    });
    expect(host.querySelector('.message-assistant .feedback-btn')?.getAttribute('aria-pressed')).toBe('true');

    const edit = host.querySelector<HTMLButtonElement>('.message-user .message-edit-btn')!;
    act(() => edit.click());
    const textarea = host.querySelector<HTMLTextAreaElement>('.message-inline-edit-textarea')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, 'Edited prompt');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.message-inline-edit-save')!.click();
      await flushPromises();
      await flushPromises();
    });
    expect(askPrismatix).toHaveBeenCalledTimes(2);
    const secondCall = (askPrismatix as unknown as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as { query?: string } | undefined;
    expect(JSON.stringify(secondCall)).toContain('Edited prompt');

    await act(async () => {
      followUp.push('Done');
      followUp.finish();
      await flushPromises();
    });
    expect(host.querySelector('.message-assistant')?.textContent).toContain('Done');
  });

  it('does not rerender an earlier assistant while a later one streams, and regenerates that earlier turn', async () => {
    const setComposer = (value: string) => {
      const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    const send = async () => {
      const button = host.querySelector<HTMLButtonElement>('.send-button')!;
      await act(async () => {
        button.click();
        await flushPromises();
        await flushPromises();
      });
    };

    const first = openStream();
    (askPrismatix as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(routeResult(first.stream));
    root = renderInto(host, <ChatInterface user={TEST_USER} onSignOut={async () => {}} />);
    await act(async () => { await flushPromises(); });
    setComposer('First question');
    await send();
    await act(async () => {
      first.push('Answer one');
      first.finish();
      await flushPromises();
    });
    expect(host.querySelector('.message-assistant')?.textContent).toContain('Answer one');

    const second = openStream();
    (askPrismatix as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(routeResult(second.stream));
    setComposer('Second question');
    await send();
    await act(async () => {
      second.push('Two');
      await flushPromises();
    });
    const assistants = () => host.querySelectorAll('.message-assistant');
    expect(assistants()).toHaveLength(2);
    expect(assistants()[1]?.textContent).toContain('Two');
    const earlierAssistantRenders = rendersOf(1);

    await act(async () => {
      second.push(' more');
      await flushPromises();
    });
    expect(assistants()[1]?.textContent).toContain('Two more');
    expect(rendersOf(1)).toBe(earlierAssistantRenders);
    expect(assistants()[0]?.textContent).toContain('Answer one');

    const regenerated = openStream();
    (askPrismatix as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(routeResult(regenerated.stream));
    await act(async () => {
      second.finish();
      await flushPromises();
    });
    const regenerate = assistants()[0]!.querySelector<HTMLButtonElement>('.message-regenerate-btn')!;
    await act(async () => {
      regenerate.click();
      await flushPromises();
      await flushPromises();
    });
    const calls = (askPrismatix as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1]?.[0]).toBe('First question');
    expect(host.textContent).toContain('First question');
    expect(host.textContent).not.toContain('Second question');
    await act(async () => {
      regenerated.push('Regenerated');
      regenerated.finish();
      await flushPromises();
    });
    expect(host.querySelector('.message-assistant')?.textContent).toContain('Regenerated');
  });
});
