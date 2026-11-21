import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';
import { getCatalogEntry } from '../../src/modelCatalog';

const successfulStream = (text: string, executionId: string) => ({
  status: 200,
  headers: { 'Content-Type': 'text/event-stream', 'Access-Control-Expose-Headers': 'X-Router-Model, X-Provider, X-Prismatix-Execution-Id', 'X-Router-Model': 'gemini-3.8-flash', 'X-Provider': 'mock', 'X-Prismatix-Execution-Id': executionId },
  body: [
    { type: 'meta', model: 'gemini-3.8-flash', cost: { finalUsd: 0.0001 } },
    { type: 'content_block_delta', delta: { text } },
    { type: 'receipt', executionId, status: 'completed', transcript: { saved: true }, settlement: { state: 'settled', committedUsd: 0.0001, pendingCalls: 0 }, calls: [{ stage: 'baseline', participant: 'openrouter', attemptNumber: 1, servedModel: 'gemini-3.8-flash', costStatus: 'settled', totalCost: 0.0001 }] },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
});

async function selectHistory(page: Page, title: string) {
  const sidebar = page.getByRole('complementary', { name: 'Conversations' });
  const toggle = page.getByRole('button', { name: 'Toggle conversations sidebar' });
  const mobileDrawer = await toggle.isVisible();
  if (mobileDrawer && await toggle.getAttribute('aria-expanded') !== 'true') {
    await toggle.click();
  }
  await expect(sidebar).toBeVisible();
  await sidebar.getByText(title, { exact: true }).click();
  if (mobileDrawer) await expect(toggle).toHaveAttribute('aria-expanded', 'false');
}

test('failed-send text survives reload in its tab without auto-dispatch', async ({ page }) => {
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  let routerRequests = 0;
  await page.route('**/functions/v1/router*', async (route) => {
    routerRequests++;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'provider_key_unavailable' }) });
  });
  await signInAsMockUser(page);
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Recover this text after reload');
  await composer.press('Enter');
  await expect(page.locator('.draft-recovery-bar')).toContainText('can survive a refresh');
  expect(routerRequests).toBe(1);
  expect(await page.evaluate(() => Object.values(localStorage).join('\n'))).not.toContain('Recover this text after reload');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Message Prismatix' })).toBeVisible();
  const recovery = page.locator('.draft-recovery-bar');
  await expect(recovery).toContainText('Check your chat history before sending again');
  await expect(recovery.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await recovery.getByRole('button', { name: 'Restore draft' }).click();
  await expect(composer).toHaveValue('Recover this text after reload');
  await expect(recovery).toBeHidden();
  expect(routerRequests).toBe(1);
});

test('reload during a send preserves the prompt without automatically sending again', async ({ page }) => {
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  let routerRequests = 0;
  let releaseRouter!: () => void;
  const routerGate = new Promise<void>((resolve) => { releaseRouter = resolve; });
  await page.route('**/functions/v1/router*', async (route) => {
    routerRequests++;
    if (routerRequests === 1) {
      await routerGate;
      await route.abort().catch(() => {});
    } else {
      await route.fulfill(successfulStream('Independent answer with a saved transcript', 'pending-draft-proof'));
    }
  });
  await signInAsMockUser(page);
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Hold my exact prompt during a reload');
  await composer.press('Enter');
  await expect.poll(() => routerRequests).toBe(1);
  expect(await page.evaluate(() => Object.values(sessionStorage))).toContain('Hold my exact prompt during a reload');
  try {
    await page.reload();
    const recovery = page.locator('.draft-recovery-bar');
    await expect(recovery).toContainText('Check your chat history before sending again');
    expect(routerRequests).toBe(1);
    await composer.fill('Send a separate prompt');
    await composer.press('Enter');
    await expect(page.getByText('Independent answer with a saved transcript')).toBeVisible();
    expect(routerRequests).toBe(2);
    await page.reload();
    await expect(recovery).toContainText('Check your chat history before sending again');
    await recovery.getByRole('button', { name: 'Restore draft' }).click();
    await expect(composer).toHaveValue('Hold my exact prompt during a reload');
    expect(routerRequests).toBe(2);
  } finally {
    releaseRouter();
  }
});

test('unsent text stays with the conversation across navigation and reload', async ({ page }) => {
  const first = 'draft-history-first';
  const second = 'draft-history-second';
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [
    { id: first, title: 'Draft history first', last_activity_at: '2026-11-16T00:00:00Z', project_id: null },
    { id: second, title: 'Draft history second', last_activity_at: '2026-11-15T00:00:00Z', project_id: null },
  ], messages: [] });
  await signInAsMockUser(page);
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await selectHistory(page, 'Draft history first');
  await composer.fill('Draft for the first conversation');
  await selectHistory(page, 'Draft history second');
  await expect(composer).toHaveValue('');
  await composer.fill('Draft for the second conversation');
  await page.reload();
  await expect(composer).toHaveValue('Draft for the second conversation');
  await selectHistory(page, 'Draft history first');
  await expect(composer).toHaveValue('Draft for the first conversation');
});

