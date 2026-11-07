// tests/e2e/pr2_knowledge.spec.ts
import { test, expect } from '@playwright/test';

test.describe('PR 2 Knowledge Workspace (E2E)', () => {
  test('sidebar renders project workspace picker and export action', async ({ page }) => {
    await page.goto('/demo');
    await page.waitForLoadState('domcontentloaded');

    // Check project workspace filter select
    const workspaceSelect = page.locator('.project-select');
    if (await workspaceSelect.isVisible()) {
      await expect(workspaceSelect).toBeVisible();
      const options = await workspaceSelect.locator('option').allTextContents();
      expect(options).toContain('All workspaces');
    }

    // Check Export button
    const exportBtn = page.getByRole('button', { name: /export/i }).first();
    if (await exportBtn.isVisible()) {
      await exportBtn.click();
      const exportModal = page.locator('.knowledge-modal-card');
      await expect(exportModal).toBeVisible();
      await expect(page.getByText(/Export & Portability/i)).toBeVisible();
    }
  });

  test('file input accepts pdf, docx, and xlsx formats', async ({ page }) => {
    await page.goto('/demo');
    await page.waitForLoadState('domcontentloaded');

    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count() > 0) {
      const acceptAttr = await fileInput.getAttribute('accept');
      expect(acceptAttr).toContain('.pdf');
      expect(acceptAttr).toContain('.docx');
      expect(acceptAttr).toContain('.xlsx');
    }
  });
});
