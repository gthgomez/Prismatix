// tests/e2e/first_run_setup_journey.spec.ts
// Focused first-run journey: setup honesty, keyboard recovery, history states,
// and one stateful mocked-provider submission.

import { test, expect, type Page } from '@playwright/test';
import {
  setupControlledJourney,
  type ControlledJourney,
} from './fixtures/providerFixture';
import { signInAsMockUser } from './fixtures/mockAuth';

const SYNTHETIC_KEY = 'sk-or-v1-synthetic-first-run-key';
const CORRECTED_KEY = 'sk-or-v1-synthetic-corrected-key';

async function openJourney(
  page: Page,
  options: Parameters<typeof setupControlledJourney>[1] = {},
): Promise<ControlledJourney> {
  const fixture = await setupControlledJourney(page, options);
  await signInAsMockUser(page);
  await expect(page.locator('.chat-container')).toBeVisible();
  await expect(page.locator('.first-run-card')).toBeVisible();
  await expect(page.locator('#first-run-openrouter-key')).toBeVisible();
  return fixture;
}

async function openChatsIfNeeded(page: Page) {
  const sidebar = page.locator('.conversation-sidebar');
  if (await sidebar.isVisible()) return sidebar;
  await page.getByRole('button', { name: 'Toggle conversations sidebar' }).click();
  await expect(sidebar).toBeVisible();
  return sidebar;
}

async function assertNotCovered(page: Page, selector: string) {
  const element = page.locator(selector);
  const box = await element.boundingBox();
  expect(box, `${selector} must have a layout box`).not.toBeNull();
  const covered = await element.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return 'outside viewport';
    const top = document.elementFromPoint(x, y);
    return top === node || node.contains(top) ? null : top?.className || top?.tagName || 'unknown';
  });
  expect(covered, `${selector} must not be covered`).toBeNull();
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    width: window.innerWidth,
  }));
  expect(overflow.doc).toBeLessThanOrEqual(overflow.width + 1);
  expect(overflow.body).toBeLessThanOrEqual(overflow.width + 1);
}

