import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

const GENERATED_REPLY = 'Fixture generated reply: your synthetic request completed successfully.';
const EXECUTION_ID = '00000000-0000-4000-8000-000000000701';

test('verified first-run connection sends once and reloads fixture-persisted output', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const mobile = testInfo.project.name === 'mobile';
  const viewport = mobile ? { width: 393, height: 851 } : { width: 1024, height: 600 };
  const viewportName = `${viewport.width}x${viewport.height}`;
  await page.setViewportSize(viewport);
  await setupAuthenticatedMock(page, { hasProviderKey: false, conversations: [], messages: [], costLogs: [] });

  // Independent, stateful fixture. The router call creates its own conversation
  // and message rows; nothing is preseeded before the user's UI submission.
  const fixture = {
    connected: false,
    enabled: false,
    conversation: null as null | Record<string, unknown>,
    messages: [] as Array<Record<string, unknown>>,
    routerRequests: [] as Array<Record<string, unknown>>,
  };
  let signalRouterStarted!: () => void;
  let releaseRouterResponse!: () => void;
  const routerStarted = new Promise<void>((resolve) => { signalRouterStarted = resolve; });
  const routerResponseReleased = new Promise<void>((resolve) => { releaseRouterResponse = resolve; });

  await page.route('**/functions/v1/provider-settings*', async (route) => {
    const body = route.request().method() === 'POST'
      ? route.request().postDataJSON() as Record<string, unknown>
      : {};
    if (body.action === 'validate_key' && body.apiKey === 'sk-or-invalid-fixture') {
      return route.fulfill({ json: { provider: 'openrouter', status: 'invalid_revoked' } });
    }
    if (body.action === 'validate_key') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'openrouter', status: 'enabled' }) });
    }
    if (body.action === 'set_key') {
      fixture.connected = true;
      fixture.enabled = true;
    }
    if (body.action === 'set_enabled') fixture.enabled = Boolean(body.enabled);
    if (body.action === 'delete_key') {
      fixture.connected = false;
      fixture.enabled = false;
    }
    const providers = fixture.connected
      ? [{ id: 'openrouter', label: 'OpenRouter', enabled: fixture.enabled, hasKey: true, keyLast4: '0701', offeredByDefault: true, defaultProvider: true, status: 'enabled' }]
      : [{ id: 'openrouter', label: 'OpenRouter', enabled: false, hasKey: false, keyLast4: null, offeredByDefault: true, defaultProvider: true, status: 'not_configured' }];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers, defaultProvider: 'openrouter' }) });
  });

  await page.route('**/rest/v1/conversations*', async (route) => {
    if (route.request().method() === 'GET') {
      const row = fixture.conversation;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(row ? [{ ...row, messages: [{ content: fixture.messages.find((m) => m.role === 'user')?.content }] }] : []),
      });
    }
    if (route.request().method() === 'PATCH' && fixture.conversation) {
      Object.assign(fixture.conversation, route.request().postDataJSON());
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/rest/v1/messages*', async (route) => {
    const url = new URL(route.request().url());
    const filter = url.searchParams.get('conversation_id')?.replace(/^eq\./, '');
    const rows = fixture.messages.filter((message) => !filter || message.conversation_id === filter);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(url.searchParams.get('order')?.includes('created_at.desc') ? [...rows].reverse() : rows),
    });
  });

  await page.route('**/functions/v1/router*', async (route) => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    fixture.routerRequests.push(request);
    const conversationId = String(request.conversationId);
    const prompt = String(request.query);
    const now = new Date().toISOString();
    fixture.conversation = {
      id: conversationId,
      title: prompt,
      last_activity_at: now,
      project_id: null,
    };
    fixture.messages = [
      { id: 'fixture-user-0701', conversation_id: conversationId, role: 'user', content: prompt, created_at: now, attachments: [], execution_id: EXECUTION_ID },
      { id: 'fixture-assistant-0701', conversation_id: conversationId, role: 'assistant', content: GENERATED_REPLY, created_at: new Date(Date.now() + 1).toISOString(), attachments: [], execution_id: EXECUTION_ID, model_used: 'openrouter/gemini-3.8-flash' },
    ];
    const events = [
      { type: 'meta', model: 'gemini-3.8-flash' },
      { type: 'content_block_delta', delta: { text: GENERATED_REPLY } },
      { type: 'receipt', executionId: EXECUTION_ID, status: 'completed', settlement: { state: 'settled', committedUsd: 0, pendingCalls: 0 }, calls: [] },
    ];
    const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
    signalRouterStarted();
    await routerResponseReleased;
    return route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Router-Model': 'gemini-3.8-flash',
        'X-Provider': 'openrouter',
        'X-Prismatix-Execution-Id': EXECUTION_ID,
      },
      body,
    });
  });

  const outputDir = process.env.UI_BENCHMARK_EVIDENCE_DIR ?? testInfo.outputPath();
  await mkdir(outputDir, { recursive: true });
  const tracePath = `${outputDir}/connection-journey.zip`;
  const capture = async (name: string) => page.screenshot({ path: `${outputDir}/${name}.png` });
  const assertAccountControlFits = async () => {
    await expect.poll(() => page.evaluate(() => {
      const header = document.querySelector<HTMLElement>('.chat-header')!;
      const messages = document.querySelector<HTMLElement>('.chat-messages')!;
      const account = document.querySelector<HTMLElement>('.user-button')!;
      const headerBox = header.getBoundingClientRect();
      const accountBox = account.getBoundingClientRect();
      const hit = document.elementFromPoint(accountBox.left + accountBox.width / 2, accountBox.top + accountBox.height / 2);
      return headerBox.left >= -1 && headerBox.right <= window.innerWidth + 1
        && header.scrollWidth <= header.clientWidth + 1
        && headerBox.bottom <= messages.getBoundingClientRect().top + 1
        && accountBox.left >= -1 && accountBox.right <= window.innerWidth + 1
        && (hit === account || account.contains(hit)) ? 'ok' : JSON.stringify({headerBox: {left: headerBox.left, right: headerBox.right, top: headerBox.top, bottom: headerBox.bottom, clientHeight: header.clientHeight, scrollHeight: header.scrollHeight}, messagesTop: messages.getBoundingClientRect().top, accountBox: {left: accountBox.left, right: accountBox.right}, hit: (hit as HTMLElement | null)?.className});
    })).toBe('ok');
    const accountMenu = page.getByRole('button', { name: 'Account menu' });
    await accountMenu.click();
    await expect(page.locator('.user-dropdown')).toBeVisible();
    await accountMenu.click();
  };
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  await signInAsMockUser(page);
  await expect(page.locator('.first-run-card')).toBeVisible();
  await capture(`transition-first-run-${viewportName}`);

  // Settings dialog restores focus to the first-run trigger when closed.
  const settingsTrigger = page.getByRole('button', { name: /Use another provider/i });
  await settingsTrigger.focus();
  await settingsTrigger.click();
  const dialog = page.getByRole('dialog', { name: 'Provider plug-ins' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close provider plug-ins' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Close provider plug-ins' }).click();
  await expect(settingsTrigger).toBeFocused();
  const demo = page.getByRole('link', { name: 'Try the public demo' });
  await demo.scrollIntoViewIfNeeded();
  await expect(demo).toBeInViewport();
  const keyInput = page.locator('#first-run-openrouter-key');
  await keyInput.fill('sk-or-invalid-fixture');
  await page.getByRole('button', { name: 'Connect provider' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Key rejected' })).toBeVisible();
  await expect(keyInput).toHaveAttribute('aria-invalid', 'true');
  expect(fixture.connected).toBe(false);

  await page.locator('#first-run-openrouter-key').fill('sk-or-synthetic-fixture-0701');
  await page.getByRole('button', { name: 'Connect provider' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Key saved and verified/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /message prismatix/i })).toBeFocused();
  await expect(page.locator('.first-run-card')).toHaveCount(0);
  await capture(`transition-configured-${viewportName}`);

  const prompt = 'Return a short synthetic confirmation.';
  await page.getByRole('textbox', { name: /message prismatix/i }).fill(prompt);
  await page.getByRole('button', { name: 'Send message' }).click();
  await routerStarted;
  await capture(`transition-streaming-${viewportName}`);
  releaseRouterResponse();
  await expect(page.getByText(GENERATED_REPLY)).toBeVisible({ timeout: 15000 });
  await assertAccountControlFits();
  await capture(`transition-reply-${viewportName}`);
  expect(fixture.routerRequests).toHaveLength(1);
  expect(fixture.routerRequests[0]?.query).toBe(prompt);
  expect(fixture.conversation).not.toBeNull();
  expect(fixture.messages.map((message) => message.content)).toContain(GENERATED_REPLY);

  // A later key removal must not leave the old ready-to-chat notice displayed.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.locator('.user-dropdown').getByRole('button', { name: 'Provider plug-ins' }).click();
  const settings = page.getByRole('dialog', { name: 'Provider plug-ins' });
  await settings.getByRole('button', { name: 'Remove' }).click();
  await expect(settings.getByText('Not configured')).toBeVisible();
  await expect.soft(page.getByRole('status').filter({ hasText: /Key saved and verified/ })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Close provider plug-ins' }).click();

  await page.reload();
  await expect(page.getByRole('textbox', { name: /message prismatix/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(GENERATED_REPLY)).toBeVisible({ timeout: 15000 });
  await assertAccountControlFits();
  await capture(`transition-reload-${viewportName}`);
  expect(fixture.routerRequests).toHaveLength(1);
  expect(fixture.messages[0]?.conversation_id).toBe(fixture.conversation?.id);
  expect(fixture.conversation?.id).toMatch(/^[0-9a-f-]{36}$/i);

  await page.context().tracing.stop({ path: tracePath });
  await testInfo.attach('connection-journey-trace', { path: tracePath, contentType: 'application/zip' });
});

test('history distinguishes loading, failure, and a successfully empty result', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await setupAuthenticatedMock(page, { hasProviderKey: false, conversations: [], messages: [] });
  let releaseList!: () => void;
  const listHeld = new Promise<void>((resolve) => { releaseList = resolve; });
  let allowSuccess = false;
  await page.route('**/rest/v1/conversations*', async (route) => {
    if (route.request().method() !== 'GET' || allowSuccess) return route.fallback();
    await listHeld;
    return route.fulfill({ status: 503, json: { message: 'Synthetic history outage' } });
  });

  await signInAsMockUser(page);
  const history = page.locator('.conversation-sidebar');
  try {
    await expect(history.getByRole('status').filter({ hasText: 'Loading' })).toBeVisible();
    await expect(history.getByText('No conversations yet')).toHaveCount(0);
  } finally {
    releaseList();
  }
  await expect(history.getByRole('alert')).toContainText('Could not load conversations');
  await expect(history.getByText('No conversations yet')).toHaveCount(0);
  allowSuccess = true;
  await history.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(history.getByText('No conversations yet')).toBeVisible();
});

test('first run directs users to a saved but disabled provider instead of prompting for another key', async ({ page }, testInfo) => {
  await setupAuthenticatedMock(page, { hasProviderKey: false, conversations: [], messages: [] });
  await page.route('**/functions/v1/provider-settings*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        providers: [{
          id: 'openrouter',
          label: 'OpenRouter',
          enabled: false,
          hasKey: true,
          keyLast4: '1234',
          offeredByDefault: true,
          defaultProvider: true,
          status: 'disabled',
        }],
        defaultProvider: 'openrouter',
      }),
    });
  });

  await signInAsMockUser(page);
  const setup = page.locator('.first-run-card');
  await expect(setup.getByRole('heading', { name: 'OpenRouter is saved but turned off' })).toBeVisible();
  await expect(setup.locator('#first-run-openrouter-key')).toHaveCount(0);
  const { violations } = await new AxeBuilder({ page }).include('.first-run-card').analyze();
  expect(violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);
  const evidenceDir = process.env.UI_BENCHMARK_EVIDENCE_DIR ?? testInfo.outputPath();
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: `${evidenceDir}/first-run-saved-disabled-1024x600.png`, animations: 'disabled' });
  await setup.getByRole('button', { name: 'Open Provider Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Provider plug-ins' });
  await expect(settings).toBeVisible();
  await expect(settings.getByText('Off', { exact: true })).toBeVisible();
});
