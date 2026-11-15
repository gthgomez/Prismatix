// tests/e2e/first_run_capture.spec.ts
// Deterministic evidence captures for the first-run journey. Run only with
// FIRST_RUN_CAPTURE_DIR set so normal test runs stay fast.

import { test, expect } from '@playwright/test';
import { setupControlledJourney } from './fixtures/providerFixture';
import { signInAsMockUser } from './fixtures/mockAuth';

const captureDir = process.env.FIRST_RUN_CAPTURE_DIR;
const label = process.env.FIRST_RUN_CAPTURE_LABEL ?? 'capture';

async function prepare(page: import('@playwright/test').Page) {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await setupControlledJourney(page, {
    validation: 'unavailable',
    listResponses: ['ok'],
    conversations: [],
  });
  await signInAsMockUser(page);
  await expect(page.locator('.chat-container')).toBeVisible();
  await expect(page.locator('.first-run-card')).toBeVisible();
  await page.waitForTimeout(300);
}

test.describe('first-run evidence captures', () => {
  test.skip(!captureDir, 'set FIRST_RUN_CAPTURE_DIR to capture');

  test('desktop 1440x900 with chats open', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'desktop capture');
    await page.setViewportSize({ width: 1440, height: 900 });
    await prepare(page);
    await expect(page.locator('.conversation-sidebar')).toBeVisible();
    await page.screenshot({ path: `${captureDir}/${label}-1440x900.png`, animations: 'disabled' });
    await page.locator('.first-run-card').screenshot({ path: `${captureDir}/${label}-1440x900-card.png`, animations: 'disabled' });
  });

  test('desktop 1024x600 with chats open', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'desktop capture');
    await page.setViewportSize({ width: 1024, height: 600 });
    await prepare(page);
    await expect(page.locator('.conversation-sidebar')).toBeVisible();
    await page.screenshot({ path: `${captureDir}/${label}-1024x600.png`, animations: 'disabled' });
    await page.locator('.first-run-card').screenshot({ path: `${captureDir}/${label}-1024x600-card.png`, animations: 'disabled' });
  });

  test('Pixel 5 with chats open', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Pixel 5 capture');
    await prepare(page);
    if (!(await page.locator('.conversation-sidebar').isVisible())) {
      await page.getByRole('button', { name: 'Toggle conversations sidebar' }).click();
    }
    await expect(page.locator('.conversation-sidebar')).toBeVisible();
    await page.screenshot({ path: `${captureDir}/${label}-pixel5.png`, animations: 'disabled' });
  });

  test('Pixel 5 with enlarged text', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Pixel 5 capture');
    await prepare(page);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.locator('.first-run-card').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${captureDir}/${label}-pixel5-text200.png`, animations: 'disabled' });
  });
});