test('Compare preserves interrupted model outcome and warns when either transcript was not saved', async ({ page }) => {
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  let requests = 0;
  await page.route('**/functions/v1/router*', async (route) => {
    const body = route.request().postDataJSON() as { modelOverride?: string };
    requests++;
    if (body.modelOverride === 'gemini-3.8-flash') {
      const events = [
        { type: 'content_block_delta', delta: { text: 'Partial answer A' } },
        { type: 'receipt', executionId: 'compare-a', status: 'indeterminate', terminalOutcome: 'upstream_interrupted', transcript: { saved: false }, settlement: { state: 'pending', committedUsd: null, pendingCalls: 1 }, calls: [] },
      ];
      await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Access-Control-Expose-Headers': 'X-Router-Model', 'X-Router-Model': 'gemini-3.8-flash' }, body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') });
      return;
    }
    await route.fulfill(successfulStream('Complete answer B', `compare-${requests}`));
  });
  await signInAsMockUser(page);
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Compare without hiding a partial result');
  await composer.press('Enter');
  await expect(page.getByText('Partial answer A')).toBeVisible();
  await expect(page.locator('.transcript-unsaved-notice')).toContainText('could not be saved');
  await expect(page.getByText('Interrupted · partial response')).toBeVisible();
  await expect(page.getByText('Complete answer B')).toBeVisible();
  expect(requests).toBe(2);
  await page.reload();
  await expect(page.getByText(/Review recovered response/)).toHaveCount(1);
  await page.getByText(/Review recovered response/).click();
  await expect(page.getByRole('textbox', { name: 'Recovered response text' })).toHaveValue('Partial answer A');
  expect(requests).toBe(2);
});

test('Compare keeps its rollout-disabled result visible without writing assistant rows', async ({ page }) => {
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  let requests = 0;
  const writes: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/messages') && request.method() !== 'GET') writes.push(request.method());
    if (path.endsWith('/px08_persist_compare')) writes.push(request.method());
  });
  await page.route('**/functions/v1/router*', async (route) => {
    requests++;
    await route.fulfill(successfulStream(`Completed model ${requests}`, `compare-write-${requests}`));
  });
  await signInAsMockUser(page);
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Compare without rewriting an assistant row');
  await composer.press('Enter');
  await expect(page.getByText('Completed model 1')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('could not be saved');
  expect(requests).toBe(2);
  expect(writes).toEqual([]);
});

test('ordinary Chat visibly marks a router-reported unsaved answer without retrying it', async ({ page }) => {
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  let requests = 0;
  await page.route('**/functions/v1/router*', async (route) => {
    requests++;
    const events = [
      { type: 'content_block_delta', delta: { text: 'Keep this generated answer visible' } },
      { type: 'receipt', executionId: 'single-unsaved', status: 'completed', transcript: { saved: false }, settlement: { state: 'settled', committedUsd: 0.0001, pendingCalls: 0 }, calls: [{ stage: 'baseline', participant: 'openrouter', attemptNumber: 1, servedModel: 'gemini-3.8-flash', costStatus: 'settled', totalCost: 0.0001 }] },
    ];
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Access-Control-Expose-Headers': 'X-Router-Model', 'X-Router-Model': 'gemini-3.8-flash' }, body: `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n` });
  });
  await signInAsMockUser(page);
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Return an answer but report storage failure');
  await composer.press('Enter');
  await expect(page.getByText('Keep this generated answer visible')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('could not be saved');
  await expect(page.getByRole('button', { name: 'Copy response' })).toBeVisible();
  for (const theme of ['light', 'dark']) {
    const ratio = await page.locator('.transcript-unsaved-notice').evaluate((notice) => {
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
      };
      const style = getComputedStyle(notice);
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(ratio, `${theme} unsaved response warning`).toBeGreaterThanOrEqual(4.5);
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Account menu' }).click();
      await page.getByRole('button', { name: 'Dark theme' }).click();
    }
  }
  expect(requests).toBe(1);
});

test('pending settlement never turns streamed cost metadata into a final charge', async ({ page }) => {
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  await page.route('**/functions/v1/router*', async (route) => {
    const events = [
      { type: 'meta', cost: { finalUsd: 0.42 } },
      { type: 'content_block_delta', delta: { text: 'The answer is still settling.' } },
      { type: 'receipt', executionId: 'pending-cost', status: 'completed', transcript: { saved: true }, settlement: { state: 'pending', committedUsd: 0, pendingCalls: 1 }, calls: [] },
    ];
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Access-Control-Expose-Headers': 'X-Router-Model', 'X-Router-Model': 'gemini-3.8-flash' }, body: `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n` });
  });
  await signInAsMockUser(page);
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Show pending cost');
  await composer.press('Enter');
  await expect(page.getByText('The answer is still settling.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Cost: .*pending/ })).toBeVisible();
  await expect(page.locator('.cost-estimator-title')).toHaveText('Estimated total');
});

test('spend analytics separates recorded statuses on a narrow screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  const bucket = { settled: 1, pending: 0.5, estimatedLegacy: 0.2 };
  await page.route('**/functions/v1/spend_stats*', (route) => route.fulfill({ json: {
    today: 1.7, thisWeek: 1.7, thisMonth: 1.7, allTime: 1.7, lastMessageCost: 0.5, messageCount: 3,
    qualified: { today: bucket, thisWeek: bucket, thisMonth: bucket, allTime: bucket },
  } }));
  await signInAsMockUser(page);
  await expect(page.locator('.spend-pill-state')).toHaveText('Server');
  await page.locator('.spend-pill').click();
  const today = page.locator('.spend-card').first();
  await expect(today).toContainText('Recorded as settled $1.0000');
  await expect(today).toContainText('Pending $0.5000');
  await expect(today).toContainText('Legacy estimate $0.2000');
  const contrastRatios = async () => page.locator('.spend-popover').evaluate((popover) => {
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    };
    return ['.spend-qualification-note', '.spend-label', '.spend-value', '.spend-card-breakdown'].map((selector) => {
      const element = popover.querySelector(selector)!;
      let surface: Element = element;
      while (getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') surface = surface.parentElement!;
      const foreground = luminance(getComputedStyle(element).color);
      const background = luminance(getComputedStyle(surface).backgroundColor);
      return { selector, ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) };
    });
  });
  for (const { selector, ratio } of await contrastRatios()) expect(ratio, `light ${selector}`).toBeGreaterThanOrEqual(4.5);
  const bounds = await page.locator('.spend-popover').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: window.innerWidth, height: window.innerHeight, documentWidth: document.documentElement.scrollWidth };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
  expect(bounds.documentWidth).toBeLessThanOrEqual(bounds.width);
  await page.screenshot({ path: testInfo.outputPath('spend-status-mobile.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Export Spend CSV' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Export Spend CSV' })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(page.locator('.spend-popover')).toHaveCount(0);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Dark theme' }).click();
  await page.locator('.spend-pill').click();
  for (const { selector, ratio } of await contrastRatios()) expect(ratio, `dark ${selector}`).toBeGreaterThanOrEqual(4.5);
});

test('an interrupted response remains recoverable after reload without another request', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  let requests = 0;
  await page.route('**/functions/v1/router*', async (route) => {
    requests++;
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Access-Control-Expose-Headers': 'X-Router-Model', 'X-Router-Model': 'gemini-3.8-flash' },
      body: `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: 'Useful partial response' } })}\n\n`,
    });
  });
  await signInAsMockUser(page);
  await page.getByRole('textbox', { name: 'Message Prismatix' }).fill('Keep the interrupted answer');
  await page.getByRole('textbox', { name: 'Message Prismatix' }).press('Enter');
  await expect(page.getByText(/Useful partial response/)).toBeVisible();
  await expect(page.getByText(/Connection closed prematurely/)).toBeVisible();
  await page.reload();
  await page.getByText(/Review recovered response/).click();
  const recovered = page.getByRole('textbox', { name: 'Recovered response text' });
  await expect(recovered).toHaveValue('Useful partial response');
  await expect(page.getByText(/may also be in your chat history/)).toBeVisible();
  const dismiss = page.getByRole('button', { name: 'Dismiss recovered response' });
  await dismiss.scrollIntoViewIfNeeded();
  const canDismiss = await dismiss.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const main = button.closest('main')!.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.top >= main.top && rect.bottom <= main.bottom && (hit === button || button.contains(hit));
  });
  expect(canDismiss).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Message Prismatix' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('response-recovery-mobile.png'), animations: 'disabled' });
  expect(await page.evaluate(() => Object.values(localStorage).join('\n'))).not.toContain('Useful partial response');
  expect(requests).toBe(1);
});

