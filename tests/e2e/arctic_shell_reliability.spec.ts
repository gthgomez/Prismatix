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
  test(`early ${code} response preserves draft without adding a fake chat turn`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
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
    await expect(page.locator('.draft-recovery-text')).not.toContainText('ready to chat');
    await expect(page.locator('.draft-recovery-text')).not.toContainText(/revoked|rejected|invalid/i);
    await expect(page.locator('.cost-estimator')).toBeHidden();

    const recovery = page.locator('.draft-recovery-bar');
    const recoveryText = recovery.locator('.draft-recovery-text');
    const recoveryActions = recovery.locator('.draft-recovery-actions');
    const accountMenu = page.getByRole('button', { name: 'Account menu' });
    const layout = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>('.chat-header')!;
      const messages = document.querySelector<HTMLElement>('.chat-messages')!;
      const avatar = document.querySelector<HTMLElement>('.user-button')!;
      const verify = document.querySelector<HTMLElement>('.provider-setup-composer-status button')!;
      const recovery = document.querySelector<HTMLElement>('.draft-recovery-bar')!;
      const text = recovery.querySelector<HTMLElement>('.draft-recovery-text')!;
      const actions = recovery.querySelector<HTMLElement>('.draft-recovery-actions')!;
      const rect = (element: HTMLElement) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
      };
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        header: rect(header),
        headerFits: header.scrollWidth <= header.clientWidth + 1 && header.scrollHeight <= header.clientHeight + 1,
        headerControlsFit: [...header.querySelectorAll<HTMLElement>('button')].filter((button) => getComputedStyle(button).display !== 'none').every((button) => {
          const box = button.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return true;
          const container = header.getBoundingClientRect();
          return box.left >= container.left - 1 && box.right <= container.right + 1 && box.top >= container.top - 1 && box.bottom <= container.bottom + 1;
        }),
        headerControlRects: [...header.querySelectorAll<HTMLElement>('button')].filter((button) => getComputedStyle(button).display !== 'none').map((button) => {
          const box = button.getBoundingClientRect();
          return { name: button.getAttribute('aria-label') || button.textContent?.trim(), top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height };
        }),
        headerBeforeTranscript: header.getBoundingClientRect().bottom <= messages.getBoundingClientRect().top + 1,
        account: rect(avatar),
        verify: rect(verify),
        verifyHit: (() => {
          const box = verify.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return box.top >= 0 && box.bottom <= window.innerHeight && (hit === verify || verify.contains(hit));
        })(),
        recovery: rect(recovery),
        recoveryText: rect(text),
        recoveryActions: rect(actions),
        recoveryOverlaps: (() => {
          const textRect = text.getBoundingClientRect();
          const actionsRect = actions.getBoundingClientRect();
          return textRect.left < actionsRect.right && textRect.right > actionsRect.left
            && textRect.top < actionsRect.bottom && textRect.bottom > actionsRect.top;
        })(),
        textFits: text.scrollHeight <= text.clientHeight + 1,
      };
    });
    expect(layout.header.left).toBeGreaterThanOrEqual(0);
    expect(layout.header.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.headerFits).toBe(true);
    expect(layout.headerControlsFit, JSON.stringify(layout)).toBe(true);
    expect(layout.headerBeforeTranscript).toBe(true);
    expect(layout.account.left).toBeGreaterThanOrEqual(0);
    expect(layout.account.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.recoveryOverlaps).toBe(false);
    expect(layout.textFits).toBe(true);
    await expect(page.getByRole('button', { name: 'Verify provider keys', exact: true })).toBeVisible();
    expect(layout.verify.top).toBeGreaterThanOrEqual(0);
    expect(layout.verify.bottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
    expect(layout.verifyHit).toBe(true);
    await expect(recoveryText).toContainText(code === 'provider_key_required' ? 'No usable provider credential' : 'could not be retrieved');
    await expect(recoveryActions.getByRole('button', { name: 'Restore draft' })).toBeVisible();
    await expect(recoveryActions.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();

    for (const button of [accountMenu, recoveryActions.getByRole('button', { name: 'Restore draft' }), recoveryActions.getByRole('button', { name: 'Retry', exact: true })]) {
      const hitTargetWorks = await button.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit === element || element.contains(hit);
      });
      expect(hitTargetWorks).toBe(true);
    }
    await accountMenu.click();
    await expect(page.locator('.user-dropdown')).toBeVisible();
    await accountMenu.click();

    const evidenceDir = process.env.UI_BENCHMARK_EVIDENCE_DIR ?? testInfo.outputPath();
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: `${evidenceDir}/transition-provider-failure-1024x600-${code}.png`, animations: 'disabled' });
      const verify = page.getByRole('button', { name: 'Verify provider keys', exact: true });
      if (await verify.isVisible().catch(() => false)) await verify.click();
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
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'validate_key') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'openrouter', status: 'enabled' }) });
      return;
    }
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
  await expect(page.getByRole('button', { name: 'Verify provider keys' })).toBeVisible();
  await page.getByRole('button', { name: 'Verify provider keys' }).click();
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
  const setupCard = page.locator('.first-run-card');
  const compactStatus = page.locator('.provider-setup-composer-status');
  await expect(compactStatus).toBeVisible();
  await expect(page.locator('.composer-tool-row')).toBeHidden();
  await expect(page.locator('.composer-model-bar')).toBeHidden();
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  const prompt = 'Preserve this until a route is configured';
  await composer.fill(prompt);
  await composer.press('Enter');
  expect(sends).toBe(0);
  await expect(composer).toHaveValue(prompt);
  const setupBox = await setupCard.boundingBox();
  const composerBox = await page.locator('.chat-input-container').boundingBox();
  expect(setupBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(setupBox!.y + setupBox!.height).toBeLessThanOrEqual(composerBox!.y + 1);
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(600);
  const panelState = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('.first-run-card')!;
    const composer = document.querySelector<HTMLElement>('.chat-input-container')!;
    const input = document.querySelector<HTMLElement>('.chat-input')!;
    const statusButton = document.querySelector<HTMLElement>('.provider-setup-composer-status button')!;
    const cardRect = card.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const statusRect = statusButton.getBoundingClientRect();
    return {
      setupClientHeight: card.clientHeight,
      setupScrollHeight: card.scrollHeight,
      overlapsComposer: cardRect.bottom > composerRect.top + 1,
      inputOverlapsStatusAction: inputRect.bottom > statusRect.top && inputRect.top < statusRect.bottom,
      statusActionHit: (() => {
        const hit = document.elementFromPoint(statusRect.left + statusRect.width / 2, statusRect.top + statusRect.height / 2);
        return hit === statusButton || statusButton.contains(hit);
      })(),
    };
  });
  expect(panelState.overlapsComposer).toBe(false);
  expect(panelState.inputOverlapsStatusAction).toBe(false);
  expect(panelState.statusActionHit).toBe(true);
  expect(panelState.setupClientHeight).toBeGreaterThanOrEqual(260);
  expect(panelState.setupScrollHeight).toBeGreaterThanOrEqual(panelState.setupClientHeight);
  const settingsTrigger = page.getByRole('button', { name: /Configure Other Providers/i });
  await setupCard.evaluate((el: HTMLElement) => { el.scrollTop = el.scrollHeight; });
  await settingsTrigger.click();
  const settingsDialog = page.getByRole('dialog', { name: 'Provider plug-ins' });
  await expect(settingsDialog).toBeVisible();
  await settingsDialog.getByRole('button', { name: 'Close provider plug-ins' }).click();
  await expect(settingsTrigger).toBeFocused();
  const demoAction = page.getByRole('link', { name: /scripted public demo/i });
  await demoAction.scrollIntoViewIfNeeded();
  await expect(demoAction).toBeVisible();
  const demoHit = await demoAction.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === el || el.contains(hit);
  });
  expect(demoHit).toBe(true);
  await page.locator('.provider-setup-composer-status button').click();
  await expect(settingsDialog).toBeVisible();
  await settingsDialog.getByRole('button', { name: 'Close provider plug-ins' }).click();
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
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'validate_key') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'openrouter', status: 'enabled' }) });
      return;
    }
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
  await page.getByRole('button', { name: 'Verify provider keys' }).click();
  await expect(page.locator('.provider-readiness-banner')).toHaveCount(0);
  await composer.press('Enter');
  await expect(page.getByText('Saved chat recovered')).toBeVisible();
  expect(sends).toBe(1);
});

