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
const SUPABASE_URL = (process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
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

/**
 * Count only assistant chat calls (`stream_options.include_usage` absent).
 * Background memory extraction uses `include_usage: true`, so this isolates
 * the conversation turn from asynchronous maintenance work and makes call
 * counting stable across tests.
 */
async function stubChatRequestCount(): Promise<number> {
  const response = await fetch(`${STUB_CONTROL}/__requests`);
  const body = (await response.json()) as { requests: Array<{ hasUsageOption?: boolean }> };
  return body.requests.filter((request) => request.hasUsageOption === false).length;
}

/**
 * Negative observation window for "no delayed work happened".
 *
 * The only background provider caller is memory extraction, which is
 * dispatched synchronously when a turn completes and would reach the stub
 * within one HTTP round trip. 2.5s is an order of magnitude above that
 * observed latency, so a quiet window is meaningful evidence rather than an
 * arbitrary sleep. We poll and fail fast if a call does appear.
 */
async function expectNoNewProviderCalls(baseline: number, label: string, windowMs = 2500) {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    expect(await stubChatRequestCount(), label).toBe(baseline);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  expect(await stubChatRequestCount(), label).toBe(baseline);
}

/**
 * The settled cost badge is rendered from the server's receipt event, which is
 * emitted after the transcript and cost log are written. It is the visible
 * "server confirmed this turn" signal, so reloads can be tested without a
 * fixed delay.
 */
async function expectServerConfirmedTurn(page: Page) {
  await expect(page.getByText(/\$\S+ final/).first()).toBeVisible({ timeout: 25000 });
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
    // The Edge runtime compiles the router's module graph on the first
    // invocation. Warm it once so a cold start is not mistaken for a stuck
    // generation. This is setup, not a relaxation of any assertion.
    if (SUPABASE_ANON_KEY) {
      const sessionResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
        body: JSON.stringify(USER_A),
      });
      const session = (await sessionResponse.json()) as { access_token?: string };
      if (session.access_token) {
        await fetch(`${SUPABASE_URL}/functions/v1/router`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            authorization: `Bearer ${session.access_token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ action: 'capabilities' }),
        });
      }
    }
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

    // The assistant hit is only durable once the server confirms the transcript
    // and cost log; the settled badge is that confirmation.
    await expectServerConfirmedTurn(page);
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

    const before = await stubChatRequestCount();
    await sendPrompt(page, `Slow stream stop probe ${Date.now()}`);

    // Partial text arrives, then the user stops the generation mid-stream.
    await expect(page.getByText(/Prismatix deterministic/i).first()).toBeVisible({ timeout: 25000 });
    await page.getByRole('button', { name: 'Stop generating' }).click();
    await expect(page.getByRole('button', { name: 'Stop generating' })).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByText(/Prismatix deterministic/i).first()).toBeVisible();

    const afterStop = await stubChatRequestCount();
    expect(afterStop, 'exactly one provider call for the stopped turn').toBe(before + 1);

    // A cancelled turn must not dispatch a second paid call (for example a
    // memory extraction job). The quiet window is justified in the helper.
    await expectNoNewProviderCalls(afterStop, 'no provider call after cancellation');

    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Message Prismatix' })).toBeVisible({ timeout: 20000 });

    // PXQ-11: the tab-scoped checkpoint offers the interrupted text; it never
    // resends and never claims the transcript was saved. Its appearance is the
    // observable mount-complete signal, so no fixed reload sleep is needed.
    await expect(page.getByText(/response recovery/i).first()).toBeVisible({ timeout: 15000 });
    expect(await stubChatRequestCount(), 'no provider call after reload').toBe(afterStop);
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

  test('Enter during provider readiness preserves the draft and dispatches nothing', async ({ page }) => {
    await setScenario('default');
    await page.setViewportSize({ width: 1440, height: 900 });

    // Controlled fault injection: the real provider-settings function is
    // delayed, not mocked. This recreates the fast-typist race on a real
    // backend without weakening the response contract.
    let delayed = 0;
    await page.route('**/functions/v1/provider-settings**', async (route) => {
      delayed += 1;
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.continue();
    });

    await page.goto('/');
    await signIn(page, USER_A);

    const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
    const prompt = `Readiness race probe ${Date.now()}`;
    await composer.fill(prompt);

    const before = await stubChatRequestCount();
    await composer.press('Enter');

    // The composer explains that sending is paused while the check resolves,
    // the draft is intact, and nothing is dispatched.
    const readyState = page.locator('.send-button');
    await expect(readyState).toHaveAttribute('data-state', 'provider-checking', { timeout: 3000 });
    const checkingStatus = page.locator('.provider-setup-composer-status');
    await expect(checkingStatus).toContainText(/Checking provider setup/i);
    await expect(composer).toHaveValue(prompt);
    expect(await stubChatRequestCount(), 'no dispatch during readiness').toBe(before);

    // Readiness resolves; the paused status clears and still nothing is sent.
    await expect(readyState).toHaveAttribute('data-state', 'ready', { timeout: 20000 });
    await expect(checkingStatus).toHaveCount(0);
    expect(await stubChatRequestCount(), 'no automatic dispatch when ready').toBe(before);
    await expect(composer).toHaveValue(prompt);

    // A deliberate submit now produces exactly one execution.
    await composer.press('Enter');
    await expect(page.getByText(STUB_TEXT).first()).toBeVisible({ timeout: 25000 });
    await expectServerConfirmedTurn(page);
    expect(await stubChatRequestCount(), 'exactly one chat call after submit').toBe(before + 1);
    expect(delayed, 'provider readiness was genuinely delayed').toBeGreaterThan(0);

    await page.unroute('**/functions/v1/provider-settings**');
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
