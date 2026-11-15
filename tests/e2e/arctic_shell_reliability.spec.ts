import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

const successfulStream = (text: string, executionId: string) => ({
  status: 200,
  headers: { 'Content-Type': 'text/event-stream', 'X-Router-Model': 'gemini-3.8-flash', 'X-Provider': 'mock', 'X-Prismatix-Execution-Id': executionId },
  body: [
    { type: 'meta', model: 'gemini-3.8-flash', cost: { finalUsd: 0.0001 } },
    { type: 'content_block_delta', delta: { text } },
    { type: 'receipt', executionId, status: 'completed' },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
});

test('Arctic shell persists through send and history; saved-chat layout has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  let count = 0;
  await page.route('**/functions/v1/router*', async (route) => {
    count++;
    await route.fulfill(successfulStream('One local mock reply', `shell-${count}`));
  });
  await signInAsMockUser(page);
  const root = page.locator('.arctic-workbench');
  await expect(root).toHaveClass(/arctic-new-chat/);
  const header = page.locator('.chat-header');
  await header.evaluate((el) => { el.setAttribute('data-shell-node-marker', 'stable'); });
  await page.getByRole('textbox', { name: 'Message Prismatix' }).fill('ordinary local fixture');
  await page.getByRole('textbox', { name: 'Message Prismatix' }).press('Enter');
  await expect(page.getByText('One local mock reply')).toBeVisible();
  await expect(root).toHaveClass(/arctic-new-chat/);
  await expect(header).toHaveAttribute('data-shell-node-marker', 'stable');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  expect(count).toBe(1);
});

for (const code of ['provider_key_required', 'provider_key_unavailable']) {
  test(`early ${code} response preserves draft without adding a fake chat turn`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
    let requests = 0;
    await page.route('**/functions/v1/router*', async (route) => {
      requests++;
      if (requests === 1) {
        await route.fulfill({ status: code === 'provider_key_unavailable' ? 503 : 400, contentType: 'application/json', body: JSON.stringify({ error: code }) });
        return;
      }
      await route.fulfill(successfulStream('Recovered mock response', `${code}-retry`));
    });
    await signInAsMockUser(page);
    const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
    await composer.fill('Keep this exact draft');
    await composer.press('Enter');
    await expect(page.getByRole('alert')).toContainText('Send failed');
    await expect(composer).toHaveValue('Keep this exact draft');
    await expect(page.locator('.messages-list .message')).toHaveCount(0);
    await expect(page.locator('.arctic-workbench')).toHaveClass(/arctic-new-chat/);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByText('Recovered mock response')).toBeVisible();
    await expect(page.locator('.arctic-workbench')).toHaveClass(/arctic-new-chat/);
    expect(requests).toBe(2);
  });
}

test('provider settings lookup failure blocks send, keeps draft, and retry refreshes state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  let checks = 0;
  await page.route('**/functions/v1/provider-settings*', async (route) => {
    checks++;
    if (checks === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'temporary unavailable' }) });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [{ id: 'openrouter', label: 'OpenRouter', enabled: true, hasKey: true, status: 'enabled' }], defaultProvider: 'openrouter' }) });
    }
  });
  let sends = 0;
  await page.route('**/functions/v1/router*', async (route) => {
    sends++;
    await route.fulfill(successfulStream('Ready after retry', 'settings-retry'));
  });
  await signInAsMockUser(page);
  await expect(page.getByRole('alert')).toContainText('Could not check provider setup');
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Draft survives a lookup failure');
  await composer.press('Enter');
  expect(sends).toBe(0);
  await expect(composer).toHaveValue('Draft survives a lookup failure');
  await page.getByRole('button', { name: 'Retry provider check' }).click();
  await expect(page.getByRole('heading', { name: 'What can I help you with?' })).toBeVisible();
  await composer.press('Enter');
  await expect(page.getByText('Ready after retry')).toBeVisible();
  expect(sends).toBe(1);
});

test('unconfigured first run keeps setup above a disabled composer and makes no router call', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await setupAuthenticatedMock(page, { hasProviderKey: false, conversations: [], messages: [] });
  let sends = 0;
  await page.route('**/functions/v1/router*', async (route) => {
    sends++;
    await route.fulfill(successfulStream('unexpected', 'no-key'));
  });
  await signInAsMockUser(page);
  await expect(page.locator('.first-run-card')).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  const prompt = 'Preserve this until a route is configured';
  await composer.fill(prompt);
  await composer.press('Enter');
  expect(sends).toBe(0);
  await expect(composer).toHaveValue(prompt);
  const setupBox = await page.locator('.first-run-card').boundingBox();
  const composerBox = await page.locator('.chat-input-container').boundingBox();
  expect(setupBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(setupBox!.y + setupBox!.height).toBeLessThanOrEqual(composerBox!.y + 1);
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(600);
  const evidenceDir = process.env.UI_BENCHMARK_EVIDENCE_DIR ?? testInfo.outputPath();
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: `${evidenceDir}/first-run-setup-1024x600.png` });
});

test('hidden sidebar and zoom-equivalent CSS viewports keep the composer in the available pane', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('prismatix.sidebar.chatsHidden', '1'));
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  await signInAsMockUser(page);
  for (const viewport of [{ width: 1152, height: 720, zoom: 1.25 }, { width: 960, height: 600, zoom: 1.5 }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect.poll(() => page.evaluate(() => Math.abs(
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-vh')) * 100 - window.innerHeight
    ))).toBeLessThan(1);
    const geometry = await page.evaluate(() => {
      const root = document.querySelector('.arctic-workbench')!;
      const chat = document.querySelector('.chat-container')!;
      const composer = document.querySelector('.chat-input-container')!.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        rootWidth: root.getBoundingClientRect().width,
        chatClientWidth: chat.clientWidth,
        chatScrollWidth: chat.scrollWidth,
        composerBottom: composer.bottom,
        viewportHeight: window.innerHeight,
      };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.rootWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.chatScrollWidth).toBeLessThanOrEqual(geometry.chatClientWidth + 1);
    expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    await expect(page.getByRole('textbox', { name: 'Message Prismatix' })).toBeVisible();
  }
});

