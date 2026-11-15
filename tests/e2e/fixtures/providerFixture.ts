// tests/e2e/fixtures/providerFixture.ts
// Controlled, stateful provider/conversation fixture for the first-run journey.
// It builds on the shared mockAuth fixture, tracks provider RPC calls, and
// persists router submissions so reload assertions use real history state.

import type { Page, Route } from '@playwright/test';
import { setupAuthenticatedMock, MOCK_USER, type MockAppOptions } from './mockAuth';

export type ValidationMode = 'verified' | 'rejected' | 'unavailable' | 'unknown';
export type ListResponse = 'ok' | 'fail';

export interface ControlledJourneyOptions extends MockAppOptions {
  validation?: ValidationMode;
  rejectFirstValidation?: boolean;
  validationDelayMs?: number;
  initialProvider?: { hasKey?: boolean; enabled?: boolean };
  listResponses?: ListResponse[];
  listDelayMs?: number;
  conversations?: Array<{
    id: string;
    title: string;
    last_activity_at: string;
    project_id?: string | null;
  }>;
  messages?: Array<{
    id: string;
    conversation_id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
  }>;
}

interface ProviderRowState {
  id: 'openrouter';
  label: string;
  enabled: boolean;
  hasKey: boolean;
  keyLast4: string | null;
  offeredByDefault: boolean;
  defaultProvider: boolean;
  status: 'not_configured' | 'enabled' | 'disabled';
}

interface JourneyState {
  provider: ProviderRowState;
  conversations: NonNullable<ControlledJourneyOptions['conversations']>;
  messages: NonNullable<ControlledJourneyOptions['messages']>;
  listResponses: ListResponse[];
  listDelayMs: number;
  validation: ValidationMode;
  rejectFirstValidation: boolean;
  validationDelayMs: number;
  validateCalls: number;
  setKeyCalls: number;
  getCalls: number;
  conversationListCalls: number;
  routerCalls: number;
  routerRequests: Array<Record<string, unknown>>;
  assistantReply: string;
}

export interface ControlledJourney {
  state: JourneyState;
  setListResponses: (responses: ListResponse[]) => void;
  setValidation: (mode: ValidationMode) => void;
}

function providerPayload(state: JourneyState) {
  return {
    providers: [{ ...state.provider }],
    defaultProvider: 'openrouter',
  };
}

function listPayload(state: JourneyState, requestUrl: string) {
  const url = new URL(requestUrl);
  const projectFilter = url.searchParams.get('project_id');
  const rows = state.conversations.filter((conversation) => {
    if (projectFilter === null) return true;
    if (projectFilter === 'is.null') return conversation.project_id == null;
    const wanted = projectFilter.replace(/^eq\./, '');
    return conversation.project_id === wanted;
  });
  return rows.map((conversation) => ({
    ...conversation,
    messages: state.messages
      .filter((message) => message.conversation_id === conversation.id && message.role === 'user')
      .slice(0, 1)
      .map((message) => ({ content: message.content })),
  }));
}

