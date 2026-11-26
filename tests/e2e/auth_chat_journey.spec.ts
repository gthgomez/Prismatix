// Scripted authenticated chat journey against mock/local test provider.
// Covers: resume conversation, attach document, grounded sources, provider
// unavailability recovery, and reload without losing authorized session.

import { test, expect } from '@playwright/test';
import { MOCK_SESSION, MOCK_USER, setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

const GROUNDED_CONVERSATION = {
  id: 'c1111111-1111-4111-8111-111111111111',
  title: 'Grounded Doc Q&A',
  last_activity_at: new Date().toISOString(),
  project_id: 'proj-synth-1',
};

const GROUNDED_MESSAGES = [
  {
    id: 'm1111111-1111-4111-8111-111111111111',
    conversation_id: GROUNDED_CONVERSATION.id,
    role: 'user' as const,
    content: 'What SLA does the runbook require for the router?',
    created_at: new Date(Date.now() - 60_000).toISOString(),
  },
  {
    id: 'm2222222-2222-4222-8222-222222222222',
    conversation_id: GROUNDED_CONVERSATION.id,
    role: 'assistant' as const,
    content: 'The runbook requires a 99.9% monthly SLA for the router edge function [1].',
    created_at: new Date(Date.now() - 50_000).toISOString(),
    metadata: {
      citations: [
        {
          id: 1,
          title: 'Prismatix Router Runbook',
          url: 'https://docs.prismatix.test/runbook',
          domain: 'docs.prismatix.test',
          snippet: 'Router availability target: 99.9% monthly SLA.',
        },
      ],
    },
  },
];

test.describe('Authenticated chat journey (mock provider)', () => {
  test('mobile sign-in announces a slow auth check and restores the shell after reload', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    let releaseAuth!: () => void;
    let signalAuthStarted!: () => void;
    const authGate = new Promise<void>((resolve) => { releaseAuth = resolve; });
    const authStarted = new Promise<void>((resolve) => { signalAuthStarted = resolve; });

    await page.route('**/functions/v1/**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.route('**/rest/v1/**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/functions/v1/provider-settings*', async (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ providers: [], routes: [], defaultProvider: null }),
    }));
    await page.route('**/auth/v1/user*', async (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_USER),
    }));
    await page.route('**/auth/v1/token*', async (route) => {
      signalAuthStarted();
      await authGate;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SESSION) });
    });

    try {
      await page.goto('/');
      await page.locator('#email').fill(MOCK_USER.email);
      await page.locator('#password').fill('synthetic-password');
      const submit = page.getByRole('button', { name: /sign in to prismatix/i });
      await submit.click();
      await authStarted;
      await expect(submit).toBeDisabled();
      await expect(page.getByRole('status').filter({ hasText: 'Signing in…' })).toBeVisible();

      releaseAuth();
      await expect(page.getByRole('textbox', { name: /message prismatix/i })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#email')).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole('textbox', { name: /message prismatix/i })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#email')).toHaveCount(0);
    } finally {
      releaseAuth();
    }
  });

  test('timed-out sign-in stays recoverable and a late response cannot replace the retry session', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 393, height: 851 });
    let releaseLateResponse!: () => void;
    let signalFirstAttempt!: () => void;
    const lateResponseGate = new Promise<void>((resolve) => { releaseLateResponse = resolve; });
    const firstAttemptStarted = new Promise<void>((resolve) => { signalFirstAttempt = resolve; });
    const lateUser = { ...MOCK_USER, id: '99999999-9999-4999-8999-999999999999', email: 'late@prismatix.test' };
    const lateSession = { ...MOCK_SESSION, user: lateUser };
    let attempts = 0;

    await page.route('**/functions/v1/**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.route('**/rest/v1/**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/functions/v1/provider-settings*', async (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ providers: [], routes: [], defaultProvider: null }),
    }));
    await page.route('**/auth/v1/user*', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER) }));
    await page.route('**/auth/v1/token*', async (route) => {
      attempts++;
      if (attempts === 1) {
        signalFirstAttempt();
        await lateResponseGate;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lateSession) }).catch(() => {});
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SESSION) });
    });

    try {
      await page.goto('/');
      await page.locator('#email').fill(MOCK_USER.email);
      await page.locator('#password').fill('synthetic-password');
      const submit = page.getByRole('button', { name: /sign in to prismatix/i });
      await submit.click();
      await firstAttemptStarted;
      await expect(page.getByRole('status').filter({ hasText: 'Signing in…' })).toBeVisible();
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 });
      await expect(submit).toBeEnabled();
      await expect(page.locator('#password')).toHaveValue('synthetic-password');

      releaseLateResponse();
      await expect(page.locator('#email')).toBeVisible();
      await page.waitForTimeout(250);
      await expect(page.getByRole('textbox', { name: /message prismatix/i })).toHaveCount(0);

      await submit.click();
      await expect(page.getByRole('textbox', { name: /message prismatix/i })).toBeVisible({ timeout: 15000 });
      await page.getByRole('button', { name: 'Account menu' }).click();
      await expect(page.locator('.user-dropdown')).toContainText(MOCK_USER.email);
      await expect(page.locator('.user-dropdown')).not.toContainText(lateUser.email);
    } finally {
      releaseLateResponse();
    }
  });

  test('stalled refresh ends initialization with a retry option and keeps the saved session', async ({ page }) => {
    test.setTimeout(60_000);
    const expiredSession = { ...MOCK_SESSION, expires_at: Math.floor(Date.now() / 1000) - 60 };
    await page.clock.install();
    await setupAuthenticatedMock(page, {
      conversations: [], messages: [], authSession: expiredSession,
      additionalAuthStorageKeys: ['sb-synthetic-test-auth-token', 'sb-prismatix-fixture-auth-token'],
    });
    let retryAllowed = false;
    let releaseStalledRequests!: () => void;
    const stalledRequests = new Promise<void>((resolve) => { releaseStalledRequests = resolve; });
    let refreshAttempts = 0;
    let successfulRetryResponses = 0;
    let sessionStorageKey = '';
    await page.route('**/auth/v1/token*', async (route) => {
      refreshAttempts++;
      sessionStorageKey = `sb-${new URL(route.request().url()).hostname.split('.')[0]}-auth-token`;
      if (!retryAllowed) {
        await stalledRequests;
        await route.abort().catch(() => {});
        return;
      }
      try {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SESSION) });
        successfulRetryResponses++;
      } catch {
        // An aborted request cannot establish a session.
      }
    });

    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('This can take a little while on a slow connection.');
    await expect.poll(() => refreshAttempts).toBeGreaterThan(0);
    // The SDK retries internally; advance its clock rather than waiting through
    // multiple real network deadlines in every CI run.
    await page.clock.runFor(90_000);
    await expect(page.getByRole('button', { name: 'Retry session check' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('could not verify your saved session');
    const storedSession = await page.evaluate((key) => localStorage.getItem(key), sessionStorageKey);
    expect(storedSession).not.toBeNull();
    expect(storedSession).toContain('mock-playwright-refresh');
    await page.clock.resume();
    const attemptsBeforeRetry = refreshAttempts;
    await page.getByRole('button', { name: 'Retry session check' }).click();
    retryAllowed = true;
    releaseStalledRequests();
    await expect.poll(() => refreshAttempts).toBeGreaterThan(attemptsBeforeRetry);
    await expect.poll(() => successfulRetryResponses).toBeGreaterThan(0);
    await expect(page.getByRole('textbox', { name: /message prismatix/i })).toBeVisible({ timeout: 15_000 });
  });

  test('confirmed saved response clears recovery and chat continues after reload', async ({ page }) => {
    await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [], costLogs: [] });
    let conversation: Record<string, unknown> | null = null;
    let messages: Array<Record<string, unknown>> = [];
    const requests: Array<Record<string, unknown>> = [];

    await page.route('**/rest/v1/conversations*', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(conversation ? [conversation] : []) });
      }
      if (method === 'POST') {
        const row = route.request().postDataJSON() as Record<string, unknown>;
        conversation = { ...row, last_activity_at: new Date().toISOString() };
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([conversation]) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(conversation ? [conversation] : []) });
    });
    await page.route('**/rest/v1/messages*', async (route) => {
      const url = new URL(route.request().url());
      const id = url.searchParams.get('conversation_id')?.replace(/^eq\./, '');
      const rows = messages.filter((message) => !id || message.conversation_id === id);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    });
    await page.route('**/functions/v1/router*', async (route) => {
      const request = route.request().postDataJSON() as Record<string, unknown>;
      requests.push(request);
      const conversationId = String(request.conversationId);
      const prompt = String(request.query);
      const executionId = `saved-turn-${requests.length}`;
      const timestamp = new Date().toISOString();
      conversation = { id: conversationId, title: prompt, last_activity_at: timestamp, project_id: null };
      messages = [
        { id: `user-${requests.length}`, conversation_id: conversationId, role: 'user', content: prompt, created_at: timestamp, execution_id: executionId },
        { id: `assistant-${requests.length}`, conversation_id: conversationId, role: 'assistant', content: `Confirmed saved reply ${requests.length}`, created_at: new Date(Date.now() + 1).toISOString(), execution_id: executionId, model_used: 'openrouter/gemini-3.8-flash' },
      ];
      const events = [
        { type: 'meta', model: 'gemini-3.8-flash' },
        { type: 'content_block_delta', delta: { text: `Confirmed saved reply ${requests.length}` } },
        { type: 'receipt', executionId, status: 'completed', transcript: { saved: true }, settlement: { state: 'settled', committedUsd: 0.0001, pendingCalls: 0 }, calls: [{ stage: 'baseline', participant: 'openrouter', attemptNumber: 1, servedModel: 'gemini-3.8-flash', costStatus: 'settled', totalCost: 0.0001 }] },
      ];
      const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
      return route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Access-Control-Expose-Headers': 'X-Router-Model, X-Provider, X-Prismatix-Execution-Id',
          'X-Router-Model': 'gemini-3.8-flash',
          'X-Provider': 'openrouter',
          'X-Prismatix-Execution-Id': executionId,
        },
        body,
      });
    });

    await signInAsMockUser(page);
    const composer = page.getByRole('textbox', { name: /message prismatix/i });
    await composer.fill('First confirmed saved turn');
    await composer.press('Enter');
    await expect(page.getByText('Confirmed saved reply 1')).toBeVisible();
    await expect(page.locator('.draft-recovery-bar')).toHaveCount(0);
    expect(requests).toHaveLength(1);

    await page.reload();
    await expect(composer).toBeVisible();
    await expect(page.getByText('Confirmed saved reply 1')).toBeVisible();
    await expect(page.locator('.draft-recovery-bar')).toHaveCount(0);
    expect(requests).toHaveLength(1);

    await composer.fill('Continue after confirmed history reload');
    await composer.press('Enter');
    await expect(page.getByText('Confirmed saved reply 2')).toBeVisible();
    await expect(page.locator('.draft-recovery-bar')).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.query)).toEqual([
      'First confirmed saved turn',
      'Continue after confirmed history reload',
    ]);
  });

  test('direct account switch clears the previous transcript and open workspace dialog', async ({ page }) => {
    const conversationId = '33333333-3333-4333-8333-333333333333';
    const userB = { ...MOCK_USER, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'account-b@prismatix.test' };
    const sessionB = { ...MOCK_SESSION, access_token: 'mock-account-b-token', user: userB };
    let deniedBLoads = 0;
    await setupAuthenticatedMock(page, {
      conversations: [{ id: conversationId, title: 'Account A chat', last_activity_at: new Date().toISOString() }],
      messages: [{ id: 'private-a', conversation_id: conversationId, role: 'user', content: 'Account A private transcript', created_at: new Date().toISOString() }],
    });
    await page.addInitScript(({ userA, userBId, id }) => {
      localStorage.setItem(`prismatix_selected_conversation_${userA}`, id);
      localStorage.setItem(`prismatix_selected_conversation_${userBId}`, id);
    }, { userA: MOCK_USER.id, userBId: userB.id, id: conversationId });
    await page.route('**/rest/v1/messages*', async (route) => {
      if (route.request().headers().authorization?.includes('mock-account-b-token')) {
        deniedBLoads++;
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'not authorized' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { id: 'private-a', conversation_id: conversationId, role: 'user', content: 'Account A private transcript', created_at: new Date().toISOString() },
      ]) });
    });
    await signInAsMockUser(page);
    await expect(page.getByText('Account A private transcript')).toBeVisible();
    await page.getByRole('button', { name: /generate image/i }).click();
    await expect(page.locator('.image-generation-modal')).toBeVisible();

    await page.evaluate((session) => {
      const key = 'sb-prismatix-fixture-auth-token';
      localStorage.setItem(key, JSON.stringify(session));
      const channel = new BroadcastChannel(key);
      channel.postMessage({ event: 'SIGNED_IN', session });
      channel.close();
    }, sessionB);

    await expect(page.locator('.image-generation-modal')).toHaveCount(0);
    await expect.poll(() => deniedBLoads).toBeGreaterThan(0);
    await expect(page.getByText('Account A private transcript')).toHaveCount(0);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.locator('.user-dropdown')).toContainText(userB.email);
  });

  test('resume chat, attach document, inspect sources, recover provider outage, reload session', async ({
    page,
    isMobile,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await setupAuthenticatedMock(page, {
      hasProviderKey: true,
      conversations: [GROUNDED_CONVERSATION],
      messages: GROUNDED_MESSAGES,
      projects: [
        {
          id: 'proj-synth-1',
          name: 'Synthetic Ops Docs',
          description: 'Disposable fixture workspace',
          instructions: 'Answer only from attached runbook excerpts.',
          archived: false,
          created_at: new Date().toISOString(),
        },
      ],
    });

    // Messages mock in fixture filters by conversation_id query; extend metadata pass-through
    // by fulfilling messages with the grounded rows (setup already seeded GROUNDED_MESSAGES).
    await signInAsMockUser(page);

    // Authorized shell
    await expect(page.getByRole('textbox', { name: /message prismatix/i })).toBeVisible();

    if (isMobile) {
      const toggle = page.locator('button[aria-label="Toggle conversations sidebar"]');
      if (await toggle.isVisible()) {
        await toggle.click();
      }
    }

    // Resume existing conversation
    await expect(page.getByText('Grounded Doc Q&A')).toBeVisible();
    await page.getByText('Grounded Doc Q&A').click();
    await expect(page.getByText(/99\.9% monthly SLA/i)).toBeVisible();

    // Inspect grounded source citations mapped from message.metadata.citations.
    const sources = page.locator('.message-citations-container');
    await expect(sources.first()).toBeVisible();
    await expect(sources.first()).toContainText(/Sources/i);
    await expect(sources.first()).toContainText(/docs\.prismatix\.test/i);

    // Attach a controlled document and verify composer attachment chrome.
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);
    await fileInput.setInputFiles({
      name: 'router-runbook.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Router Runbook\n\nAvailability target: 99.9% monthly SLA.\n'),
    });
    await expect(page.getByText('1 file attached')).toBeVisible();
    await expect(page.locator('.draft-filename')).toContainText(/router-runbook/i);

    // Provider unavailable: failed send must restore draft (existing F02 contract).
    await page.route('**/functions/v1/router*', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Router temporarily unavailable' }),
      });
    });

    const composer = page.getByRole('textbox', { name: /message prismatix/i });
    const prompt = 'Confirm the router SLA from the attached runbook.';
    await composer.fill(prompt);
    await page.locator('button[aria-label="Send message"]').click();

    const recovery = page.locator('.draft-recovery-bar');
    await expect(recovery).toBeVisible();
    await expect(recovery).toContainText(/Send failed/i);
    await recovery.getByRole('button', { name: /restore draft/i }).click();
    await expect(composer).toHaveValue(prompt);
    await expect(composer).toBeFocused();

    // Reload must keep authorized session (mock storage + auth routes).
    await page.reload();
    await expect(page.getByRole('textbox', { name: /message prismatix/i })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('#email')).toHaveCount(0);
    await expect(page.locator('.user-button')).toBeVisible();
  });
});
