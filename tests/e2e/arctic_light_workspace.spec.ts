import { test, expect, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

type RequestRecord = {
  query: string;
  mode?: string;
  debateProfile?: string;
  modelOverride?: string;
  routingProfile?: string;
};

async function openRoutingTools(panel: Locator) {
  const modelOptions = panel.locator('.arctic-routing-card > details').filter({ hasText: 'Model options' });
  await modelOptions.locator(':scope > summary').click();
  const routingTools = modelOptions.locator('details.arctic-route-nested');
  await routingTools.locator(':scope > summary').click();
}

test('New Chat reference composition at 1672x941', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setupAuthenticatedMock(page, {
    hasProviderKey: true,
    conversations: [
      { id: 'visual-app-architecture', title: 'App architecture', last_activity_at: '2026-11-15T10:00:00.000Z', project_id: null },
      { id: 'visual-research-summary', title: 'Research summary', last_activity_at: '2026-11-14T10:00:00.000Z', project_id: null },
      { id: 'visual-code-review', title: 'Code review', last_activity_at: '2026-11-13T10:00:00.000Z', project_id: null },
    ],
    messages: [],
  });
  await signInAsMockUser(page);
  await expect(page.getByRole('group', { name: 'Chat workflow' }).getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Routing details' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ New Chat' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^App architecture/ })).toBeVisible();
  const unnamedIconActions = await page.locator('button').evaluateAll((buttons) => buttons.filter((button) => {
    const style = window.getComputedStyle(button);
    const visible = style.display !== 'none' && style.visibility !== 'hidden' && button.getClientRects().length > 0;
    return visible && !button.getAttribute('aria-label') && !button.getAttribute('title') && !button.textContent?.trim();
  }).map((button) => button.outerHTML.slice(0, 180)));
  expect(unnamedIconActions, 'visible icon-only actions need an accessible name').toEqual([]);
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
      { type: 'receipt', executionId: `mock-arctic-${execution}`, status: 'completed', settlement: { state: 'settled', committedUsd: 0.00032, pendingCalls: 0 }, calls: [] },
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
  // Verification is session state, so a saved key must be checked again after reload.
  const verifySavedKeys = page.getByRole('button', { name: 'Verify provider keys' });
  await expect(verifySavedKeys).toBeVisible();
  await verifySavedKeys.click();
  await expect(page.getByRole('heading', { name: 'What can I help you with?' })).toBeVisible();
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
    await new Promise((resolve) => setTimeout(resolve, 10000));
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

test('compact header measurements follow New Chat, first send, saved history and model picker remounts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  let execution = 0;
  await page.route('**/functions/v1/router*', async (route) => {
    execution += 1;
    const body = route.request().postDataJSON() as RequestRecord;
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Router-Model': 'gemini-3.8-flash', 'X-Provider': 'mock', 'X-Prismatix-Execution-Id': `header-remount-${execution}` },
      body: [
        { type: 'meta', model: 'gemini-3.8-flash', cost: { finalUsd: 0.0001 } },
        { type: 'content_block_delta', delta: { text: `Reply to ${body.query}` } },
        { type: 'receipt', executionId: `header-remount-${execution}`, status: 'completed' },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
    });
  });
  await signInAsMockUser(page);

  const expectHeaderMeasurement = async () => {
    await expect.poll(async () => page.locator('.chat-header').evaluate((header) => {
      const box = header.getBoundingClientRect();
      const root = getComputedStyle(document.documentElement);
      return root.getPropertyValue('--prismatix-chat-header-h').trim() === `${Math.ceil(box.height)}px`
        && root.getPropertyValue('--prismatix-model-dropdown-top').trim() === `${Math.ceil(box.bottom) + 6}px`;
    })).toBe(true);
  };

  await expectHeaderMeasurement();
  const newChatPicker = page.locator('.composer-model-pill');
  await newChatPicker.click();
  await expect(page.locator('.composer-model-popover')).toBeVisible();
  await expectHeaderMeasurement();
  await page.keyboard.press('Escape');

  await page.getByRole('textbox', { name: 'Message Prismatix' }).fill('Header measurement fixture');
  await page.getByRole('textbox', { name: 'Message Prismatix' }).press('Enter');
  await expect(page.getByText('Reply to Header measurement fixture')).toBeVisible();
  await expect(page.locator('.arctic-workbench')).toHaveClass(/arctic-new-chat/);
  await expectHeaderMeasurement();
  await page.getByRole('button', { name: 'Choose routing mode: automatic' }).click();
  await expect(page.locator('.model-dropdown')).toBeVisible();
  await expectHeaderMeasurement();
  const savedPickerTop = await page.locator('.model-dropdown').evaluate((menu) => menu.getBoundingClientRect().top);
  const savedHeaderBottom = await page.locator('.chat-header').evaluate((header) => header.getBoundingClientRect().bottom);
  expect(savedPickerTop).toBeGreaterThan(savedHeaderBottom);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Toggle conversations sidebar' }).click();
  await page.getByRole('button', { name: '+ New Chat' }).click();
  await expect(page.locator('.arctic-workbench')).toHaveClass(/arctic-new-chat/);
  await expectHeaderMeasurement();
  await page.locator('.composer-model-pill').click();
  await expect(page.locator('.composer-model-popover')).toBeVisible();
  await expectHeaderMeasurement();
  expect(execution).toBe(1);
});

