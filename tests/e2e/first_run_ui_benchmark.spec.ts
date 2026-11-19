import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

const viewports = [
  { name: 'wide', width: 1920, height: 1080 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'compact-1024x600', width: 1024, height: 600 },
  { name: 'standard-laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'small-phone', width: 320, height: 568 },
  { name: 'phone-360x740', width: 360, height: 740 },
  { name: 'phone-390x667', width: 390, height: 667 },
  { name: 'phone-390x844', width: 390, height: 844 },
  { name: 'landscape-568x320', width: 568, height: 320 },
  { name: 'landscape', width: 667, height: 375 },
  { name: 'pixel-5', width: 393, height: 851 },
];

for (const viewport of viewports) {
  test(`first-run empty fixture ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupAuthenticatedMock(page, { hasProviderKey: false, conversations: [], messages: [] });
    await signInAsMockUser(page);
    if (viewport.width > 768) await expect(page.locator('.conversation-sidebar')).toBeVisible();
    await expect(page.locator('.first-run-card')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect provider' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Try the public demo' })).toBeVisible();

    if (viewport.width <= 768) {
      await page.getByRole('button', { name: 'Toggle conversations sidebar' }).click();
      await expect(page.locator('.conversation-sidebar')).toBeVisible();
      await page.getByRole('button', { name: 'Close sidebar' }).click();
    }

    await expect(page.getByRole('toolbar', { name: 'Routing and research controls' })).toBeHidden();

    const card = page.locator('.first-run-card');
    await expect(card).toHaveCSS('overflow-y', 'visible');
    const demoLink = card.getByRole('link', { name: 'Try the public demo' });
    await demoLink.scrollIntoViewIfNeeded();
    await expect(demoLink).toBeInViewport();
    await card.getByRole('heading').scrollIntoViewIfNeeded();
    const headingSize = await card.getByRole('heading').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(headingSize).toBeGreaterThanOrEqual(24);
    expect(headingSize).toBeLessThanOrEqual(30);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, 'first-run layout should not overflow horizontally').toBe(false);
    const outputDir = process.env.UI_BENCHMARK_EVIDENCE_DIR ?? testInfo.outputPath();
    await mkdir(outputDir, { recursive: true });
    await page.screenshot({ path: `${outputDir}/${viewport.name}.png`, fullPage: true });
    const tracePath = `${outputDir}/${viewport.name}.zip`;
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
    if (viewport.width > 768) {
      await page.locator('#first-run-openrouter-key').fill('sk-or-synthetic-test');
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Connect provider' })).toBeFocused();
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
    const enlargedTextOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(enlargedTextOverflow, 'enlarged text should not create horizontal page overflow').toBe(false);
    await page.context().tracing.stop({ path: tracePath });
    await testInfo.attach(`${viewport.name}-trace`, { path: tracePath, contentType: 'application/zip' });
  });
}