test('history failure keeps cached rows and Retry retains the selected workspace filter', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const chats = [
    { id: 'workspace-a-chat', title: 'Workspace A chat', last_activity_at: '2026-11-14T10:00:00.000Z', project_id: null },
    { id: 'workspace-b-chat', title: 'Workspace B chat', last_activity_at: '2026-11-15T10:00:00.000Z', project_id: 'project-b' },
  ];
  await setupAuthenticatedMock(page, {
    hasProviderKey: true,
    conversations: chats,
    messages: [],
    projects: [{ id: 'project-b', name: 'Workspace B', description: '', instructions: '', archived: false, created_at: '2026-11-01T00:00:00.000Z' }],
  });
  const requests: string[] = [];
  let filteredCalls = 0;
  await page.route('**/rest/v1/conversations*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    const url = new URL(route.request().url());
    const filter = url.searchParams.get('project_id');
    requests.push(filter ?? 'all');
    if (filter === 'eq.project-b') {
      filteredCalls++;
      if (filteredCalls === 1) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'history unavailable' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([chats[1]]) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(chats) });
  });
  await signInAsMockUser(page);
  const sidebar = page.locator('.conversation-sidebar');
  await expect(sidebar.getByRole('button', { name: /^Workspace A chat/ })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: /^Workspace B chat/ })).toBeVisible();
  await sidebar.getByLabel('Filter by project workspace').selectOption('project-b');
  await expect(sidebar.getByRole('alert')).toContainText('Your loaded history is still available');
  await expect(sidebar.getByRole('button', { name: /^Workspace A chat/ })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: /^Workspace B chat/ })).toBeVisible();
  await sidebar.getByRole('button', { name: 'Retry' }).click();
  await expect(sidebar.getByRole('button', { name: /^Workspace B chat/ })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: /^Workspace A chat/ })).toHaveCount(0);
  expect(requests.filter((filter) => filter === 'eq.project-b')).toHaveLength(2);
  expect(requests[requests.length - 1]).toBe('eq.project-b');
});

test('mobile keyboard-height viewport keeps Connect and composer within the visible area', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 550 });
  await setupAuthenticatedMock(page, { hasProviderKey: false, conversations: [], messages: [] });
  await signInAsMockUser(page);
  await expect(page.locator('.first-run-card')).toBeVisible();
  const bounds = await page.evaluate(() => {
    const composer = document.querySelector('.chat-input-container')!.getBoundingClientRect();
    const setup = document.querySelector('.first-run-card')!;
    return {
      width: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      bottom: composer.bottom,
      viewportHeight: window.innerHeight,
      setupCanScroll: setup.scrollHeight > setup.clientHeight,
    };
  });
  expect(bounds.width).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight + 1);
  expect(bounds.setupCanScroll).toBe(true);
  await expect(page.getByRole('button', { name: 'Configure Other Providers (Anthropic, OpenAI, Google) →' })).toBeAttached();
});

test('saved history exposes provider-check retry and keeps drafts blocked until readiness recovers', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await setupAuthenticatedMock(page, { hasProviderKey: true });
  let check = 0;
  await page.route('**/functions/v1/provider-settings*', async (route) => {
    check++;
    if (check === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'temporary unavailable' }) });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [{ id: 'openrouter', label: 'OpenRouter', enabled: true, hasKey: true, status: 'enabled' }], defaultProvider: 'openrouter' }) });
    }
  });
  let sends = 0;
  await page.route('**/functions/v1/router*', async (route) => {
    sends++;
    await route.fulfill(successfulStream('Saved chat recovered', 'saved-ready'));
  });
  await signInAsMockUser(page);
  await page.getByRole('button', { name: /^Architectural Discussion/ }).click();
  await expect(page.locator('.provider-readiness-banner')).toContainText('Could not check provider setup');
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Saved chat draft');
  await composer.press('Enter');
  expect(sends).toBe(0);
  await expect(composer).toHaveValue('Saved chat draft');
  await page.getByRole('button', { name: 'Retry check' }).click();
  await expect(page.locator('.provider-readiness-banner')).toHaveCount(0);
  await composer.press('Enter');
  await expect(page.getByText('Saved chat recovered')).toBeVisible();
  expect(sends).toBe(1);
});

test('a saved but unverified provider stays distinct from ready route status', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupAuthenticatedMock(page, { hasProviderKey: false, conversations: [], messages: [] });
  await page.route('**/functions/v1/provider-settings*', async (route) => {
    const body = route.request().method() === 'POST'
      ? route.request().postDataJSON() as Record<string, unknown>
      : {};
    if (body.action === 'validate_key') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'openrouter', status: 'unavailable', message: 'metadata check unavailable' }) });
      return;
    }
    if (body.action === 'set_key') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [{ id: 'openrouter', label: 'OpenRouter', enabled: true, hasKey: true, keyLast4: '0715', status: 'enabled' }], defaultProvider: 'openrouter' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [], defaultProvider: 'openrouter' }) });
  });
  await signInAsMockUser(page);
  await page.locator('#first-run-openrouter-key').fill('sk-or-synthetic-unverified-0715');
  await page.getByRole('button', { name: 'Connect & Start' }).click();
  const routeStatus = page.locator('.arctic-route-status');
  await expect(routeStatus).toContainText('Key saved · not verified');
  await expect(routeStatus).toHaveClass(/setup/);
});
