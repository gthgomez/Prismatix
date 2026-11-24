import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

const response = (id: string, reply = 'Synthetic compact-chat reply.') => ({
  status: 200,
  headers: { 'Content-Type': 'text/event-stream', 'Access-Control-Expose-Headers': 'X-Router-Model, X-Provider, X-Prismatix-Execution-Id', 'X-Router-Model': 'gemini-3.8-flash', 'X-Provider': 'mock', 'X-Prismatix-Execution-Id': id },
  body: [
    { type: 'meta', model: 'gemini-3.8-flash', cost: { finalUsd: 0.0001 } },
    { type: 'content_block_delta', delta: { text: reply } },
    {
      type: 'receipt',
      executionId: id,
      status: 'completed',
      settlement: { state: 'settled', committedUsd: 0.0001, pendingCalls: 0 },
      calls: [{
        stage: 'baseline',
        participant: 'openrouter',
        attemptNumber: 1,
        servedModel: 'gemini-3.8-flash',
        costStatus: 'settled',
        totalCost: 0.0001,
        // A settled receipt with a complete ledger breakdown: the estimator
        // must render these authoritative components, not a client estimate.
        usage: { promptTokens: 80, completionTokens: 20, reasoningTokens: 0 },
        costs: { inputUsd: 0.00003, outputUsd: 0.00007, thinkingUsd: 0 },
      }],
    },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
});

const cases = [
  { width: 1024, height: 600, maxHeader: 96 },
  { width: 390, height: 844, maxHeader: 96 },
  { width: 320, height: 844, maxHeader: 104 },
];

for (const viewport of cases) {
  test(`compact header and recoverable cost Details at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium', 'The responsive matrix is captured at CSS DPR 1 in desktop Chromium.');
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [], costLogs: [] });
    await page.route('**/functions/v1/router*', (route) => route.fulfill(response(`compact-${viewport.width}`)));
    await signInAsMockUser(page);

    const dir = process.env.UI_BENCHMARK_EVIDENCE_DIR ?? info.outputPath();
    await mkdir(dir, { recursive: true });
    const header = page.locator('.chat-header');
    await page.screenshot({ path: `${dir}/after-empty-${viewport.width}x${viewport.height}.png`, animations: 'disabled' });
    await page.getByRole('textbox', { name: 'Message Prismatix' }).fill('synthetic compact cost details');
    await page.getByRole('textbox', { name: 'Message Prismatix' }).press('Enter');
    await expect(page.getByText('Synthetic compact-chat reply.')).toBeVisible();
    const panel = page.locator('.cost-estimator');
    await expect(panel).toBeVisible();
    const headerHeight = await header.evaluate((element) => element.getBoundingClientRect().height);
    console.log(`rendered ${viewport.width}x${viewport.height} header=${headerHeight}px`);
    const headerParts = await page.evaluate(() => {
      const left = document.querySelector('.chat-header .header-left')!.getBoundingClientRect();
      const actions = document.querySelector('.chat-header .header-actions')!.getBoundingClientRect();
      return { left: { x: left.x, right: left.right }, actions: { x: actions.x, right: actions.right } };
    });
    expect(headerParts.actions.x).toBeGreaterThanOrEqual(headerParts.left.right - 1);
    expect(headerHeight, 'compact header should not grow into several wrapped rows after sending').toBeLessThanOrEqual(viewport.maxHeader);

    const shortcut = page.getByRole('button', { name: 'View cost details' });
    await expect(shortcut).toBeVisible();
    const composer = page.locator('.chat-input-container');
    const shortcutBox = await shortcut.boundingBox();
    const composerBox = await composer.boundingBox();
    expect(shortcutBox && composerBox && shortcutBox.y + shortcutBox.height <= composerBox.y).toBe(true);
    await page.screenshot({ path: `${dir}/after-settled-${viewport.width}x${viewport.height}.png`, animations: 'disabled' });

    // The settled estimator remains in message flow; scrolling away must not pin it over Send.
    const messages = page.locator('.chat-messages');
    await messages.evaluate((element) => { element.scrollTop = 0; });
    await expect.poll(() => panel.evaluate((element) => element.getBoundingClientRect().bottom)).toBeGreaterThan(0);
    await expect(messages).toHaveJSProperty('scrollTop', 0);
    await expect(panel).toHaveCSS('position', 'relative');
    await expect(shortcut).toBeVisible();
    await page.screenshot({ path: `${dir}/after-scrolled-up-${viewport.width}x${viewport.height}.png`, animations: 'disabled' });

    // Pointer activation scrolls the in-flow panel into view without covering the composer.
    await shortcut.click();
    const details = page.getByRole('button', { name: 'Details', exact: true });
    await expect(details).toBeFocused();
    const detailsHit = await details.evaluate((element) => {
      const clip = element.closest('.chat-messages');
      const target = element.getBoundingClientRect();
      const viewport = clip?.getBoundingClientRect();
      const hit = document.elementFromPoint(target.left + target.width / 2, target.top + target.height / 2);
      return {
        fullyInsideTranscript: !!viewport && target.top >= viewport.top && target.bottom <= viewport.bottom,
        receivesPointer: hit === element || element.contains(hit),
        panelCanScroll: element.closest('.cost-estimator')!.scrollHeight > element.closest('.cost-estimator')!.clientHeight,
        rect: { top: target.top, bottom: target.bottom },
        clip: viewport && { top: viewport.top, bottom: viewport.bottom },
        hitClass: (hit as HTMLElement | null)?.className,
      };
    });
    console.log(`Details hit geometry ${viewport.width}x${viewport.height}: ${JSON.stringify(detailsHit)}`);
    expect(detailsHit.fullyInsideTranscript, `Details must be fully within transcript clip: ${JSON.stringify(detailsHit)}`).toBe(true);
    expect(detailsHit.receivesPointer, `Details center must hit its real button: ${JSON.stringify(detailsHit)}`).toBe(true);
    if (viewport.width === 1024) expect(detailsHit.panelCanScroll, 'all cost content must remain scrollable inside the short transcript').toBe(true);
    await page.screenshot({ path: `${dir}/after-details-revealed-${viewport.width}x${viewport.height}.png`, animations: 'disabled' });
    await panel.evaluate((element) => { element.scrollTop = 0; });
    for (const selector of ['.cost-estimator-title', '.cost-estimator-row', '.cost-estimator-total', '.cost-estimator-session']) {
      await expect(panel.locator(selector).first()).toBeInViewport();
    }
    await page.screenshot({ path: `${dir}/after-cost-summary-readable-${viewport.width}x${viewport.height}.png`, animations: 'disabled' });
    await shortcut.click();
    const detailsBox = await details.boundingBox();
    const composerAfterScrollBox = await composer.boundingBox();
    expect(detailsBox && composerAfterScrollBox && detailsBox.y + detailsBox.height <= composerAfterScrollBox.y).toBe(true);
    await details.click();
    await expect(page.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
    await page.screenshot({ path: `${dir}/after-details-open-${viewport.width}x${viewport.height}.png`, animations: 'disabled' });

    // Keyboard activation preserves focus and prevents the existing hide timer from dismissing active details.
    await shortcut.focus();
    await page.keyboard.press('Enter');
    const hideDetails = page.getByRole('button', { name: 'Hide details', exact: true });
    await expect(hideDetails).toBeFocused();
    await expect(hideDetails).toBeInViewport();
    await expect(hideDetails).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toContainText('$0.0001');
    await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send message' })).toBeInViewport();
    const sendButton = page.getByRole('button', { name: 'Send message' });
    const sendIsHitTarget = await sendButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === element || element.contains(hit);
    });
    expect(sendIsHitTarget, 'composer Send remains the actual pointer target').toBe(true);
    await page.waitForTimeout(3200);
    await expect(hideDetails).toBeFocused();
    await expect(panel).toBeVisible();
    const account = page.getByRole('button', { name: 'Account menu' });
    await account.focus();
    await expect(account).toBeFocused();
    await expect(account).toBeInViewport();
  });
}

test('wide chat retains the unmodified cost panel and has no compact shortcut', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'The wide baseline comparison is captured at CSS DPR 1 in desktop Chromium.');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [], costLogs: [] });
  await page.route('**/functions/v1/router*', (route) => route.fulfill(response('compact-wide')));
  await signInAsMockUser(page);
  const dir = process.env.UI_BENCHMARK_EVIDENCE_DIR ?? 'test-results/compact-wide';
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/after-empty-1440x900.png`, animations: 'disabled' });
  await page.getByRole('textbox', { name: 'Message Prismatix' }).fill('wide synthetic cost details');
  await page.getByRole('textbox', { name: 'Message Prismatix' }).press('Enter');
  await expect(page.getByText('Synthetic compact-chat reply.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'View cost details' })).toHaveCount(0);
  await expect(page.locator('.cost-estimator-details-toggle')).toBeVisible();
  await page.screenshot({ path: `${dir}/after-settled-1440x900.png`, animations: 'disabled' });
});

for (const viewport of [{ width: 1024, height: 768 }, { width: 1280, height: 600 }]) {
  test(`cost shortcut follows in-flow layout at crossed breakpoint ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium', 'Crossed breakpoints use desktop Chromium at CSS DPR 1.');
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [], costLogs: [] });
    let request = 0;
    await page.route('**/functions/v1/router*', (route) => {
      request += 1;
      return route.fulfill(response(`crossed-${viewport.width}-${request}`, `Synthetic long-history reply ${request}.`));
    });
    await signInAsMockUser(page);

    const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
    // Long synthetic transcript content creates scroll pressure without letting
    // the estimator's intentional three-second dismissal expire between turns.
    await composer.fill(Array.from({ length: 100 }, (_, line) => `Synthetic transcript context line ${line + 1}.`).join('\n'));
    await composer.press('Enter');
    await expect(page.getByText('Synthetic long-history reply 1.')).toBeVisible();
    const panel = page.locator('.cost-estimator');
    await expect(panel).toBeVisible();
    const position = await panel.evaluate((element) => getComputedStyle(element).position);
    const shortcut = page.getByRole('button', { name: 'View cost details' });
    const dir = process.env.UI_BENCHMARK_EVIDENCE_DIR ?? info.outputPath();
    await mkdir(dir, { recursive: true });
    expect(position).toBe('relative');
    await expect(shortcut).toBeVisible();
    await shortcut.click();
    const details = panel.locator('.cost-estimator-details-toggle');
    const hit = await details.evaluate((element) => {
      const viewportRect = element.closest('.chat-messages')!.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const top = rect.top + rect.height / 2;
      const left = rect.left + rect.width / 2;
      const target = document.elementFromPoint(left, top);
      return rect.top >= viewportRect.top && rect.bottom <= viewportRect.bottom && (target === element || element.contains(target));
    });
    expect(hit, 'the in-flow Details button is visible and receives its center-point pointer hit').toBe(true);
    const detailsBox = await details.boundingBox();
    const composerBox = await page.locator('.chat-input-container').boundingBox();
    expect(detailsBox && composerBox && detailsBox.y + detailsBox.height <= composerBox.y).toBe(true);
    await page.screenshot({ path: `${dir}/after-details-revealed-${viewport.width}x${viewport.height}.png`, animations: 'disabled' });
  });
}
