// ChatInterface.e2e.test.tsx
// End-to-end integration smoke tests for ChatInterface:
// - Navigation sidebar drawer toggle and mobile layout
// - Multi-turn user typing and streaming assistant response
// - Stream-safe Markdown/code rendering with copy buttons
// - Rehydrated model and cost badges
// - New Chat state reset

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
    listConversations: vi.fn(async () => [
      { id: 'conv-1', title: 'First Conversation', lastActivityAt: '2026-10-01T00:00:00Z', projectId: null },
    ]),
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

const providerPlugins = vi.hoisted(() => ({
  providers: [{ id: 'openrouter', label: 'OpenRouter', enabled: true, hasKey: true, keyLast4: 'test', offeredByDefault: true, defaultProvider: true }],
  defaultProvider: 'openrouter',
  enabledProviders: new Set(['openrouter']),
  isConfigured: true,
  isVerified: true,
  verificationStatus: 'verified',
  verificationLoading: false,
  verifyEnabledProviders: vi.fn(async () => true),
  validateKey: vi.fn(async () => ({ provider: 'openrouter', status: 'unknown', clientAccountGeneration: 0 })),
  invalidateVerification: vi.fn(),
  loading: false,
  error: null,
  refresh: vi.fn(async () => {}),
  setEnabled: vi.fn(async () => true),
  setKey: vi.fn(async () => true),
  removeKey: vi.fn(async () => true),
  setDefault: vi.fn(async () => true),
}));

vi.mock('../hooks/useProviderPlugins', () => ({
  useProviderPlugins: () => providerPlugins,
}));

import { ChatInterface } from './ChatInterface';
import { askPrismatix } from '../smartFetch';
import { loadConversation } from '../services/conversationService';
import { getFinanceStore } from '../services/financeTracker';

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

function setTextareaValue(input: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function createSseStream(textChunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const text of textChunks) {
        const payload = `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text } })}\n\n`;
        controller.enqueue(encoder.encode(payload));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

function createSettledReceiptStream(text: string, settledUsd: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const events = [
    { type: 'content_block_delta', delta: { text } },
    {
      type: 'receipt',
      executionId: 'exec-unreported-model',
      status: 'completed',
      terminalOutcome: 'ok',
      settlement: { state: 'settled', committedUsd: settledUsd, pendingCalls: 0 },
      transcript: { saved: true },
      calls: [{ stage: 'baseline', participant: 'openrouter', attemptNumber: 1, servedModel: null, costStatus: 'settled', totalCost: settledUsd }],
    },
  ];
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

function createInterruptedSettledReceiptStream(text: string, settledUsd: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const events = [
    { type: 'content_block_delta', delta: { text } },
    {
      type: 'receipt',
      executionId: 'exec-interrupted-settled-zero',
      status: 'started',
      terminalOutcome: 'upstream_interrupted',
      settlement: { state: 'settled', committedUsd: settledUsd, pendingCalls: 0 },
      transcript: { saved: false },
      calls: [{ stage: 'baseline', participant: 'openrouter', attemptNumber: 1, servedModel: null, costStatus: 'settled', totalCost: settledUsd }],
    },
  ];
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      // Deliberately close without [DONE]: the receipt is settled, while the
      // stream outcome must remain interrupted.
      controller.close();
    },
  });
}