for (const action of ['reload', 'stop'] as const) test(`${action} during a streamed response keeps received text without resending`, async ({ page }) => {
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  await page.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
      if (!url.pathname.endsWith('/functions/v1/router')) return realFetch(input, init);
      const previous = Number(sessionStorage.getItem('synthetic-router-calls') ?? '0');
      sessionStorage.setItem('synthetic-router-calls', String(previous + 1));
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: 'Partial text while streaming' } })}\n\n`));
          init?.signal?.addEventListener('abort', () => controller.close(), { once: true });
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Access-Control-Expose-Headers': 'X-Router-Model, X-Prismatix-Execution-Id', 'X-Router-Model': 'gemini-3.8-flash', 'X-Prismatix-Execution-Id': 'stream-reload-fixture' } });
    };
  });
  await signInAsMockUser(page);
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Preserve the stream in progress');
  await composer.press('Enter');
  await expect(page.getByText('Partial text while streaming')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeVisible();
  if (action === 'stop') {
    await page.getByRole('button', { name: 'Stop generating' }).click();
    await expect(page.locator('.transcript-unsaved-notice')).toBeVisible();
  }
  await page.reload();
  await page.getByText(/Review recovered response/).click();
  await expect(page.getByRole('textbox', { name: 'Recovered response text' })).toHaveValue('Partial text while streaming');
  expect(await page.evaluate(() => sessionStorage.getItem('synthetic-router-calls'))).toBe('1');
});

test('reload during Compare preserves each received response without resending', async ({ page }) => {
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  await page.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
      if (!url.pathname.endsWith('/functions/v1/router')) return realFetch(input, init);
      const previous = Number(sessionStorage.getItem('synthetic-compare-calls') ?? '0');
      sessionStorage.setItem('synthetic-compare-calls', String(previous + 1));
      const request = JSON.parse(String(init?.body)) as { modelOverride: string };
      const content = `Partial ${request.modelOverride}`;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: content } })}\n\n`));
          init?.signal?.addEventListener('abort', () => controller.close(), { once: true });
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Access-Control-Expose-Headers': 'X-Router-Model', 'X-Router-Model': request.modelOverride } });
    };
  });
  await signInAsMockUser(page);
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Keep both partial responses');
  await composer.press('Enter');
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('prismatix.response-recovery.')).length)).toBe(2);
  await page.reload();
  const summaries = page.getByText(/Review recovered response/);
  await expect(summaries).toHaveCount(2);
  await summaries.nth(0).click();
  await summaries.nth(1).click();
  const recovered = page.getByRole('textbox', { name: 'Recovered response text' });
  await expect(recovered).toHaveCount(2);
  expect(await Promise.all((await recovered.all()).map((item) => item.inputValue()))).toEqual(expect.arrayContaining(['Partial gemini-3.8-flash', 'Partial gpt-6-sol']));
  expect(await page.evaluate(() => sessionStorage.getItem('synthetic-compare-calls'))).toBe('2');
});

