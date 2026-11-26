import { expect, test } from '@playwright/test';
import { selectMockCompareRoutes, setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

test('Compare, Markdown and code remain readable in both Arctic themes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [] });
  await page.route('**/functions/v1/router', async (route) => {
    const { modelOverride } = route.request().postDataJSON();
    const answer = [
      '## Fixture comparison',
      'Use `audit_id` to look up the event.',
      '| Field | Purpose |',
      '| --- | --- |',
      '| Audit ID | Lookup |',
      '```typescript',
      'const audit_id = "fixture";',
      '```',
    ].join('\n');
    const events = [
      { type: 'content_block_delta', delta: { text: answer } },
      { type: 'receipt', executionId: modelOverride, status: 'completed', transcript: { saved: true }, settlement: { state: 'settled', committedUsd: 0.0012, pendingCalls: 0 }, calls: [{ stage: 'baseline', participant: 'openrouter', attemptNumber: 1, servedModel: modelOverride, costStatus: 'settled', totalCost: 0.0012 }] },
    ];
    await route.fulfill({
      headers: { 'Content-Type': 'text/event-stream', 'X-Router-Model': modelOverride },
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
    });
  });
  await signInAsMockUser(page);
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await selectMockCompareRoutes(page);
  const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
  await composer.fill('Render both formatted results.');
  await composer.press('Enter');
  await expect(page.getByRole('heading', { name: 'Fixture comparison' })).toHaveCount(2);
  const table = page.getByRole('region', { name: 'Scrollable table' }).first();
  await table.focus();
  await expect(table).toBeFocused();

  for (const theme of ['light', 'dark']) {
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const contrast = await page.locator('.comparison-column').first().evaluate((column) => {
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        const [r, g, b] = channels.map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      return ['.formatted-h2', '.inline-code', '.code-block-content', '.code-block-lang', '.comparison-cost'].map((selector) => {
        const text = column.querySelector(selector)!;
        let surface = text;
        while (getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') surface = surface.parentElement!;
        const foreground = luminance(getComputedStyle(text).color);
        const background = luminance(getComputedStyle(surface).backgroundColor);
        return { selector, ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) };
      });
    });
    for (const { selector, ratio } of contrast) expect(ratio, `${theme} ${selector}`).toBeGreaterThanOrEqual(4.5);
    const target = await page.locator('.comparison-column').first().getByRole('button', { name: 'Copy response' }).boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
    if (theme === 'light') {
      const account = page.getByRole('button', { name: 'Account menu' });
      await account.click();
      await page.getByRole('button', { name: 'Dark theme' }).click();
      await account.click();
    }
  }
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => undefined }));
  await page.locator('.comparison-column').first().getByRole('button', { name: 'Copy code to clipboard' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Clipboard access failed' })).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('const audit_id');
});