test.describe('first-run setup journey', () => {
  test('primary setup action is visible at 1440x900 and 1024x600', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'desktop size check');
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1024, height: 600 },
    ]) {
      await page.setViewportSize(viewport);
      await openJourney(page);
      await openChatsIfNeeded(page);
      const card = page.locator('.first-run-card');
      await expect(card).toBeVisible();
      await expect(card.locator('#first-run-openrouter-key')).toBeVisible();
      const submit = card.getByRole('button', { name: /connect/i });
      await expect(submit).toBeVisible();
      const box = await submit.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y, `connect top at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, `connect bottom at ${viewport.width}x${viewport.height}`)
        .toBeLessThanOrEqual(viewport.height);
      await assertNotCovered(page, '.first-run-card .first-run-submit');

      // Alternate providers and the demo stay reachable in the same scroll region.
      const otherProviders = card.getByRole('button', { name: /configure other providers/i });
      await otherProviders.scrollIntoViewIfNeeded();
      await expect(otherProviders).toBeVisible();
      await expect(card.getByRole('link', { name: /demo/i })).toBeVisible();
    }
  });

  test('unavailable validation saves the key but never claims verification', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'desktop state check');
    const fixture = await openJourney(page, { validation: 'unavailable' });
    const card = page.locator('.first-run-card');
    await card.locator('#first-run-openrouter-key').fill(SYNTHETIC_KEY);
    await card.getByRole('button', { name: /connect/i }).click();

    await expect(card).not.toBeVisible();
    const notice = page.getByRole('status', { name: 'Provider setup status' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/saved/i);
    await expect(notice).toContainText(/not verified|unverified/i);
    await expect(notice).not.toContainText(/connected and verified/i);
    expect(fixture.state.validateCalls).toBe(1);
    expect(fixture.state.setKeyCalls).toBe(1);

    // Saved policy is unchanged: the key is enabled and usable, but unverified.
    await expect(page.locator('.chat-container')).not.toHaveClass(/setup-required/);
    await page.getByRole('button', { name: 'Provider plug-ins' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Provider plug-ins' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.provider-state-line')).toContainText(/saved/i);
    await expect(dialog.locator('.provider-state-line')).toContainText(/not verified|unverified/i);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Provider plug-ins' })).toBeFocused();
  });

  test('rejected key keeps input and focus, correction reaches verified', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'desktop keyboard check');
    const fixture = await openJourney(page, {
      validation: 'verified',
      rejectFirstValidation: true,
      validationDelayMs: 350,
    });
    const card = page.locator('.first-run-card');
    const input = card.locator('#first-run-openrouter-key');
    await expect(input).toBeFocused();
    await input.fill(SYNTHETIC_KEY);
    await input.press('Enter');

    await expect(card.locator('form')).toHaveAttribute('aria-busy', 'true');
    await expect(card.getByRole('status')).toContainText(/checking/i);
    await expect(card.getByRole('status')).toBeFocused();

    await expect(card).toBeVisible();
    await expect(card.locator('[role="alert"]')).toContainText(/rejected|invalid|revoked/i);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(SYNTHETIC_KEY);
    expect(fixture.state.setKeyCalls).toBe(0);

    await input.fill(CORRECTED_KEY);
    await input.press('Enter');
    await expect(card).not.toBeVisible();
    const notice = page.getByRole('status', { name: 'Provider setup status' });
    await expect(notice).toContainText(/verified/i);
    await expect(notice).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Start chatting' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('textarea.chat-input')).toBeFocused();
    expect(fixture.state.validateCalls).toBe(2);
    expect(fixture.state.setKeyCalls).toBe(1);
  });

  test('setup mode prioritizes Connect and restores chat controls afterward', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'desktop hierarchy check');
    await openJourney(page);
    const card = page.locator('.first-run-card');
    const toolbar = page.getByRole('toolbar', { name: 'Routing and research controls' });
    await expect(card).toBeVisible();
    await expect(page.locator('.chat-container')).toHaveClass(/setup-required/);
    await expect(toolbar).toBeHidden();
    await expect(page.locator('.empty-state-capabilities')).toBeHidden();

    // Alternate providers, demo, and history remain discoverable.
    await expect(card.getByRole('button', { name: /configure other providers|other providers/i })).toBeVisible();
    await expect(card.getByRole('link', { name: /demo/i })).toBeVisible();
    await expect(page.locator('.conversation-sidebar')).toBeVisible();

    // Chat-only controls are inert while setup is required.
    const composer = page.locator('textarea.chat-input');
    await expect(composer).toBeDisabled();
    const send = page.locator('.send-button');
    await expect(send).toBeDisabled();
    await expect(send).toHaveAttribute('aria-label', /provider/i);

    await card.locator('#first-run-openrouter-key').fill(SYNTHETIC_KEY);
    await card.getByRole('button', { name: /connect/i }).click();
    await expect(card).not.toBeVisible();
    await expect(page.getByRole('status', { name: 'Provider setup status' })).toContainText(/verified/i);
    await expect(page.locator('.chat-container')).not.toHaveClass(/setup-required/);
    await expect(toolbar).toBeVisible();
    await expect(page.locator('.empty-state-capabilities')).toBeVisible();
    await expect(composer).toBeEnabled();
    await composer.fill('Ready to chat.');
    await expect(send).toBeEnabled();
  });

  test('history loading is distinct from successfully empty', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'desktop history check');
    await setupControlledJourney(page, {
      listResponses: ['ok'],
      listDelayMs: 1500,
      conversations: [],
    });
    await signInAsMockUser(page);
    const sidebar = await openChatsIfNeeded(page);
    await expect(sidebar.getByText('Loading chats…')).toBeVisible();
    await expect(sidebar.getByText('No conversations yet')).toHaveCount(0);
    await expect(sidebar.getByText('No conversations yet')).toBeVisible();
  });

  test('failed history load never fabricates an empty list; Retry recovers', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'desktop history check');
    const fixture = await openJourney(page, {
      listResponses: ['fail', 'ok'],
      conversations: [],
    });
    const sidebar = await openChatsIfNeeded(page);
    await expect(sidebar.getByText(/couldn.t load|could not load|failed to load|error/i)).toBeVisible();
    await expect(sidebar.getByText('No conversations yet')).toHaveCount(0);

    await sidebar.getByRole('button', { name: /retry/i }).first().click();
    await expect(sidebar.getByText('No conversations yet')).toBeVisible();
    await expect(page.locator('.first-run-card')).toBeVisible();
    expect(fixture.state.conversationListCalls).toBeGreaterThanOrEqual(2);
  });

  test('failed history Retry restores populated rows and setup state', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'desktop history check');
    const fixture = await openJourney(page, {
      listResponses: ['fail', 'ok'],
      conversations: [
        {
          id: 'c1111111-1111-4111-8111-111111111111',
          title: 'First recovered chat',
          last_activity_at: new Date().toISOString(),
        },
        {
          id: 'c2222222-2222-4222-8222-222222222222',
          title: 'Second recovered chat',
          last_activity_at: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
    });
    const sidebar = await openChatsIfNeeded(page);
    await expect(sidebar.getByText('No conversations yet')).toHaveCount(0);
    await sidebar.getByRole('button', { name: /retry/i }).first().click();
    await expect(sidebar.getByText('First recovered chat')).toBeVisible();
    await expect(sidebar.getByText('Second recovered chat')).toBeVisible();
    await expect(page.locator('.first-run-card')).toBeVisible();
    expect(fixture.state.conversationListCalls).toBeGreaterThanOrEqual(2);
  });

  test('history keeps previously loaded rows and Retry targets the selected workspace', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'desktop workspace check');
    const fixture = await openJourney(page, {
      listResponses: ['ok', 'fail', 'ok'],
      projects: [
        {
          id: 'p-b',
          name: 'Workspace B',
          description: '',
          instructions: '',
          archived: false,
          created_at: new Date().toISOString(),
        },
      ],
      conversations: [
        {
          id: 'c1111111-1111-4111-8111-111111111111',
          title: 'Workspace A chat',
          last_activity_at: new Date().toISOString(),
          project_id: null,
        },
        {
          id: 'c3333333-3333-4333-8333-333333333333',
          title: 'Workspace B chat',
          last_activity_at: new Date(Date.now() - 60_000).toISOString(),
          project_id: 'p-b',
        },
      ],
    });
    const sidebar = await openChatsIfNeeded(page);
    await expect(sidebar.getByText('Workspace A chat')).toBeVisible();
    await expect(sidebar.getByText('Workspace B chat')).toBeVisible();

    await page.locator('select[aria-label="Filter by project workspace"]').selectOption('p-b');
    await expect(sidebar.getByText(/couldn.t load|could not load|failed to load|error/i)).toBeVisible();
    // Previously loaded rows stay visible while the refresh is failing.
    await expect(sidebar.getByText('Workspace A chat')).toBeVisible();
    await expect(sidebar.getByText('Workspace B chat')).toBeVisible();
    await expect(sidebar.getByText('No conversations yet')).toHaveCount(0);

    await sidebar.getByRole('button', { name: /retry/i }).first().click();
    await expect(sidebar.getByText('Workspace B chat')).toBeVisible();
    await expect(sidebar.getByText('Workspace A chat')).toHaveCount(0);
    await expect(sidebar.getByText('No conversations yet')).toHaveCount(0);
    await expect(page.locator('.first-run-card')).toBeVisible();
    expect(fixture.state.conversationListCalls).toBeGreaterThanOrEqual(3);
  });

  test('saved but disabled provider is named and recoverable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'desktop provider-state check');
    await setupControlledJourney(page, {
      initialProvider: { hasKey: true, enabled: false },
      listResponses: ['ok'],
      conversations: [],
    });
    await signInAsMockUser(page);
    const card = page.locator('.first-run-card');
    await expect(card).toContainText(/saved but turned off/i);
    await expect(card.locator('#first-run-openrouter-key')).toHaveCount(0);

    await card.getByRole('button', { name: /open provider settings/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Provider plug-ins' });
    await expect(dialog).toBeVisible();
    const toggle = dialog.getByRole('switch', { name: /enable openrouter/i });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(dialog.locator('.provider-state-line')).toContainText(/saved/i);
    await page.keyboard.press('Escape');
    await expect(card).not.toBeVisible();
    await expect(page.locator('.chat-container')).not.toHaveClass(/setup-required/);
    await expect(page.locator('textarea.chat-input')).toBeEnabled();
  });

  test('verified setup sends exactly one stateful request and reloads real history', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'desktop send check');
    const fixture = await openJourney(page, {
      validation: 'verified',
      listResponses: ['ok'],
    });
    const card = page.locator('.first-run-card');
    await card.locator('#first-run-openrouter-key').fill(SYNTHETIC_KEY);
    await card.getByRole('button', { name: /connect/i }).click();
    await expect(card).not.toBeVisible();
    await expect(page.getByRole('status', { name: 'Provider setup status' })).toContainText(/verified/i);

    const composer = page.locator('textarea.chat-input');
    await composer.fill('One controlled first-run submission.');
    await composer.press('Enter');
    await expect(page.getByText('Controlled provider reply: the setup journey is live.')).toBeVisible();
    expect(fixture.state.routerCalls).toBe(1);
    expect(fixture.state.routerRequests).toHaveLength(1);
    expect(String(fixture.state.routerRequests[0]?.query)).toContain('One controlled first-run submission.');

    await page.reload();
    await expect(page.locator('.chat-container')).toBeVisible();
    const sidebar = await openChatsIfNeeded(page);
    await expect(sidebar.getByText('One controlled first-run submission.')).toBeVisible();
    await expect(page.locator('.messages-list').getByText('One controlled first-run submission.')).toBeVisible();
    await expect(page.locator('.messages-list').getByText('Controlled provider reply: the setup journey is live.')).toBeVisible();
    expect(fixture.state.routerCalls).toBe(1);
  });

  test('setup remains reachable and overflow-free on Pixel 5 with enlarged text', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Pixel 5 check');
    await openJourney(page);
    const card = page.locator('.first-run-card');
    await expect(card).toBeVisible();
    await expect(card.locator('#first-run-openrouter-key')).toBeFocused();
    await assertNoHorizontalOverflow(page);

    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await assertNoHorizontalOverflow(page);
    const submit = card.getByRole('button', { name: /connect/i });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeVisible();
    const box = await submit.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth) + 1);
    await assertNotCovered(page, '.first-run-card .first-run-submit');

    // The same scroll region reaches alternate providers and the demo.
    const otherProviders = card.getByRole('button', { name: /configure other providers/i });
    await otherProviders.scrollIntoViewIfNeeded();
    await expect(otherProviders).toBeVisible();
    await expect(card.getByRole('link', { name: /demo/i })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // The setup content lives in one scroll region, not the page as a whole.
    const pageScroll = await page.evaluate(() => document.scrollingElement?.scrollHeight ?? 0);
    const pageHeight = await page.evaluate(() => window.innerHeight);
    expect(pageScroll).toBeLessThanOrEqual(pageHeight + 1);
  });
});