test('retry rechecks the daily budget and keeps the failed draft when spending is blocked', async ({ page }) => {
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  let routerRequests = 0;
  let today = 0;
  await page.route('**/functions/v1/spend_stats*', (route) => route.fulfill({ json: { today } }));
  await page.route('**/functions/v1/router*', async (route) => {
    routerRequests++;
    if (routerRequests === 1) await route.abort('failed');
    else await route.fulfill(successfulStream('Retry completed', 'retry-budget'));
  });
  await signInAsMockUser(page);
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Keep my failed draft while spending is blocked');
  await composer.press('Enter');
  const recovery = page.locator('.draft-recovery-bar');
  await expect(recovery).toBeVisible();
  const retry = recovery.getByRole('button', { name: 'Retry', exact: true });

  today = 2;
  await retry.click();
  await expect(page.getByText(/Daily budget exceeded/)).toBeVisible();
  await expect(recovery).toBeVisible();
  expect(routerRequests).toBe(1);

  today = 0;
  await retry.click();
  await expect(page.getByText('Retry completed')).toBeVisible();
  expect(routerRequests).toBe(2);
});

test('regenerate claims a single paid turn while its budget check is pending', async ({ page }) => {
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  let routerRequests = 0;
  let holdSpend = false;
  let releaseSpend!: () => void;
  const spendGate = new Promise<void>((resolve) => { releaseSpend = resolve; });
  await page.route('**/functions/v1/spend_stats*', async (route) => {
    if (holdSpend) await spendGate;
    await route.fulfill({ json: { today: 0 } });
  });
  await page.route('**/functions/v1/router*', async (route) => {
    routerRequests++;
    await route.fulfill(successfulStream(`Answer ${routerRequests}`, `regenerate-${routerRequests}`));
  });
  await signInAsMockUser(page);
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('A prompt to regenerate');
  await composer.press('Enter');
  await expect(page.getByText('Answer 1', { exact: true })).toBeVisible();
  const regenerate = page.getByRole('button', { name: 'Regenerate response', exact: true });
  holdSpend = true;
  await regenerate.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  try {
    await expect(page.locator('.send-preflight-status')).toBeVisible({ timeout: 1500 });
  } finally {
    holdSpend = false;
    releaseSpend();
  }
  await expect(page.getByText('Answer 2', { exact: true })).toBeVisible();
  expect(routerRequests).toBe(2);
});

test('opening a slow conversation cannot send the previous transcript as context', async ({ page }) => {
  const first = 'history-context-first';
  const second = 'history-context-second';
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [
    { id: first, title: 'First history', last_activity_at: '2026-11-16T00:00:00Z', project_id: null },
    { id: second, title: 'Second history', last_activity_at: '2026-11-15T00:00:00Z', project_id: null },
  ], messages: [
    { id: 'history-context-message', conversation_id: first, role: 'user', content: 'Old conversation context', created_at: '2026-11-16T00:00:00Z' },
  ] });
  let releaseHistory!: () => void;
  const historyGate = new Promise<void>((resolve) => { releaseHistory = resolve; });
  await page.route('**/rest/v1/messages?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('conversation_id') !== `eq.${second}`) return route.fallback();
    await historyGate;
    await route.fulfill({ json: [] });
  });
  const paidRequests: unknown[] = [];
  await page.route('**/functions/v1/router*', async (route) => {
    paidRequests.push(route.request().postDataJSON());
    await route.fulfill(successfulStream('Reply in the second chat', 'history-context'));
  });
  await signInAsMockUser(page);
  await selectHistory(page, 'First history');
  await expect(page.getByText('Old conversation context', { exact: true })).toBeVisible();
  await selectHistory(page, 'Second history');
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  try {
    await expect(page.getByText('Old conversation context', { exact: true })).toHaveCount(0);
    await composer.fill('Continue the second conversation');
    await composer.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Loading conversation' })).toBeVisible();
    expect(paidRequests).toEqual([]);
  } finally {
    releaseHistory();
  }
  await expect(page.getByRole('status').filter({ hasText: 'Loading conversation' })).toHaveCount(0);
  await composer.press('Enter');
  await expect(page.getByText('Reply in the second chat')).toBeVisible();
  expect(paidRequests).toHaveLength(1);
  expect(JSON.stringify(paidRequests[0])).not.toContain('Old conversation context');
});