test('a saved but unverified provider blocks sends until retry verification succeeds', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupAuthenticatedMock(page, { hasProviderKey: false, conversations: [], messages: [] });
  let validationCalls = 0;
  let savedKey = false;
  await page.route('**/functions/v1/provider-settings*', async (route) => {
    const body = route.request().method() === 'POST'
      ? route.request().postDataJSON() as Record<string, unknown>
      : {};
    if (body.action === 'validate_key') {
      validationCalls++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'openrouter', status: validationCalls === 1 ? 'unavailable' : 'enabled', message: 'metadata check unavailable' }) });
      return;
    }
    if (body.action === 'set_key') {
      savedKey = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [{ id: 'openrouter', label: 'OpenRouter', enabled: true, hasKey: true, keyLast4: '0715', status: 'enabled' }], defaultProvider: 'openrouter' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: savedKey ? [{ id: 'openrouter', label: 'OpenRouter', enabled: true, hasKey: true, keyLast4: '0715', status: 'enabled' }] : [], defaultProvider: 'openrouter' }) });
  });
  await signInAsMockUser(page);
  await page.locator('#first-run-openrouter-key').fill('sk-or-synthetic-unverified-0715');
  await page.getByRole('button', { name: 'Connect & Start' }).click();
  const routeStatus = page.locator('.arctic-route-status');
  await expect(routeStatus).toContainText('Verification unavailable');
  await expect(routeStatus).toHaveClass(/setup/);
  let routerCalls = 0;
  await page.route('**/functions/v1/router*', async (route) => {
    routerCalls++;
    await route.fulfill(successfulStream('Verified key mock reply', 'verified-key-retry'));
  });
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Keep this draft while verifying');
  await composer.press('Enter');
  expect(routerCalls).toBe(0);
  await expect(composer).toHaveValue('Keep this draft while verifying');
  await page.getByRole('button', { name: 'Verify provider keys' }).click();
  await expect(routeStatus).toContainText('Provider verified · route ready');
  await composer.press('Enter');
  await expect(page.getByText('Verified key mock reply')).toBeVisible();
  expect(routerCalls).toBe(1);

  await page.reload();
  await signInAsMockUser(page, { verifyConfiguredProviders: false });
  await expect(routeStatus).toContainText('Key saved · not verified');
  const verifyAfterReload = page.getByRole('button', { name: 'Verify provider keys' });
  await expect(verifyAfterReload).toBeVisible();
  await expect(page.locator('.first-run-status.success')).toHaveCount(0);
  await composer.fill('Verification must be repeated after reload');
  await composer.press('Enter');
  expect(routerCalls).toBe(1);
  await expect(composer).toHaveValue('Verification must be repeated after reload');
  await verifyAfterReload.click();
  await expect(routeStatus).toContainText('Provider verified · route ready');
  await composer.press('Enter');
  await expect(page.getByText('Verified key mock reply')).toBeVisible();
  expect(routerCalls).toBe(2);
});

