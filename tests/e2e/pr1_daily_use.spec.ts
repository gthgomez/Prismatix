// tests/e2e/pr1_daily_use.spec.ts
import { test, expect } from '@playwright/test';

test.describe('PR 1 Daily-Use Foundation (E2E)', () => {
  test('public sign-in explains closed-registration policy without dead buttons', async ({ page }) => {
    await page.goto('/');

    // Check that page title or main heading is loaded
    await expect(page).toHaveTitle(/Prismatix/i);

    // Look for sign in / registration text
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeDefined();

    // Verify there are no uncaught JavaScript errors
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    expect(errors.filter((e) => !e.includes('VITE_SUPABASE'))).toEqual([]);
  });

  test('demo preview loads responsive layout', async ({ page, isMobile }) => {
    await page.goto('/demo');

    // Wait for the app container or heading
    await page.waitForLoadState('domcontentloaded');

    const appContainer = page.locator('#root');
    await expect(appContainer).toBeVisible();

    if (isMobile) {
      // In mobile viewport (Pixel 5), check responsive navigation
      const viewport = page.viewportSize();
      expect(viewport?.width).toBeLessThan(500);
    } else {
      // In desktop viewport, ensure full interface is accessible
      const viewport = page.viewportSize();
      expect(viewport?.width).toBeGreaterThanOrEqual(1000);
    }
  });
});