test('New Chat after visiting saved history gets a fresh router conversation identity', async ({ page }) => {
  await setupAuthenticatedMock(page);
  const sentIds: string[] = [];
  await page.route('**/functions/v1/router*', async (route) => {
    sentIds.push(route.request().postDataJSON().conversationId);
    await route.fulfill(successfulStream(`New chat answer ${sentIds.length}`, `fresh-chat-${sentIds.length}`));
  });
  await signInAsMockUser(page);
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('First new conversation');
  await composer.press('Enter');
  await expect(page.getByText('New chat answer 1', { exact: true })).toBeVisible();
  await selectHistory(page, 'Architectural Discussion');
  await expect(page.getByText(/Paxos and Raft both solve/)).toBeVisible();
  const sidebarToggle = page.getByRole('button', { name: 'Toggle conversations sidebar' });
  const newChat = page.getByRole('button', { name: '+ New Chat' });
  if (await sidebarToggle.isVisible() && await sidebarToggle.getAttribute('aria-expanded') !== 'true') {
    await sidebarToggle.click();
  }
  await newChat.click();
  await composer.fill('Second new conversation');
  await composer.press('Enter');
  await expect(page.getByText('New chat answer 2', { exact: true })).toBeVisible();
  expect(sentIds).toHaveLength(2);
  expect(sentIds[0]).toMatch(/^[0-9a-f-]{36}$/i);
  expect(sentIds[1]).toMatch(/^[0-9a-f-]{36}$/i);
  expect(sentIds[1]).not.toBe(sentIds[0]);
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

test('slow spend preflight owns one logical send across rapid click and Enter', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  let releaseSpend!: () => void;
  let signalSpendStarted!: () => void;
  let blockNextSpendRequest = false;
  let spendRequestBlocked = false;
  const spendStarted = new Promise<void>((resolve) => { signalSpendStarted = resolve; });
  const spendResponseGate = new Promise<void>((resolve) => { releaseSpend = resolve; });
  let routerRequests = 0;
  await page.route('**/functions/v1/router*', async (route) => {
    routerRequests++;
    await route.fulfill(successfulStream('Single paid mock answer', 'single-logical-send'));
  });
  await signInAsMockUser(page);
  await page.route('**/functions/v1/spend_stats*', async (route) => {
    if (blockNextSpendRequest) {
      if (!spendRequestBlocked) {
        spendRequestBlocked = true;
        signalSpendStarted();
      }
      await spendResponseGate;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ today: 0 }) });
  });
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Do not dispatch this twice');
  blockNextSpendRequest = true;
  await composer.focus();
  await page.getByRole('button', { name: 'Send message' }).click();
  await spendStarted;
  await expect(page.locator('.send-preflight-status')).toContainText('Checking your daily budget');
  await page.evaluate(() => document.querySelector<HTMLTextAreaElement>('.chat-input')?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  ));
  releaseSpend();
  await expect(page.getByText('Single paid mock answer')).toBeVisible();
  expect(routerRequests).toBe(1);
  await expect(page.getByText('Do not dispatch this twice', { exact: true })).toHaveCount(1);
});

test('a budget lookup that exceeds its deadline preserves the draft without dispatch', async ({ page }) => {
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  let releaseSpend!: () => void;
  let signalSpendStarted!: () => void;
  let blockNextSpendRequest = false;
  let blocked = false;
  const spendStarted = new Promise<void>((resolve) => { signalSpendStarted = resolve; });
  const spendResponseGate = new Promise<void>((resolve) => { releaseSpend = resolve; });
  await signInAsMockUser(page);
  await page.route('**/functions/v1/spend_stats*', async (route) => {
    if (blockNextSpendRequest) {
      if (!blocked) {
        blocked = true;
        signalSpendStarted();
      }
      await spendResponseGate;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ today: 0 }) });
  });
  let routerRequests = 0;
  await page.route('**/functions/v1/router*', async (route) => { routerRequests++; await route.fulfill(successfulStream('Should not dispatch', 'budget-timeout')); });
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Keep me while the budget lookup stalls');
  blockNextSpendRequest = true;
  await page.getByRole('button', { name: 'Send message' }).click();
  await spendStarted;
  await expect(page.getByRole('alert')).toContainText('Daily budget check did not finish', { timeout: 12000 });
  await expect(composer).toHaveValue('Keep me while the budget lookup stalls');
  expect(routerRequests).toBe(0);
  releaseSpend();
  expect(await page.evaluate(() => Object.values(localStorage).join('\n'))).not.toContain('Keep me while the budget lookup stalls');
});

test('late budget response after sign-out cannot dispatch into another account', async ({ page }, testInfo) => {
  const narrowMobile = testInfo.project.name === 'mobile';
  if (narrowMobile) await page.setViewportSize({ width: 390, height: 844 });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  let releaseSpend!: () => void;
  let signalSpendStarted!: () => void;
  let blockNextSpendRequest = false;
  let blocked = false;
  const spendStarted = new Promise<void>((resolve) => { signalSpendStarted = resolve; });
  const spendResponseGate = new Promise<void>((resolve) => { releaseSpend = resolve; });
  await signInAsMockUser(page);
  await page.route('**/functions/v1/spend_stats*', async (route) => {
    if (blockNextSpendRequest) {
      if (!blocked) {
        blocked = true;
        signalSpendStarted();
      }
      await spendResponseGate;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ today: 0 }) });
  });
  let routerRequests = 0;
  await page.route('**/functions/v1/router*', async (route) => { routerRequests++; await route.fulfill(successfulStream('Must not cross accounts', 'stale-budget')); });
  await page.route('**/auth/v1/logout*', async (route) => route.fulfill({ status: 204, body: '' }));
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Account-scoped pending draft');
  blockNextSpendRequest = true;
  await page.getByRole('button', { name: 'Send message' }).click();
  await spendStarted;
  await expect(page.locator('.send-preflight-status')).toContainText('Checking your daily budget');
  // The mobile drawer starts collapsed, so New Chat is intentionally not in
  // the accessibility tree. Assert the visible send control is locked there;
  // desktop additionally exposes and locks the New Chat action.
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  if (!narrowMobile) await expect(page.getByRole('button', { name: /new chat/i })).toBeDisabled();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page.locator('#email')).toBeVisible();
  releaseSpend();
  await page.waitForTimeout(100);
  expect(routerRequests).toBe(0);
});