test('attachment-only route rejection removes only its optimistic turn and retry restores one row', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  let routerCalls = 0;
  await page.route('**/functions/v1/router*', async (route) => {
    routerCalls++;
    if (routerCalls === 1) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'provider_key_required' }) });
      return;
    }
    await route.fulfill(successfulStream('Attachment retry completed', 'attachment-retry'));
  });
  await signInAsMockUser(page);
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic attachment only') });
  await expect(page.locator('.draft-files-list .draft-file-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Send failed' })).toBeVisible();
  await expect(page.getByText('[1 file attached]', { exact: true })).toHaveCount(0);
  await expect(page.locator('.draft-files-list .draft-file-item')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Verify provider keys', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Verify provider keys', exact: true }).click();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('[1 file attached]', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Attachment retry completed')).toBeVisible();
  await expect(page.locator('.draft-files-list .draft-file-item')).toHaveCount(0);
  expect(routerCalls).toBe(2);
});

test('saved chat keeps Routing details reachable at wide desktop sizes', async ({ page }) => {
  const conversationId = 'wide-routing-chat';
  await setupAuthenticatedMock(page, {
    hasProviderKey: true,
    conversations: [{ id: conversationId, title: 'Saved routing fixture', last_activity_at: '2026-11-15T10:00:00.000Z', project_id: null }],
    messages: [
      { id: 'wide-routing-user', conversation_id: conversationId, role: 'user', content: 'A saved user turn', created_at: '2026-11-15T10:00:00.000Z' },
      { id: 'wide-routing-assistant', conversation_id: conversationId, role: 'assistant', content: 'A saved assistant reply', created_at: '2026-11-15T10:00:01.000Z' },
    ],
  });
  await signInAsMockUser(page);
  await expect(page.getByText('Saved routing fixture')).toBeVisible();
  await page.getByText('Saved routing fixture').click();
  await expect(page.locator('.arctic-workbench')).toHaveClass(/arctic-has-history/);
  for (const width of [1440, 1672]) {
    await page.setViewportSize({ width, height: width === 1672 ? 941 : 900 });
    const toggle = page.getByRole('button', { name: 'Routing details', exact: true });
    await expect(toggle).toBeVisible();
    await expect(page.locator('.arctic-routing-panel')).toBeHidden();
    await toggle.click();
    await expect(page.locator('.arctic-routing-panel')).toBeVisible();
    await expect(page.locator('.arctic-routing-panel')).toContainText('Routing details');
    await page.getByRole('button', { name: 'Close routing details' }).click();
    await expect(toggle).toBeFocused();
    await expect(page.locator('.arctic-routing-panel')).toBeHidden();
  }
});
