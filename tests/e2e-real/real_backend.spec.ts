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
// One identity per journey keeps each one below the router's per-user rate
// limit even when the acceptance gate and isolation checks run moments earlier.
const USER_C = { email: 'qual-c@example.test', password: 'qual-pass-c-1234' };
const USER_D = { email: 'qual-d@example.test', password: 'qual-pass-d-1234' };
const USER_G = { email: 'qual-g@example.test', password: 'qual-pass-g-1234' };

async function setScenario(scenario: string) {
  const response = await fetch(`${STUB_CONTROL}/__control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario }),
  });
  expect(response.ok, `stub scenario ${scenario}`).toBe(true);
}

/** Count user-facing chat calls apart from asynchronous memory extraction. */
async function stubChatRequestCount(): Promise<number> {
  const response = await fetch(`${STUB_CONTROL}/__requests`);
  const body = (await response.json()) as { requests: Array<{ workload?: string }> };
  return body.requests.filter((request) => request.workload === 'chat').length;
}

async function stubInferenceRequests(): Promise<Array<{ provider?: string; path?: string; protocol?: string; model?: string | null; authMatched?: boolean; kind?: string; workload?: string }>> {
  const response = await fetch(`${STUB_CONTROL}/__requests`);
  const body = (await response.json()) as { requests: Array<{ provider?: string; path?: string; protocol?: string; model?: string | null; authMatched?: boolean; kind?: string; workload?: string }> };
  return body.requests.filter((request) => request.kind !== 'metadata' && request.path?.startsWith('/'));
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

async function expectNoNewInferenceRequests(baseline: number, label: string, windowMs = 2500) {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    expect((await stubInferenceRequests()).length, label).toBe(baseline);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  expect((await stubInferenceRequests()).length, label).toBe(baseline);
}

/**
 * The settled cost badge is rendered from the server's receipt event, which is
 * emitted after the transcript and cost log are written. It is the visible
 * "server confirmed this turn" signal, so reloads can be tested without a
 * fixed delay.
 */
async function expectServerConfirmedTurn(page: Page) {
  await expect(page.getByText(/\$\S+ final/).last()).toBeVisible({ timeout: 25000 });
}

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.getByRole('button', { name: /sign in to prismatix/i }).click();
  await expect(page.getByRole('textbox', { name: 'Message Prismatix' })).toBeVisible({ timeout: 20000 });
}

async function clearFixtureInferenceKeys(user: { email: string; password: string }) {
  const auth = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(user),
  });
  expect(auth.ok, 'fresh fixture identity can sign in for account cleanup').toBe(true);
  const session = (await auth.json()) as { access_token?: string };
  expect(session.access_token).toBeTruthy();
  for (const provider of ['openai', 'openrouter']) {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/provider-settings`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${session.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action: 'delete_key', provider }),
    });
    expect(response.ok, `clear stale ${provider} fixture key`).toBe(true);
  }
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
    await signIn(page, USER_C);

    const before = await stubChatRequestCount();
    await sendPrompt(page, `Slow stream stop probe ${Date.now()}`);

    // Partial text arrives, then the user stops the generation mid-stream.
    // Assert only a prefix that the sidebar brand cannot satisfy.
    await expect(page.getByText(/Prismatix d/i).first()).toBeVisible({ timeout: 25000 });
    await page.getByRole('button', { name: 'Stop generating' }).click();
    await expect(page.getByRole('button', { name: 'Stop generating' })).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByText(/Prismatix d/i).first()).toBeVisible();

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
    await signIn(page, USER_D);

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
    await signIn(page, USER_D);

    const prompt = `Mobile real probe ${Date.now()}`;
    await sendPrompt(page, prompt);
    await expect(page.getByText(STUB_TEXT).first()).toBeVisible({ timeout: 25000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'no horizontal document overflow').toBeLessThanOrEqual(1);
  });

  test('fresh mobile account connects OpenAI, sends an exact route and Auto, then disconnects safely', async ({ page }, testInfo) => {
    await setScenario('default');
    await clearFixtureInferenceKeys(USER_G);
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('/');
    await signIn(page, USER_G);

    const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('button', { name: 'Provider plug-ins' }).click();

    const settings = page.getByRole('dialog', { name: 'Provider plug-ins' });
    await expect(settings).toBeVisible();
    await expect(settings.locator('.provider-badge--default')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('mobile-before-connection.png') });
    const initialOpenAICard = settings.locator('.provider-card').filter({ has: page.getByLabel('OpenAI API key') });
    await initialOpenAICard.getByLabel('OpenAI API key').fill('fixture-openai-provider-key');
    await initialOpenAICard.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(settings.getByText(/gpt-6\.2-sol/i).first()).toBeVisible({ timeout: 25000 });
    await expect(settings.getByText(/verified model inventory|discovered models are ready/i).first()).toBeVisible();
    await settings.getByRole('button', { name: 'Close provider plug-ins' }).click();

    const picker = page.locator('.composer-model-pill');
    const beforeManual = await stubChatRequestCount();
    await picker.click();
    const routeOption = page.getByRole('option', { name: /openai:gpt-6\.2-sol/i }).first();
    await expect(routeOption).toBeVisible();
    await routeOption.click();
    await sendPrompt(page, `OpenAI manual route ${Date.now()}`);
    await expect(page.getByText(STUB_TEXT).first()).toBeVisible({ timeout: 25000 });
    await expectServerConfirmedTurn(page);
    expect(await stubChatRequestCount()).toBe(beforeManual + 1);

    const beforeAuto = await stubChatRequestCount();
    await picker.click();
    await page.getByRole('button', { name: /Prismatix Smart Router/ }).click();
    await sendPrompt(page, `OpenAI automatic route ${Date.now()}`);
    await expect(page.getByText(STUB_TEXT, { exact: true })).toHaveCount(2, { timeout: 25000 });
    await expect(page.getByText(/\$\S+ final/)).toHaveCount(2, { timeout: 25000 });
    expect(await stubChatRequestCount()).toBe(beforeAuto + 1);
    await page.screenshot({ path: testInfo.outputPath('mobile-after-openai-auto.png') });

    // Compare two distinct connections using the same local provider fixture.
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('button', { name: 'Provider plug-ins' }).click();
    const extraConnection = page.getByRole('dialog', { name: 'Provider plug-ins' });
    const openRouterCard = extraConnection.locator('.provider-card').filter({ hasText: 'OpenRouter' }).first();
    await openRouterCard.getByLabel('OpenRouter API key').fill('fake-byok-provider-key');
    await openRouterCard.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(extraConnection.getByText(/google\/gemini-3\.8-flash/i).first()).toBeVisible({ timeout: 25000 });
    await extraConnection.getByRole('button', { name: 'Close provider plug-ins' }).click();

    const sidebar = await openHistory(page);
    await sidebar.getByRole('button', { name: /New Chat/ }).click();
    await page.getByRole('group', { name: 'Chat workflow' }).getByRole('button', { name: 'Compare', exact: true }).click();
    await page.getByRole('button', { name: 'Routing details', exact: true }).click();
    const routingPanel = page.getByRole('complementary', { name: 'Routing details' });
    await routingPanel.getByText('Model options', { exact: true }).click();
    const compareA = routingPanel.getByLabel('Model A');
    const compareB = routingPanel.getByLabel('Model B');
    await compareA.selectOption('openai:gpt-6.2-sol');
    await compareB.selectOption('openrouter:google/gemini-3.8-flash');
    await routingPanel.getByRole('button', { name: 'Close routing details' }).click();
    const beforeCompare = await stubChatRequestCount();
    const inferenceBeforeCompare = (await stubInferenceRequests()).length;
    await sendPrompt(page, `OpenAI and OpenRouter comparison ${Date.now()}`);
    await expect(page.getByText(/Side-by-side comparison:/).last()).toBeVisible({ timeout: 25000 });
    expect(await stubChatRequestCount()).toBe(beforeCompare + 2);
    const comparisonCalls = (await stubInferenceRequests()).slice(inferenceBeforeCompare).filter((request) => request.workload === 'chat');
    expect(comparisonCalls.map((request) => [request.provider, request.protocol, request.model, request.authMatched]))
      .toEqual(expect.arrayContaining([
        ['openai', 'responses', 'gpt-6.2-sol', true],
        ['openrouter', 'chat_completions', 'google/gemini-3.8-flash', true],
      ]));

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('button', { name: 'Provider plug-ins' }).click();
    const settingsAgain = page.getByRole('dialog', { name: 'Provider plug-ins' });
    const openAICard = settingsAgain.locator('.provider-card').filter({ hasText: 'OpenAI' }).first();
    await openAICard.getByRole('button', { name: 'Remove', exact: true }).click();
    const openRouterCardAgain = settingsAgain.locator('.provider-card').filter({ has: page.getByLabel('OpenRouter API key') });
    await openRouterCardAgain.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(openAICard.getByText(/No verified model inventory/i)).toBeVisible();
    await expect(openRouterCardAgain.getByText(/No verified model inventory/i)).toBeVisible();
    await settingsAgain.getByRole('button', { name: 'Close provider plug-ins' }).click();

    await picker.click();
    await expect(page.getByRole('option', { name: /openai:gpt-6\.2-sol/i })).toHaveCount(0);
    await page.keyboard.press('Escape');

    const beforeForbiddenSend = await stubChatRequestCount();
    const beforeForbiddenInference = (await stubInferenceRequests()).length;
    await composer.fill('This should not dispatch after disconnect.');
    await expect(page.getByRole('button', { name: /^Send message/ })).toBeDisabled();
    await expectNoNewProviderCalls(beforeForbiddenSend, 'disconnect must not dispatch to OpenAI or another provider');
    await expectNoNewInferenceRequests(beforeForbiddenInference, 'disconnect must not trigger any provider inference');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'no horizontal overflow on Galaxy S25 Ultra logical width').toBeLessThanOrEqual(1);
  });
});