for (const viewport of [
  { name: 'compact desktop', width: 1024, height: 600 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'narrow mobile', width: 320, height: 844 },
]) {
  test(`settled cost Details stay reachable without covering composer at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });

    let signalRouterStarted!: () => void;
    let releaseRouterResponse!: () => void;
    const routerStarted = new Promise<void>((resolve) => { signalRouterStarted = resolve; });
    const routerResponseReleased = new Promise<void>((resolve) => { releaseRouterResponse = resolve; });
    await page.route('**/functions/v1/router*', async (route) => {
      signalRouterStarted();
      await routerResponseReleased;
      await route.fulfill(successfulStream('Settled local reply with synthetic receipt', `cost-layout-${viewport.width}`));
    });

    const evidenceDir = process.env.UI_BENCHMARK_EVIDENCE_DIR ?? testInfo.outputPath();
    await mkdir(evidenceDir, { recursive: true });
    const suffix = `${viewport.width}x${viewport.height}`;
    await signInAsMockUser(page);
    const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
    await composer.fill('Check that the cost panel stays clear of the composer');
    await composer.press('Enter');
    await routerStarted;

    const estimator = page.locator('.cost-estimator');
    await expect(estimator).toHaveClass(/streaming/);
    await page.screenshot({ path: `${evidenceDir}/cost-streaming-${suffix}.png`, animations: 'disabled' });
    const checkComposerHitTargets = async () => page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.cost-estimator');
      const composerContainer = document.querySelector<HTMLElement>('.chat-input-container');
      const controls = [...document.querySelectorAll<HTMLElement>(
        '.chat-input-container .chat-input:not(:disabled), .chat-input-container .file-upload-button:not(:disabled), .chat-input-container .send-button:not(:disabled), .chat-input-container .stop-button:not(:disabled)',
      )].filter((element) => {
        const box = element.getBoundingClientRect();
        return getComputedStyle(element).display !== 'none' && box.width > 0 && box.height > 0
          && box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight;
      });
      if (!panel || !composerContainer) return { panelVisible: false, composerOverlap: true, detailsVisible: false, overlaps: [] as string[], blocked: [] as string[] };
      const panelBox = panel.getBoundingClientRect();
      const composerBox = composerContainer.getBoundingClientRect();
      const messageViewport = panel.closest('.chat-messages')?.getBoundingClientRect();
      const visiblePanelBox = messageViewport ? {
        left: Math.max(0, panelBox.left, messageViewport.left),
        right: Math.min(window.innerWidth, panelBox.right, messageViewport.right),
        top: Math.max(0, panelBox.top, messageViewport.top),
        bottom: Math.min(window.innerHeight, panelBox.bottom, messageViewport.bottom),
      } : null;
      const composerViewportFit = composerBox.top >= 0 && composerBox.bottom <= window.innerHeight;
      const detailsButton = panel.querySelector<HTMLElement>('.cost-estimator-details-toggle');
      const detailsBox = detailsButton?.getBoundingClientRect();
      const detailsVisible = Boolean(detailsBox && visiblePanelBox && detailsBox.top >= visiblePanelBox.top
        && detailsBox.bottom <= visiblePanelBox.bottom && detailsBox.left >= visiblePanelBox.left
        && detailsBox.right <= visiblePanelBox.right);
      const overlaps: string[] = [];
      const blocked: string[] = [];
      for (const control of controls) {
        const box = control.getBoundingClientRect();
        if (visiblePanelBox && box.left < visiblePanelBox.right && box.right > visiblePanelBox.left
          && box.top < visiblePanelBox.bottom && box.bottom > visiblePanelBox.top) {
          overlaps.push(control.getAttribute('aria-label') || control.className.toString());
        }
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (hit !== control && !control.contains(hit)) blocked.push(control.getAttribute('aria-label') || control.className.toString());
      }
      const result = {
        panelVisible: panelBox.width > 0 && panelBox.height > 0,
        composerOverlap: Boolean(visiblePanelBox && visiblePanelBox.left < composerBox.right && visiblePanelBox.right > composerBox.left
          && visiblePanelBox.top < composerBox.bottom && visiblePanelBox.bottom > composerBox.top),
        composerViewportFit,
        detailsVisible,
        overlaps,
        blocked,
      };
      return result;
    });
    const details = estimator.locator('.cost-estimator-details-toggle');
    await details.scrollIntoViewIfNeeded();
    await expect(details).toBeVisible();
    const detailHitTarget = await details.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit === element || element.contains(hit);
    });
    expect(detailHitTarget).toBe(true);
    const streamingHitTargets = await checkComposerHitTargets();
    const detailsBox = await details.boundingBox();
    if (!detailsBox) throw new Error('Cost Details control has no rendered hit area after scrolling into view');
    await page.mouse.click(detailsBox.x + detailsBox.width / 2, detailsBox.y + detailsBox.height / 2);
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    await details.focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    await page.screenshot({ path: `${evidenceDir}/cost-streaming-details-expanded-${suffix}.png`, animations: 'disabled' });

    releaseRouterResponse();
    await expect(page.getByText('Settled local reply with synthetic receipt')).toBeVisible();
    await expect(estimator).toHaveClass(/final/);
    await expect(estimator).toContainText('Settled total');
    await expect(estimator).toContainText('$0.0001');
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    await details.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidenceDir}/cost-settled-details-expanded-${suffix}.png`, animations: 'disabled' });
    const settledHitTargets = await checkComposerHitTargets();

    await page.waitForTimeout(3200);
    const remainsVisibleDuringKeyboardInteraction = await estimator.isVisible();
    const retainsDetailsFocus = await details.evaluate((element) => document.activeElement === element).catch(() => false);
    expect({ streamingHitTargets, settledHitTargets, remainsVisibleDuringKeyboardInteraction, retainsDetailsFocus }).toEqual({
      streamingHitTargets: { panelVisible: true, composerOverlap: false, composerViewportFit: true, detailsVisible: true, overlaps: [], blocked: [] },
      settledHitTargets: { panelVisible: true, composerOverlap: false, composerViewportFit: true, detailsVisible: true, overlaps: [], blocked: [] },
      remainsVisibleDuringKeyboardInteraction: true,
      retainsDetailsFocus: true,
    });
    await expect(estimator).toBeVisible();
    await expect(details).toBeFocused();
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    await details.press('Enter');
    await expect(details).toHaveAttribute('aria-expanded', 'false');
    await page.screenshot({ path: `${evidenceDir}/cost-settled-collapsed-${suffix}.png`, animations: 'disabled' });
    await details.press('Enter');
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    await expect(details).toBeFocused();

    await composer.fill('Draft for the next local send');
    await composer.focus();
    await expect(estimator).toBeVisible();
    await expect(estimator).toBeHidden({ timeout: 4000 });
  });
}

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
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => undefined }));
    await recovery.getByRole('button', { name: 'Copy draft' }).click();
    await expect(recovery.getByRole('textbox', { name: 'Draft text to copy manually' })).toHaveValue('Keep this exact draft');
    expect(await page.evaluate(() => Object.values(localStorage).join('\n'))).not.toContain('Keep this exact draft');
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

    // A router rejection is explicit; a second send must remain blocked until
    // the user verifies or updates the provider, with the draft retained.
    await composer.press('Enter');
    expect(requests).toBe(1);
    await expect(composer).toHaveValue('Keep this exact draft');

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