test('compact-height New Chat keeps the welcome heading intact and starter cards scroll-reachable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  await signInAsMockUser(page);
  const heading = page.getByRole('heading', { name: 'What can I help you with?' });
  const cards = page.locator('.empty-state-capabilities');
  const viewport = page.locator('.chat-messages');
  await expect(heading).toBeVisible();
  const initial = await page.evaluate(() => {
    const heading = document.querySelector('.empty-state h2')!.getBoundingClientRect();
    const messages = document.querySelector('.chat-messages')!.getBoundingClientRect();
    const composer = document.querySelector('.chat-input-container')!.getBoundingClientRect();
    return { headingTop: heading.top, headingBottom: heading.bottom, messagesBottom: messages.bottom, composerTop: composer.top };
  });
  expect(initial.headingBottom).toBeLessThanOrEqual(initial.messagesBottom + 1);
  expect(initial.headingBottom).toBeLessThanOrEqual(initial.composerTop + 1);
  await cards.scrollIntoViewIfNeeded();
  await expect(cards).toBeInViewport();
  await expect(cards.getByText('Analyze a file', { exact: true })).toBeVisible();
  expect(await viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  const evidenceDir = process.env.UI_BENCHMARK_EVIDENCE_DIR ?? testInfo.outputPath();
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: `${evidenceDir}/${testInfo.project.name}-compact-1024x600-cards-reachable.png` });
  await viewport.evaluate((node) => { node.scrollTop = 0; });
  await expect(heading).toBeInViewport();

  await page.setViewportSize({ width: 320, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await cards.scrollIntoViewIfNeeded();
  await expect(cards).toBeInViewport();
  await page.screenshot({ path: `${evidenceDir}/${testInfo.project.name}-mobile-320x844-cards-reachable.png` });
  const buildApp = cards.getByRole('button', { name: /Build an app/ });
  await expect(buildApp).toBeVisible();
  await buildApp.click();
  await expect(page.getByRole('textbox', { name: 'Message Prismatix' })).toHaveValue('Help me plan an app. Ask about the idea, users, and platform before suggesting an implementation.');
  await expect(page.locator('.messages-list .message')).toHaveCount(0);
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
  await openRoutingTools(routingPanel);
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
  { name: 'compact', width: 1024, height: 600 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`${viewport.name} Routing details stays reachable in a saved conversation and returns focus on close`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await setupAuthenticatedMock(page, { hasProviderKey: true });
    await signInAsMockUser(page);
    if (viewport.width <= 768) await page.getByRole('button', { name: 'Toggle conversations sidebar' }).click();
    await page.getByRole('button', { name: /^Architectural Discussion/ }).click();
    await expect(page.locator('.arctic-workbench')).toHaveClass(/arctic-new-chat/);

    const toggle = page.getByRole('button', { name: 'Routing details' });
    await expect(toggle).toBeVisible();
    await toggle.click();
    const panel = page.locator('.arctic-routing-panel');
    await expect(panel).toBeVisible();
    const evidenceDir = process.env.UI_BENCHMARK_EVIDENCE_DIR ?? testInfo.outputPath();
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: `${evidenceDir}/${testInfo.project.name}-history-routing-open-${viewport.width}x${viewport.height}.png`, fullPage: true });
    await panel.getByRole('button', { name: 'Close routing details' }).click();
    await expect(panel).toBeHidden();
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
}

test('desktop New Chat can restore the past-chats sidebar when hidden by preference', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  await page.addInitScript(() => localStorage.setItem('prismatix.sidebar.chatsHidden', '1'));
  await signInAsMockUser(page);

  const showChats = page.getByRole('button', { name: 'Show past chats' });
  await expect(showChats).toBeVisible();
  await showChats.click();
  await expect(page.locator('.conversation-sidebar')).toBeVisible();
  await expect(page.getByRole('button', { name: '+ New Chat' })).toBeFocused();
});

test('saved-chat Routing details closes when widening past the compact drawer breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await setupAuthenticatedMock(page, { hasProviderKey: true });
  await signInAsMockUser(page);
  await page.getByRole('button', { name: /^Architectural Discussion/ }).click();
  const toggle = page.getByRole('button', { name: 'Routing details' });
  await toggle.click();
  await expect(page.locator('.arctic-routing-panel')).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.arctic-routing-panel')).toBeHidden();
  await expect(page.locator('.arctic-routing-toggle')).toHaveAttribute('aria-expanded', 'false');

  await page.setViewportSize({ width: 1024, height: 600 });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator('.arctic-routing-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
});

test('Arctic spend cap keeps $0.10 selected and persisted after controlled rerenders', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  await signInAsMockUser(page);

  const routingPanel = page.locator('.arctic-routing-panel');
  await openRoutingTools(routingPanel);
  const cap = routingPanel.locator('#arctic-spend-cap');
  await cap.selectOption('0.10');
  await expect(cap).toHaveValue('0.10');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('prismatix_max_spend_cap'))).toBe('0.1');
  await routingPanel.locator('#arctic-routing-profile').selectOption('economy');
  await expect(cap).toHaveValue('0.10');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('prismatix_max_spend_cap'))).toBe('0.1');
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
      await expect(page.locator('.routing-intelligence-bar').getByRole('button', { name: 'Compare', exact: true })).toHaveCount(0);
      if (viewport.width <= 768) {
        await expect(page.locator('#routing-profile-select')).toBeHidden();
        await expect(page.locator('#spend-cap-select')).toBeHidden();
        await expect(page.locator('.routing-intelligence-bar')).toContainText('Search web');
        await expect(page.locator('.routing-intelligence-bar')).toContainText('Research');
      }
      const toggle = page.getByRole('button', { name: 'Routing details' });
      await toggle.click();
      await expect(page.locator('.arctic-routing-panel')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(toggle).toBeFocused();
    }
    if (viewport.width <= 768) {
      const composerBox = await page.locator('.chat-input-container').boundingBox();
      expect(composerBox).not.toBeNull();
      expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(viewport.height + 1);
    }
  });
}
