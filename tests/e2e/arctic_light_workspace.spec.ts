import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

type RequestRecord = {
  query: string;
  mode?: string;
  debateProfile?: string;
  modelOverride?: string;
  routingProfile?: string;
};

test('New Chat reference composition at 1672x941', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  await signInAsMockUser(page);
  await expect(page.getByRole('group', { name: 'Chat workflow' }).getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Routing details' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ New Chat' })).toBeVisible();
  const evidenceDir = process.env.UI_BENCHMARK_EVIDENCE_DIR ?? testInfo.outputPath();
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: `${evidenceDir}/arctic-new-chat-1672x941.png`, fullPage: true });
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Analyze a file/ }).click();
  const fileChooser = await fileChooserPromise;
  expect(fileChooser.isMultiple()).toBe(true);
  await fileChooser.setFiles([]);
  await expect(page.getByRole('button', { name: /Analyze a file/ })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Message Prismatix' })).toHaveValue('Analyze the attached file and summarize its key points.');
  await expect(page.locator('.messages-list .message')).toHaveCount(0);
});

test('New Chat keeps Chat, Compare and Debate dispatches isolated', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });

  const routerRequests: RequestRecord[] = [];
  let execution = 0;
  await page.route('**/functions/v1/router*', async (route) => {
    const body = route.request().postDataJSON() as RequestRecord;
    routerRequests.push(body);
    execution += 1;
    const events = [
      { type: 'meta', model: body.modelOverride || 'gemini-3.8-flash', cost: { finalUsd: 0.00032 } },
      { type: 'content_block_delta', delta: { text: `Mock reply ${execution}` } },
      { type: 'receipt', executionId: `mock-arctic-${execution}`, status: 'completed' },
    ];
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Router-Model': body.modelOverride || 'gemini-3.8-flash',
        'X-Provider': 'openrouter',
        'X-Prismatix-Execution-Id': `mock-arctic-${execution}`,
        'X-Cost-Estimate-USD': '0.00032',
      },
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
    });
  });

  await signInAsMockUser(page);
  await page.evaluate(() => localStorage.setItem('prismatix_comparison_mode', 'true'));
  await page.reload();
  await expect(page.getByRole('group', { name: 'Chat workflow' }).getByRole('button', { name: 'Compare' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Routing details' })).toBeVisible();
  await expect(page.getByText('Two selected models')).toBeVisible();

  const evidenceDir = process.env.UI_BENCHMARK_EVIDENCE_DIR ?? testInfo.outputPath();
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: `${evidenceDir}/legacy-compare-state-1672x941.png`, fullPage: true });

  const workflow = page.getByRole('group', { name: 'Chat workflow' });
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  const sendPrompt = async (prompt: string, isCompare = false) => {
    await composer.fill(prompt);
    const routingDetails = page.locator('.arctic-routing-panel');
    await expect(routingDetails).toContainText(isCompare ? 'combined for both models' : 'before sending');
    await composer.press('Enter');
  };

  // Debate deliberately replaces the legacy Compare preference.
  await workflow.getByRole('button', { name: 'Debate' }).click();
  await expect(workflow.getByRole('button', { name: 'Debate' })).toHaveAttribute('aria-pressed', 'true');
  await sendPrompt('Debate fixture prompt');
  await expect(page.getByText('Mock reply 1')).toBeVisible();
  expect(routerRequests).toHaveLength(1);
  expect(routerRequests[0]).toMatchObject({ query: 'Debate fixture prompt', mode: 'debate', debateProfile: 'general' });

  await page.getByRole('button', { name: /New Chat/i }).click();
  await workflow.getByRole('button', { name: 'Compare' }).click();
  await expect(workflow.getByRole('button', { name: 'Compare' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Debate profile')).toHaveValue('off');
  await sendPrompt('Compare fixture prompt', true);
  await expect(page.getByText('Mock reply 2')).toBeVisible();
  await expect(page.getByText('Mock reply 3')).toBeVisible();
  expect(routerRequests).toHaveLength(3);
  expect(routerRequests.slice(1).map((request) => request.query)).toEqual(['Compare fixture prompt', 'Compare fixture prompt']);
  expect(routerRequests.slice(1).map((request) => request.modelOverride)).toEqual(['gemini-3.8-flash', 'gpt-6-sol']);
  expect(routerRequests.slice(1).every((request) => !request.mode || request.mode === 'off')).toBe(true);
  expect(routerRequests.slice(1).every((request) => request.routingProfile === 'balanced')).toBe(true);

  await page.getByRole('button', { name: /New Chat/i }).click();
  await workflow.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(workflow.getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Debate profile')).toHaveValue('off');
  await sendPrompt('Chat fixture prompt');
  await expect(page.getByText('Mock reply 4')).toBeVisible();
  expect(routerRequests).toHaveLength(4);
  expect(routerRequests[3]).toMatchObject({ query: 'Chat fixture prompt', mode: 'off', debateProfile: 'off' });
  expect(routerRequests[3]?.modelOverride).toBeUndefined();
  expect(routerRequests[3]?.routingProfile).toBe('balanced');
});

test('New Chat Stop cancels one mocked stream without a second dispatch', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  const requests: RequestRecord[] = [];
  await page.route('**/functions/v1/router*', async (route) => {
    requests.push(route.request().postDataJSON() as RequestRecord);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: [DONE]\n\n' });
  });
  await signInAsMockUser(page);
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Cancel this synthetic stream');
  await composer.press('Enter');
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole('button', { name: 'Stop generating' }).click();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(page.getByText('Generation cancelled')).toBeVisible();
  expect(requests).toHaveLength(1);
});

test('New Chat keeps local profile, web search and spend cap edits over late server preferences', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  let releasePreferences!: () => void;
  const preferenceGate = new Promise<void>((resolve) => { releasePreferences = resolve; });
  let preferenceReadStarted = false;
  let preferenceReadReturned = false;
  await page.route('**/rest/v1/user_preferences*', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    preferenceReadStarted = true;
    await preferenceGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user_id: '11111111-1111-4111-8111-111111111111',
        preferences: { routingProfile: 'economy', webSearchEnabled: false, maxSpendCap: 0.01 },
        updated_at: new Date().toISOString(),
      }),
    });
    preferenceReadReturned = true;
  });
  await signInAsMockUser(page);
  await expect.poll(() => preferenceReadStarted).toBe(true);

  const routingPanel = page.locator('.arctic-routing-panel');
  await routingPanel.getByText('Routing profile & tools', { exact: true }).click();
  const profile = routingPanel.locator('#arctic-routing-profile');
  const cap = routingPanel.locator('#arctic-spend-cap');
  const webSearch = routingPanel.getByLabel('Search web (BYOK)');
  await profile.selectOption('capability');
  await cap.selectOption('0.05');
  await webSearch.check();

  releasePreferences();
  await expect.poll(() => preferenceReadReturned).toBe(true);
  await page.waitForTimeout(100);
  await expect(profile).toHaveValue('capability');
  await expect(cap).toHaveValue('0.05');
  await expect(webSearch).toBeChecked();
});

for (const viewport of [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'compact-1024x600', width: 1024, height: 600 },
  { name: 'mobile-390x844', width: 390, height: 844 },
  { name: 'mobile-320x844', width: 320, height: 844 },
]) {
  test(`New Chat layout fits ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
    await signInAsMockUser(page);
    await expect(page.getByRole('group', { name: 'Chat workflow' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `${viewport.name} should not overflow horizontally`).toBe(false);
    const evidenceDir = process.env.UI_BENCHMARK_EVIDENCE_DIR ?? testInfo.outputPath();
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: `${evidenceDir}/${testInfo.project.name}-${viewport.name}-${viewport.width}x${viewport.height}.png`, fullPage: true });
    if (viewport.width <= 1200) {
      const toggle = page.getByRole('button', { name: 'Routing details' });
      await toggle.click();
      await expect(page.locator('.arctic-routing-panel')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(toggle).toBeFocused();
    }
  });
}