for (const unrelatedStatus of ['invalid_revoked', 'unavailable'] as const) {
  test(`unrelated ${unrelatedStatus} provider does not block Auto or current-priced manual sends`, async ({ page }) => {
    const currentPricedModel = 'gemini-3.8-flash';
    const currentPricedModelName = getCatalogEntry(currentPricedModel).shortName;
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
    await page.route('**/functions/v1/provider-settings*', async (route) => {
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() as Record<string, unknown> : {};
      if (body.action === 'validate_key') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: body.provider, status: 'enabled' }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          providers: [
            { id: 'openrouter', label: 'OpenRouter', enabled: true, hasKey: true, status: 'enabled' },
            { id: 'google', label: 'Google', enabled: true, hasKey: true, status: 'enabled' },
            { id: 'anthropic', label: 'Anthropic', enabled: true, hasKey: true, status: unrelatedStatus },
          ],
          defaultProvider: 'google',
        }),
      });
    });
    const routerRequests: Array<Record<string, unknown>> = [];
    await page.route('**/functions/v1/router*', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      routerRequests.push(body);
      await route.fulfill(successfulStream(`Mock response ${routerRequests.length}`, `unrelated-${unrelatedStatus}-${routerRequests.length}`));
    });

    await signInAsMockUser(page);
    const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
    await composer.fill('Use Auto with an unrelated provider issue');
    await composer.press('Enter');
    await expect(page.getByText('Mock response 1')).toBeVisible();

    await page.getByRole('button', { name: 'Choose routing mode: automatic' }).click();
    await page.getByRole('tab', { name: 'Models' }).click();
    await page.getByRole('searchbox', { name: 'Search models' }).fill(currentPricedModelName);
    await page.locator('.model-option').filter({ hasText: currentPricedModelName }).click();
    await expect(page.getByRole('button', { name: `Choose model: ${currentPricedModelName}` })).toBeVisible();
    await composer.fill('Use a current-priced model manually');
    await composer.press('Enter');
    await expect(page.getByText('Mock response 2')).toBeVisible();

    expect(routerRequests).toHaveLength(2);
    expect(routerRequests[0]?.modelOverride).toBeUndefined();
    expect(routerRequests[1]?.modelOverride).toBe(currentPricedModel);
  });
}

