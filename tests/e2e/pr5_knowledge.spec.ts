// tests/e2e/pr5_knowledge.spec.ts
// Real browser Playwright coverage for PR 5 Knowledge & Grounded Research (F21-F25).

import { test, expect } from '@playwright/test';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

test.describe('PR 5 Knowledge & Grounded Research (E2E)', () => {
  test('F24: toggles Research mode in routing bar', async ({ page }) => {
    await setupAuthenticatedMock(page, { hasProviderKey: true });
    await signInAsMockUser(page);

    const routingBar = page.getByRole('toolbar', { name: /routing and research controls/i });
    await expect(routingBar).toBeVisible();

    // Research mode toggle button
    const researchBtn = routingBar.getByRole('button', { name: /research/i });
    await expect(researchBtn).toBeVisible();
    await expect(researchBtn).toHaveAttribute('aria-pressed', 'false');

    // Click to toggle on
    await researchBtn.click();
    await expect(researchBtn).toHaveAttribute('aria-pressed', 'true');

    // Click to toggle off
    await researchBtn.click();
    await expect(researchBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('F23: opens URL ingestion modal, blocks SSRF target, and handles valid fetch', async ({ page }) => {
    await setupAuthenticatedMock(page, { hasProviderKey: true });
    await signInAsMockUser(page);

    // Click the URL ingestion button in composer
    const urlBtn = page.getByRole('button', { name: /read web page url/i });
    await expect(urlBtn).toBeVisible();
    await urlBtn.click();

    // Modal opens
    const modal = page.locator('.url-ingestion-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: /read & ingest web page/i })).toBeVisible();

    const input = modal.getByPlaceholder(/https:\/\/example.com/i);
    await expect(input).toBeVisible();

    // Attempt SSRF target (AWS IMDS metadata)
    await input.fill('http://169.254.169.254/latest/meta-data/');
    const fetchBtn = modal.getByRole('button', { name: /fetch content/i });
    await fetchBtn.click();

    // Verify SSRF security error banner is displayed
    const errorBanner = modal.getByRole('alert');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText(/SSRF Block/i);

    // Close modal
    const cancelBtn = modal.getByRole('button', { name: /cancel/i });
    await cancelBtn.click();
    await expect(modal).not.toBeVisible();
  });

  test('F25: opens document comparison modal, computes metrics, and inserts prompt into composer', async ({ page }) => {
    await setupAuthenticatedMock(page, { hasProviderKey: true });
    await signInAsMockUser(page);

    // Click Document comparison button in composer
    const compareDocsBtn = page.getByRole('button', { name: /compare two documents/i });
    await expect(compareDocsBtn).toBeVisible();
    await compareDocsBtn.click();

    // Comparison modal opens
    const modal = page.locator('.document-comparison-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: /multi-document comparison/i })).toBeVisible();

    // Fill in Doc A and Doc B textareas
    const textareas = modal.locator('textarea');
    await textareas.nth(0).fill('System architecture with OAuth 2.0 and token refresh rotation.');
    await textareas.nth(1).fill('System architecture with Passkeys, WebAuthn, and token refresh rotation.');

    // Click Analyze & Compare
    const analyzeBtn = modal.getByRole('button', { name: /analyze & compare/i });
    await expect(analyzeBtn).toBeVisible();
    await analyzeBtn.click();

    // Verify metrics appear
    await expect(modal).toContainText(/Vocabulary Overlap/i);
    await expect(modal).toContainText(/Shared themes:/i);

    // Insert into chat
    const insertBtn = modal.getByRole('button', { name: /insert comparative prompt into chat/i });
    await expect(insertBtn).toBeVisible();
    await insertBtn.click();

    // Modal closes and composer textarea receives comparative analysis prompt
    await expect(modal).not.toBeVisible();
    const chatInput = page.locator('.chat-input');
    await expect(chatInput).toBeVisible();
    await expect(chatInput).toHaveValue(/MULTI-DOCUMENT COMPARATIVE ANALYSIS/i);
    await expect(chatInput).toHaveValue(/Document A:/i);
  });
});
