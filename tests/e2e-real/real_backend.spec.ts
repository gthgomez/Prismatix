// Real-backend browser journeys.
//
// Unlike tests/e2e (synthetic route intercepts), NOTHING here is mocked: the
// browser talks to the local Supabase stack (Auth, PostgREST/RLS, Edge router)
// and the Edge router talks to scripts/qualification/stub-provider.mjs through
// OPENROUTER_BASE_URL. No live provider is contacted.
//
// Requires a build produced with the local VITE_* values; see
// scripts/qualification/run-real-e2e.mjs.

import { test, expect, type Page } from '@playwright/test';

const STUB_TEXT = process.env.STUB_TEXT ?? 'Prismatix deterministic stub response.';
const STUB_CONTROL = process.env.STUB_URL ?? 'http://127.0.0.1:8899';
const USER_A = { email: 'qual-a@example.test', password: 'qual-pass-a-1234' };
const USER_B = { email: 'qual-b@example.test', password: 'qual-pass-b-1234' };

async function setScenario(scenario: string) {
  const response = await fetch(`${STUB_CONTROL}/__control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario }),
  });
  expect(response.ok, `stub scenario ${scenario}`).toBe(true);
}

async function stubRequestCount(): Promise<number> {
  const response = await fetch(`${STUB_CONTROL}/__requests`);
  const body = (await response.json()) as { requests: unknown[] };
  return body.requests.length;
}

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.getByRole('button', { name: /sign in to prismatix/i }).click();
  await expect(page.getByRole('textbox', { name: 'Message Prismatix' })).toBeVisible({ timeout: 20000 });
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page.locator('#email')).toBeVisible({ timeout: 15000 });
}

async function openHistory(page: Page) {
  const sidebar = page.getByRole('complementary', { name: 'Conversations' });
  const toggle = page.getByRole('button', { name: 'Toggle conversations sidebar' });
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await expect(sidebar).toBeVisible();
  return sidebar;
}

/**
 * Fill and submit through the user-visible control. The composer is rendered
 * before the provider plug-in lookup resolves, so an immediate Enter can be
 * rejected with a transient "still being checked" message. Waiting for the
 * send control to enable is the same signal a user sees.
 */
async function sendPrompt(page: Page, text: string) {
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill(text);
  const send = page.getByRole('button', { name: /^Send message/ });
  await expect(send).toBeEnabled({ timeout: 20000 });
  await composer.press('Enter');
}

test.describe('real backend', () => {
  test.beforeAll(async () => {
    await setScenario('default');
  });

  test('real sign-in, stream, persistence and reload from Postgres', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await signIn(page, USER_A);

    const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
    const prompt = `Real backend persistence probe ${Date.now()}`;
    await sendPrompt(page, prompt);

    await expect(page.getByText(STUB_TEXT).first()).toBeVisible({ timeout: 25000 });
    await expect(composer).toBeEnabled({ timeout: 15000 });

    // The assistant hit is only durable once the server confirms the transcript.
    await page.waitForTimeout(1500);
    await page.reload();
    await expect(composer).toBeVisible({ timeout: 20000 });

    const sidebar = await openHistory(page);
    await expect(sidebar.locator('.conversation-item-button').first()).toBeVisible({ timeout: 20000 });
    await sidebar.locator('.conversation-item-button').first().click();

    await expect(page.getByText(prompt, { exact: false }).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(STUB_TEXT).first()).toBeVisible({ timeout: 20000 });
  });

  test('stop generation keeps received text and never resends on reload', async ({ page }) => {
    await setScenario('streaming');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await signIn(page, USER_A);

    const before = await stubRequestCount();
    await sendPrompt(page, `Slow stream stop probe ${Date.now()}`);

    // Partial text arrives, then the user stops the generation mid-stream.
    await expect(page.getByText(/Prismatix deterministic/i).first()).toBeVisible({ timeout: 25000 });
    await page.getByRole('button', { name: 'Stop generating' }).click();
    await expect(page.getByRole('button', { name: 'Stop generating' })).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByText(/Prismatix deterministic/i).first()).toBeVisible();

    const afterStop = await stubRequestCount();
    expect(afterStop, 'exactly one provider call for the stopped turn').toBe(before + 1);

    // Wait past any post-cancel background work: a cancelled turn must not
    // dispatch a second paid call (for example a memory extraction job).
    await page.waitForTimeout(3500);
    expect(await stubRequestCount(), 'no provider call after cancellation').toBe(afterStop);

    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Message Prismatix' })).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(2500);
    // A reload must never replay the paid turn.
    expect(await stubRequestCount(), 'no provider call after reload').toBe(afterStop);

    // PXQ-11: the tab-scoped checkpoint offers the interrupted text; it never
    // resends and never claims the transcript was saved.
    await expect(page.getByText(/response recovery/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('a second real account cannot see the first account history', async ({ page }) => {
    await setScenario('default');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await signIn(page, USER_A);

    const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
    const marker = `Ownership marker ${Date.now()}`;
    await sendPrompt(page, marker);
    await expect(page.getByText(STUB_TEXT).first()).toBeVisible({ timeout: 25000 });
    await expect(composer).toBeEnabled({ timeout: 15000 });

    await signOut(page);
    await signIn(page, USER_B);

    const sidebar = await openHistory(page);
    await expect(sidebar).not.toContainText(marker, { timeout: 10000 });
    await expect(sidebar.locator('.conversation-item-button')).toHaveCount(0);
  });

  test('mobile viewport completes a real turn', async ({ page }) => {
    await setScenario('default');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await signIn(page, USER_A);

    const prompt = `Mobile real probe ${Date.now()}`;
    await sendPrompt(page, prompt);
    await expect(page.getByText(STUB_TEXT).first()).toBeVisible({ timeout: 25000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'no horizontal document overflow').toBeLessThanOrEqual(1);
  });
});