test('stale legacy model is labeled and rejected with a safe next step without retry', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  await page.route('**/functions/v1/provider-settings*', async (route) => {
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() as Record<string, unknown> : {};
    if (body.action === 'validate_key') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: body.provider, status: 'enabled' }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        providers: [{ id: 'google', label: 'Google', enabled: true, hasKey: true, status: 'enabled' }],
        defaultProvider: 'google',
      }),
    });
  });
  let routerRequests = 0;
  await page.route('**/functions/v1/router*', async (route) => {
    routerRequests++;
    if (routerRequests === 1) {
      await route.fulfill(successfulStream('Initial current-priced response', 'stale-pricing-setup'));
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'unknown_model_pricing', message: 'Pricing for this model is not verified or current.' }),
    });
  });

  await signInAsMockUser(page);
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Establish a chat before selecting a model');
  await composer.press('Enter');
  await expect(page.getByText('Initial current-priced response')).toBeVisible();
  await page.getByRole('button', { name: 'Choose routing mode: automatic' }).click();
  await page.getByRole('tab', { name: 'Models' }).click();
  const staleModelId = 'gemini-2.5-flash';
  const staleModelName = getCatalogEntry(staleModelId).shortName;
  await page.getByRole('region', { name: 'Historic model catalog' }).getByRole('button', { name: /Historic models/ }).click();
  const staleModelOption = page.locator('.model-option').filter({ hasText: staleModelName });
  await expect(staleModelOption).toContainText('Pricing needs review');
  await staleModelOption.click();
  await expect(page.getByRole('button', { name: `Choose model: ${staleModelName}` })).toBeVisible();

  await composer.fill('Use the stale model only once');
  await composer.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Pricing for this model is not verified or current');
  await expect(page.getByRole('alert')).toContainText('Choose a model with current pricing');
  await expect(composer).toHaveValue('Use the stale model only once');
  expect(routerRequests).toBe(2);
});

test('provider settings lookup failure blocks send, keeps draft, and retry restores router-authorized readiness', async ({ page }) => {
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
  await expect(page.locator('.arctic-route-status')).toContainText('Key saved · not checked this session');
  await expect(page.getByRole('button', { name: 'Verify provider keys' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'What can I help you with?' })).toBeVisible();
  await composer.fill('Draft survives a lookup failure');
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
  const composerBox = await page.locator('.chat-input-container').boundingBox();
  expect(composerBox).not.toBeNull();
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(600);
  const panelState = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('.first-run-card')!;
    const composer = document.querySelector<HTMLElement>('.chat-input-container')!;
    const input = document.querySelector<HTMLElement>('.chat-input')!;
    const statusButton = document.querySelector<HTMLElement>('.provider-setup-composer-status')!;
    const cardRect = card.getBoundingClientRect();
    const scrollportRect = card.closest('.chat-messages')!.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const statusRect = statusButton.getBoundingClientRect();
    return {
      setupClientHeight: card.clientHeight,
      setupScrollHeight: card.scrollHeight,
      overlapsComposer: Math.min(cardRect.bottom, scrollportRect.bottom) > composerRect.top + 1,
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
  const settingsTrigger = page.getByRole('button', { name: /Use another provider/i });
  await settingsTrigger.click();
  const settingsDialog = page.getByRole('dialog', { name: 'Provider plug-ins' });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog).toHaveJSProperty('open', true);
  expect(await settingsDialog.evaluate((el) => el.matches(':modal') && el.parentElement === document.body)).toBe(true);
  expect(await page.evaluate(() => document.elementFromPoint(1, 1)?.tagName)).toBe('DIALOG');
  await settingsDialog.getByRole('button', { name: 'Close provider plug-ins' }).focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  expect(await settingsDialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(settingsDialog).toHaveCount(0);
  await expect(settingsTrigger).toBeFocused();
  const demoAction = page.getByRole('link', { name: /public demo/i });
  await demoAction.scrollIntoViewIfNeeded();
  await expect(demoAction).toBeVisible();
  const demoHit = await demoAction.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === el || el.contains(hit);
  });
  expect(demoHit).toBe(true);
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
  expect(bounds.setupCanScroll).toBe(false);
  const alternate = page.getByRole('button', { name: 'Use another provider' });
  await alternate.scrollIntoViewIfNeeded();
  await expect(alternate).toBeInViewport();
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
  await expect(page.locator('.provider-readiness-banner[role="status"]')).toContainText('not been checked this session');
  await expect(page.getByRole('button', { name: 'Verify provider keys', exact: true })).toHaveCount(0);
  await composer.press('Enter');
  await expect(page.getByText('Saved chat recovered')).toBeVisible();
  expect(sends).toBe(1);
});

test('first-run unverified provider blocks; a returning configured key is router-authorized after reload', async ({ page }, testInfo) => {
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
  await page.getByRole('button', { name: 'Connect provider' }).click();
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
  await page.setViewportSize({ width: 1024, height: 600 });
  await expect(routeStatus).toContainText('Key saved · not checked this session');
  const verifyAfterReload = page.getByRole('button', { name: 'Verify provider keys' });
  await expect(verifyAfterReload).toHaveCount(0);
  await expect(page.locator('.first-run-status.success')).toHaveCount(0);
  const evidenceDir = process.env.UI_BENCHMARK_EVIDENCE_DIR ?? testInfo.outputPath();
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: `${evidenceDir}/returning-key-1024x600.png`, animations: 'disabled' });
  const validationCountAfterReload = validationCalls;
  await composer.fill('Router authorizes returning configured key');
  await composer.press('Enter');
  await expect(page.getByText('Verified key mock reply')).toBeVisible();
  expect(routerCalls).toBe(2);
  expect(validationCalls).toBe(validationCountAfterReload);
  await expect(routeStatus).toContainText('Key saved · not checked this session');
  await expect(page.getByRole('button', { name: 'Verify provider keys', exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${evidenceDir}/returning-key-reply-1024x600.png`, animations: 'disabled' });
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
  await page.setViewportSize({ width: 1440, height: 900 });
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