describe('ChatInterface End-to-End Integration Flow', () => {
  let host: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    localStorage.clear();
    providerPlugins.providers = [{ id: 'openrouter', label: 'OpenRouter', enabled: true, hasKey: true, keyLast4: 'test', offeredByDefault: true, defaultProvider: true }];
    providerPlugins.isConfigured = true;
    providerPlugins.isVerified = true;
    providerPlugins.verificationStatus = 'verified';
    providerPlugins.validateKey = vi.fn(async () => ({ provider: 'openrouter', status: 'unknown', clientAccountGeneration: 0 }));
    providerPlugins.setKey = vi.fn(async () => true);
    providerPlugins.verifyEnabledProviders = vi.fn(async () => true);
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('names the message input and reflects automatic versus manual routing in the selector', async () => {
    root = renderInto(host, <ChatInterface user={TEST_USER} onSignOut={async () => {}} />);
    await act(async () => { await flushPromises(); });

    const input = host.querySelector('textarea');
    expect(input?.getAttribute('aria-label')).toBe('Message Prismatix');
    const selector = host.querySelector<HTMLButtonElement>('.model-indicator-button')!;
    expect(selector.textContent).toContain('Auto routing');
    expect(selector.getAttribute('aria-expanded')).toBe('false');

    act(() => selector.click());
    expect(selector.getAttribute('aria-expanded')).toBe('true');
    act(() => host.querySelector<HTMLButtonElement>('[role="tab"]:nth-child(2)')!.click());
    act(() => host.querySelector<HTMLButtonElement>('.model-option')!.click());
    expect(selector.textContent).toContain('Manual');
    expect(selector.textContent).not.toContain('Auto routing');
    expect(selector.getAttribute('aria-expanded')).toBe('false');

    act(() => selector.click());
    act(() => host.querySelector<HTMLButtonElement>('.auto-mode-btn')!.click());
    expect(selector.textContent).toContain('Auto routing');
    expect(selector.textContent).not.toContain('Manual');
  });

  it('recovers first-run OpenRouter without requiring unsupported providers to verify', async () => {
    providerPlugins.isConfigured = false;
    providerPlugins.isVerified = false;
    providerPlugins.verificationStatus = 'unverified';
    providerPlugins.providers = [{ id: 'openrouter', label: 'OpenRouter', enabled: true, hasKey: false, keyLast4: 'test', offeredByDefault: true, defaultProvider: true }];
    providerPlugins.validateKey = vi.fn(async () => ({ provider: 'openrouter', status: 'unknown', clientAccountGeneration: 0 }));
    providerPlugins.setKey = vi.fn(async () => true);
    providerPlugins.verifyEnabledProviders = vi.fn(async () => true);

    root = renderInto(host, <ChatInterface user={TEST_USER} onSignOut={async () => {}} />);
    await act(async () => { await flushPromises(); });
    const keyInput = host.querySelector<HTMLInputElement>('#first-run-openrouter-key')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(keyInput, 'sk-unverified-synthetic-key');
      keyInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => host.querySelector<HTMLButtonElement>('.first-run-submit')!.click());
    await act(async () => { await flushPromises(); });
    const verifyButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Verify provider keys')!;
    expect(verifyButton).toBeTruthy();
    act(() => verifyButton.click());
    await act(async () => { await flushPromises(); });

    expect(providerPlugins.verifyEnabledProviders).toHaveBeenCalledWith('openrouter');
  });

  it('does not describe an inconclusive provider check as never checked', async () => {
    Object.assign(providerPlugins.providers[0]!, { status: 'unknown' });
    providerPlugins.isVerified = false;
    providerPlugins.verificationStatus = 'unverified';
    root = renderInto(host, <ChatInterface user={TEST_USER} onSignOut={async () => {}} />);
    await act(async () => { await flushPromises(); });

    expect(host.querySelector('.arctic-provider-unknown-status')?.textContent).toContain('checks need attention');
    expect(host.querySelector('.arctic-provider-unknown-status')?.textContent).not.toContain('not been checked');
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root!.unmount();
      });
      root = null;
    }
    host.remove();
    vi.clearAllMocks();
  });

  it('resizes suggested prompts, caps long drafts, and restores the empty composer height', async () => {
    root = renderInto(host, <ChatInterface user={TEST_USER} onSignOut={async () => {}} />);
    await act(async () => { await flushPromises(); });
    const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
    let contentHeight = 120;
    // JSDOM does not perform text layout; supply only the browser's measurement.
    Object.defineProperty(input, 'scrollHeight', {
      configurable: true, get: () => input.value ? contentHeight : 44,
    });
    act(() => host.querySelector<HTMLButtonElement>('.prompt-starter-chip')!.click());
    expect(input.style.height).toBe('120px');
    contentHeight = 360;
    act(() => host.querySelectorAll<HTMLButtonElement>('.prompt-starter-chip')[1]!.click());
    expect(input.style.height).toBe('200px');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.style.height).toBe('44px');
  });

  it('renders chat layout, model selector, suggestions, and toggles mobile drawer', async () => {
    root = renderInto(host, <ChatInterface user={TEST_USER} onSignOut={async () => {}} />);
    await act(async () => {
      await flushPromises();
    });

    // Verify Header and Title
    expect(host.querySelector('.header-title h1')?.textContent).toBe('Prismatix');

    // Verify Mobile Toggle Button
    const toggleBtn = host.querySelector('.sidebar-toggle-button') as HTMLButtonElement;
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');

    // Click toggle button -> opens sidebar
    act(() => {
      toggleBtn.click();
    });
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('.conversation-sidebar.open')).not.toBeNull();

    // Click backdrop overlay -> closes sidebar
    const backdrop = host.querySelector('.conversation-sidebar-backdrop') as HTMLElement;
    expect(backdrop).not.toBeNull();
    act(() => {
      backdrop.click();
    });
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('handles multi-turn sending, streaming response, and code formatting', async () => {
    const mockResponse = {
      clientRequestId: 'req-1234',
      executionId: 'exec-1234',
      model: 'deepseek-v4-flash' as const,
      modelId: 'deepseek-v4-flash',
      provider: 'opencode' as const,
      routeRole: 'fast' as const,
      complexityScore: 50,
      cost: { estimatedUsd: 0.00005, finalUsd: 0.000045, pricingVersion: '2026-10-07' },
      explanation: {
        selection: 'auto' as const,
        role: 'fast' as const,
        modelTier: 'deepseek-v4-flash',
        gateway: 'opencode' as const,
        reason: 'Optimal low-latency model for quick queries',
        fallbackUsed: false,
        priceKnown: true,
      },
      stream: createSseStream([
        'Here is the solution:\n\n```typescript\nconst message = "Prismatix";\nconsole.log(message);\n```\nEnjoy!',
      ]),
    };

    (askPrismatix as any).mockResolvedValue(mockResponse);

    root = renderInto(host, <ChatInterface user={TEST_USER} onSignOut={async () => {}} />);
    await act(async () => {
      await flushPromises();
    });

    // Click prompt starter chip to populate input
    const starterChip = host.querySelector('.prompt-starter-chip') as HTMLButtonElement;
    expect(starterChip).not.toBeNull();
    act(() => {
      starterChip.click();
    });
    const originalInput = host.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(document.activeElement).toBe(originalInput);
    expect(originalInput.value.length).toBeGreaterThan(0);
    act(() => host.querySelector<HTMLButtonElement>('.chats-toggle-button')!.click());
    expect(host.querySelector('textarea')).toBe(originalInput);
    expect(originalInput.value.length).toBeGreaterThan(0);

    // Send Button should now be enabled
    const sendButton = host.querySelector('.send-button') as HTMLButtonElement;
    expect(sendButton).not.toBeNull();
    expect(sendButton.disabled).toBe(false);

    await act(async () => {
      sendButton.click();
      await flushPromises();
      await flushPromises();
    });

    // Verify user message is rendered (.message-user)
    const userMessages = host.querySelectorAll('.message-user');
    expect(userMessages.length).toBeGreaterThan(0);

    // Verify assistant message is rendered (.message-assistant)
    const assistantMessages = host.querySelectorAll('.message-assistant');
    expect(assistantMessages.length).toBeGreaterThan(0);
    const firstAssistantMsg = assistantMessages[0]!;
    expect(firstAssistantMsg.textContent).toContain('Here is the solution:');
    expect(host.querySelector('textarea')).toBe(originalInput);
    expect(host.querySelector('.prompt-starters-section')).toBeNull();

    // Code block with copy button (.code-block-wrapper and .code-copy-btn)
    const codeBlock = firstAssistantMsg.querySelector('.code-block-wrapper');
    expect(codeBlock).not.toBeNull();
    const copyBtn = codeBlock?.querySelector('.code-copy-btn');
    expect(copyBtn).not.toBeNull();
    expect(copyBtn?.textContent).toContain('Copy');

    // Verify model pill is rendered
    const modelPill = firstAssistantMsg.querySelector('.message-model-pill');
    expect(modelPill).not.toBeNull();
    expect(modelPill?.textContent).toContain('DeepSeek V4 Flash');

    act(() => host.querySelector<HTMLButtonElement>('.chats-toggle-button')!.click());
    act(() => host.querySelector<HTMLButtonElement>('.conversation-new-button')!.click());
    expect(host.querySelector('textarea')).toBe(originalInput);
    expect(host.querySelector('.prompt-starters-section')).not.toBeNull();
  });

  it('keeps the selection and settled amount when the router omits model identity', async () => {
    vi.mocked(askPrismatix).mockResolvedValue({
      executionId: 'exec-unreported-model',
      model: undefined,
      provider: 'openrouter',
      complexityScore: 50,
      costEstimateUsd: undefined,
      stream: createSettledReceiptStream('Answer without a model header.', 0.023),
    });

    root = renderInto(host, <ChatInterface user={TEST_USER} onSignOut={async () => {}} />);
    await act(async () => { await flushPromises(); });
    const selector = host.querySelector<HTMLButtonElement>('.model-indicator-button')!;
    const selectionBefore = selector.textContent;
    const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
    act(() => setTextareaValue(input, 'Which model answered?'));
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.send-button')!.click();
      await flushPromises();
      await flushPromises();
    });

    expect(selector.textContent).toBe(selectionBefore);
    expect(host.querySelector('.message-assistant .message-model-pill')).toBeNull();
    expect(host.querySelector('.cost-estimator')?.textContent).toContain('The router did not report the model');
    expect(host.querySelector('.cost-estimator')?.textContent).toContain('$0.0230');
    expect(host.querySelector('.cost-estimator')?.textContent).not.toContain('$0.0000');
  });

  it('shows an unknown server-reported model id without applying a catalog price', async () => {
    vi.mocked(askPrismatix).mockResolvedValue({
      executionId: 'exec-newer-model',
      model: undefined,
      reportedModel: 'gemini-4.2-flash',
      provider: 'openrouter',
      complexityScore: 50,
      stream: createSettledReceiptStream('Answer from a newer model.', 0.031),
    });

    root = renderInto(host, <ChatInterface user={TEST_USER} onSignOut={async () => {}} />);
    await act(async () => { await flushPromises(); });
    const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
    act(() => setTextareaValue(input, 'Which new model answered?'));
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.send-button')!.click();
      await flushPromises();
      await flushPromises();
    });

    const modelPill = host.querySelector<HTMLButtonElement>('.message-assistant .message-model-pill');
    expect(modelPill?.textContent).toContain('Unrecognized model: gemini-4.2-flash');
    act(() => modelPill?.click());
    expect(host.querySelector('.message-assistant .metadata-popover')?.textContent).toContain('Server model IDgemini-4.2-flash');
    expect(host.querySelector('.cost-estimator')?.textContent).toContain('gemini-4.2-flash');
    expect(host.querySelector('.cost-estimator')?.textContent).toContain('$0.0310');
  });

  it('retains and records a settled zero receipt when an unreported-model stream is interrupted', async () => {
    vi.mocked(askPrismatix).mockResolvedValue({
      executionId: 'exec-interrupted-settled-zero',
      model: undefined,
      provider: 'openrouter',
      complexityScore: 50,
      stream: createInterruptedSettledReceiptStream('Partial answer before disconnect.', 0),
    });

    root = renderInto(host, <ChatInterface user={TEST_USER} onSignOut={async () => {}} />);
    await act(async () => { await flushPromises(); });
    const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
    act(() => setTextareaValue(input, 'Keep the confirmed zero receipt'));
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.send-button')!.click();
      await flushPromises();
      await flushPromises();
    });

    const estimator = host.querySelector('.cost-estimator')!;
    expect(estimator.textContent).toContain('Confirmed receipt');
    expect(estimator.textContent).toContain('$0.0000');
    expect(host.querySelector('.stream-outcome')?.textContent).toContain('Connection closed prematurely');
    expect(host.querySelector('.stream-outcome')?.textContent).toContain('Settlement: settled');
    expect(getFinanceStore(TEST_USER.id).history).toContainEqual(expect.objectContaining({
      model: 'Unreported model',
      cost: 0,
      costStatus: 'settled',
      executionId: 'exec-interrupted-settled-zero',
    }));
  });

  it('records a confirmed zero when an unreported-model stream completes', async () => {
    vi.mocked(askPrismatix).mockResolvedValue({
      executionId: 'exec-unreported-model',
      model: undefined,
      provider: 'openrouter',
      complexityScore: 50,
      stream: createSettledReceiptStream('Completed at zero cost.', 0),
    });
    root = renderInto(host, <ChatInterface user={TEST_USER} onSignOut={async () => {}} />);
    await act(async () => { await flushPromises(); });
    const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
    act(() => setTextareaValue(input, 'Keep the completed zero receipt'));
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.send-button')!.click();
      await flushPromises();
      await flushPromises();
    });
    expect(host.querySelector('.cost-estimator')?.textContent).toContain('Confirmed receipt');
    expect(getFinanceStore(TEST_USER.id).history).toContainEqual(expect.objectContaining({
      model: 'Unreported model',
      cost: 0,
      costStatus: 'settled',
      executionId: 'exec-unreported-model',
    }));
  });

  it('rehydrates unknown model identity and rationale without assigning a route model tier', async () => {
    vi.mocked(loadConversation).mockResolvedValueOnce([{
      id: 'assistant-unrecognized-model',
      role: 'assistant',
      content: 'Persisted answer from a newer model',
      createdAt: '2026-11-20T00:01:00Z',
      attachments: [],
      modelUsed: 'gemini-4.2-flash',
      executionId: 'exec-unrecognized-model-history',
      tokenCount: 50,
      provenance: {
        modelId: 'gemini-4.2-flash',
        reportedModel: 'gemini-4.2-flash',
        routeRationale: 'code_detected',
      },
    }]);

    root = renderInto(host, <ChatInterface user={TEST_USER} onSignOut={async () => {}} />);
    await act(async () => { await flushPromises(); });
    const conversation = host.querySelector<HTMLButtonElement>('.conversation-item-button')!;
    await act(async () => {
      conversation.click();
      await flushPromises();
      await flushPromises();
    });

    const modelPill = host.querySelector<HTMLButtonElement>('.message-assistant .message-model-pill');
    expect(modelPill?.textContent).toContain('Unrecognized model: gemini-4.2-flash');
    act(() => modelPill?.click());
    const metadata = host.querySelector('.message-assistant .metadata-popover')!;
    expect(metadata.textContent).toContain('Server model IDgemini-4.2-flash');
    expect(metadata.textContent).toContain('Router rationalecode_detected');
    expect(metadata.querySelector('.route-explanation')).toBeNull();
    expect(metadata.textContent).not.toContain('gemini-3.8-flash');
  });

  it('resets conversation state cleanly when clicking New Chat', async () => {
    root = renderInto(host, <ChatInterface user={TEST_USER} onSignOut={async () => {}} />);
    await act(async () => {
      await flushPromises();
    });

    const newChatBtn = host.querySelector('.conversation-new-button') as HTMLButtonElement;
    expect(newChatBtn).not.toBeNull();

    act(() => {
      newChatBtn.click();
    });

    // Messages container is empty
    const messages = host.querySelectorAll('.message');
    expect(messages.length).toBe(0);

    // Initial empty state is visible
    expect(host.querySelector('.empty-state')).not.toBeNull();
    expect(host.querySelector('.prompt-starters-section')).not.toBeNull();
  });
});
