import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

const viewports = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'compact-1024x600', width: 1024, height: 600 },
  { name: 'pixel-5', width: 393, height: 851 },
];

for (const viewport of viewports) {
  test(`first-run empty fixture ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupAuthenticatedMock(page, { hasProviderKey: false, conversations: [], messages: [] });
    await signInAsMockUser(page);
    if (viewport.width > 600) await expect(page.locator('.conversation-sidebar')).toBeVisible();
    await expect(page.locator('.first-run-card')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect & Start' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Try the scripted public demo first →' })).toBeVisible();

    if (viewport.width <= 600) {
      await page.getByRole('button', { name: 'Toggle conversations sidebar' }).click();
      await expect(page.locator('.conversation-sidebar')).toBeVisible();
      await page.getByRole('button', { name: 'Close sidebar' }).click();
    }

    if (viewport.width === 1024) {
      const connectBox = await page.getByRole('button', { name: 'Connect & Start' }).boundingBox();
      const toolbarBox = await page.getByRole('toolbar', { name: 'Composer tools' }).boundingBox();
      expect(connectBox).not.toBeNull();
      expect(toolbarBox).not.toBeNull();
      expect(connectBox!.y + connectBox!.height).toBeLessThan(toolbarBox!.y);
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, 'first-run layout should not overflow horizontally').toBe(false);
    const outputDir = process.env.UI_BENCHMARK_EVIDENCE_DIR ?? testInfo.outputPath();
    await mkdir(outputDir, { recursive: true });
    await page.screenshot({ path: `${outputDir}/${viewport.name}.png`, fullPage: true });
    const tracePath = `${outputDir}/${viewport.name}.zip`;
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
    if (viewport.width > 600) {
      await page.locator('#first-run-openrouter-key').fill('sk-or-synthetic-test');
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Connect & Start' })).toBeFocused();
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    const enlargedTextOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(enlargedTextOverflow, 'enlarged text should not create horizontal page overflow').toBe(false);
    await page.context().tracing.stop({ path: tracePath });
    await testInfo.attach(`${viewport.name}-trace`, { path: tracePath, contentType: 'application/zip' });
  });
}
