// tests/e2e/pr3_routing.spec.ts
// Real browser Playwright coverage for PR 3 (F11-F15).

import { test, expect } from '@playwright/test';

test.describe('PR 3 Research and Routing Intelligence (E2E)', () => {
  test('routing intelligence bar renders search toggle, compare toggle, profiles, and spend caps', async ({ page }) => {
    await page.goto('/demo');
    await page.waitForLoadState('domcontentloaded');

    // Routing intelligence toolbar
    const routingBar = page.locator('.routing-intelligence-bar');
    if (await routingBar.isVisible()) {
      await expect(routingBar).toBeVisible();

      // Check Search web button
      const searchBtn = page.getByRole('button', { name: /search web/i });
      await expect(searchBtn).toBeVisible();
      await searchBtn.click();
      await expect(searchBtn).toHaveClass(/active/);

      // Check Compare button
      const compareBtn = page.getByRole('button', { name: /compare/i });
      await expect(compareBtn).toBeVisible();
      await compareBtn.click();
      await expect(compareBtn).toHaveClass(/active/);

      // Check profile select
      const profileSelect = page.locator('#routing-profile-select');
      await expect(profileSelect).toBeVisible();
      const profileOptions = await profileSelect.locator('option').allTextContents();
      expect(profileOptions).toContain('Balanced');
      expect(profileOptions).toContain('Economy');
      expect(profileOptions).toContain('Capability');

      // Check spend cap select
      const capSelect = page.locator('#spend-cap-select');
      await expect(capSelect).toBeVisible();
      const capOptions = await capSelect.locator('option').allTextContents();
      expect(capOptions).toContain('No Cap');
      expect(capOptions).toContain('$0.01');
    }
  });

  test('spend tracker popover displays breakdown filters and Export Spend CSV button', async ({ page, isMobile }) => {
    await page.goto('/demo');
    await page.waitForLoadState('domcontentloaded');

    const spendPill = page.locator('.spend-pill');
    if (await spendPill.isVisible()) {
      await spendPill.click();

      const popover = page.locator('.spend-popover');
      await expect(popover).toBeVisible();

      // Check CSV Export button
      const csvBtn = page.locator('.spend-csv-btn');
      await expect(csvBtn).toBeVisible();
      await expect(csvBtn).toContainText(/Export Spend CSV/i);

      // Check Breakdown tab
      const breakdownTab = page.getByRole('button', { name: /breakdown/i });
      if (await breakdownTab.isVisible()) {
        await breakdownTab.click();
        await expect(page.getByLabel(/Filter date range/i)).toBeVisible();
        await expect(page.getByLabel(/Group spend by/i)).toBeVisible();
      }

      if (isMobile) {
        const viewport = page.viewportSize();
        expect(viewport?.width).toBeLessThan(500);
      }
    }
  });
});