export async function setupControlledJourney(
  page: Page,
  options: ControlledJourneyOptions = {},
): Promise<ControlledJourney> {
  const initialProvider = options.initialProvider ?? {};
  const initialHasKey = initialProvider.hasKey ?? false;
  const initialEnabled = initialProvider.enabled ?? false;
  const state: JourneyState = {
    provider: {
      id: 'openrouter',
      label: 'OpenRouter',
      enabled: initialEnabled,
      hasKey: initialHasKey,
      keyLast4: initialHasKey ? '1234' : null,
      offeredByDefault: true,
      defaultProvider: true,
      status: initialHasKey ? (initialEnabled ? 'enabled' : 'disabled') : 'not_configured',
    },
    conversations: options.conversations ?? [],
    messages: options.messages ?? [],
    listResponses: options.listResponses ?? ['ok'],
    listDelayMs: options.listDelayMs ?? 0,
    validation: options.validation ?? 'verified',
    rejectFirstValidation: options.rejectFirstValidation ?? false,
    validationDelayMs: options.validationDelayMs ?? 0,
    validateCalls: 0,
    setKeyCalls: 0,
    getCalls: 0,
    conversationListCalls: 0,
    routerCalls: 0,
    routerRequests: [],
    assistantReply: 'Controlled provider reply: the setup journey is live.',
  };

  await setupAuthenticatedMock(page, {
    ...options,
    hasProviderKey: false,
    conversations: [],
    messages: [],
  });

  const nextListResponse = (): ListResponse => {
    if (state.listResponses.length === 0) return 'ok';
    return state.listResponses.length === 1
      ? state.listResponses[0]!
      : state.listResponses.shift()!;
  };

  // Provider settings: one truthful state machine for GET and all actions.
  await page.route('**/functions/v1/provider-settings*', async (route: Route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      state.getCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(providerPayload(state)),
      });
      return;
    }

    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    const action = String(body.action ?? '');

    if (action === 'validate_key') {
      state.validateCalls += 1;
      if (state.validationDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.validationDelayMs));
      }
      let status: 'enabled' | 'invalid_revoked' | 'unavailable' | 'unknown';
      if (state.rejectFirstValidation && state.validateCalls === 1) {
        status = 'invalid_revoked';
      } else if (state.validation === 'verified') {
        status = 'enabled';
      } else if (state.validation === 'rejected') {
        status = 'invalid_revoked';
      } else if (state.validation === 'unavailable') {
        status = 'unavailable';
      } else {
        status = 'unknown';
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: 'openrouter',
          status,
          message:
            status === 'enabled'
              ? 'OpenRouter key verified'
              : status === 'invalid_revoked'
                ? 'OpenRouter returned 401/403: Key invalid or revoked'
                : status === 'unavailable'
                  ? 'OpenRouter metadata service unavailable'
                  : 'OpenRouter metadata check did not confirm the key',
        }),
      });
      return;
    }

    if (action === 'set_key') {
      state.setKeyCalls += 1;
      const key = typeof body.apiKey === 'string' ? body.apiKey : '';
      state.provider.hasKey = key.length >= 8;
      state.provider.enabled = true;
      state.provider.status = providerStatus(state.provider);
      state.provider.keyLast4 = key.slice(-4) || null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(providerPayload(state)),
      });
      return;
    }

    if (action === 'set_enabled') {
      state.provider.enabled = body.enabled === true;
      state.provider.status = providerStatus(state.provider);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(providerPayload(state)),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(providerPayload(state)),
    });
  });

  // Conversation list: a queue makes failure, retry, and recovery deterministic.
  await page.route('**/rest/v1/conversations*', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
      return;
    }
    state.conversationListCalls += 1;
    if (state.listDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, state.listDelayMs));
    }
    if (nextListResponse() === 'fail') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'controlled conversation list failure' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(listPayload(state, route.request().url())),
    });
  });

  // Message reads come from the same state that the router updates.
  await page.route('**/rest/v1/messages*', async (route: Route) => {
    const request = route.request();
    if (request.method() !== 'GET') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify([{ id: `msg-${Date.now()}`, created_at: new Date().toISOString() }]),
      });
      return;
    }
    const url = new URL(request.url());
    const rawConversationId = url.searchParams.get('conversation_id');
    const conversationId = rawConversationId?.replace(/^eq\./, '');
    const rows = conversationId
      ? state.messages.filter((message) => message.conversation_id === conversationId)
      : state.messages;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rows),
    });
  });

  // Router: stateful fixture, one real UI submission at a time.
  await page.route('**/functions/v1/router*', async (route: Route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.fulfill({ status: 405, body: 'method not allowed' });
      return;
    }
    state.routerCalls += 1;
    const payload = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    state.routerRequests.push(payload);
    const conversationId = String(payload.conversationId ?? '');
    const query = String(payload.originalQuery ?? payload.query ?? '');
    const now = new Date().toISOString();

    if (conversationId && !state.conversations.some((item) => item.id === conversationId)) {
      state.conversations.unshift({
        id: conversationId,
        title: query.slice(0, 80) || 'New Chat',
        last_activity_at: now,
        project_id: null,
      });
    }
    if (conversationId && query) {
      state.messages.push({
        id: `user-${state.routerCalls}`,
        conversation_id: conversationId,
        role: 'user',
        content: query,
        created_at: now,
      });
    }
    const reply = state.assistantReply;
    state.messages.push({
      id: `assistant-${state.routerCalls}`,
      conversation_id: conversationId,
      role: 'assistant',
      content: reply,
      created_at: now,
    });

    const sse = [
      `event: message\ndata: ${JSON.stringify({
        type: 'meta',
        model: 'gemini-3.8-flash',
        cost: { finalUsd: 0.00021 },
      })}\n\n`,
      `event: message\ndata: ${JSON.stringify({
        type: 'content_block_delta',
        delta: { text: reply },
      })}\n\n`,
      'event: message\ndata: [DONE]\n\n',
    ].join('');

    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Router-Model': 'gemini-3.8-flash',
        'X-Router-Model-Id': 'gemini-3.8-flash',
        'X-Provider': 'google',
        'X-Router-Rationale': 'controlled fixture',
        'X-Cost-Estimate-USD': '0.00021',
        'X-Prismatix-Execution-Id': `exec-${state.routerCalls}`,
        'X-Route-Decision': encodeURIComponent(JSON.stringify({
          modelTier: 'gemini-3.8-flash',
          reason: 'controlled fixture',
          selection: 'auto',
          gateway: 'direct_fallback',
          fallbackUsed: false,
          priceKnown: true,
        })),
      },
      body: sse,
    });
  });

  return {
    state,
    setListResponses: (responses) => {
      state.listResponses = [...responses];
    },
    setValidation: (mode) => {
      state.validation = mode;
    },
  };
}

function providerStatus(provider: ProviderRowState): ProviderRowState['status'] {
  if (!provider.hasKey) return 'not_configured';
  return provider.enabled ? 'enabled' : 'disabled';
}

export const FIXTURE_USER_ID = MOCK_USER.id;
