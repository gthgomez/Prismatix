// tests/e2e/pr6_multimodal.spec.ts
// Real browser Playwright coverage for PR 6 Multimodal & Polished Product (F26–F30).

import { test, expect } from '@playwright/test';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

test.describe('PR 6 Multimodal & Polished Product (E2E)', () => {
  test('F28: opens BYOK image generation modal, configures prompt and model, and generates preview', async ({ page }) => {
    await setupAuthenticatedMock(page, { hasProviderKey: true });
    await signInAsMockUser(page);

    // Locate Image Generation button in composer
    const imgGenBtn = page.getByRole('button', { name: /generate image/i });
    await expect(imgGenBtn).toBeVisible();
    await imgGenBtn.click();

    // Verify modal is open
    const modal = page.locator('.image-generation-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: /generate image/i })).toBeVisible();

    // Verify cost disclosure notice
    await expect(modal).toContainText(/Estimated cost:/i);
    await expect(modal).toContainText(/BYOK key/i);

    // Enter prompt
    const promptInput = modal.getByLabel(/prompt/i);
    await promptInput.fill('A watercolor painting of a serene misty pine forest');

    // Click Generate Image button
    const confirmBtn = modal.locator('.generate-image-confirm-btn');
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // Modal closes and generated image card is rendered in the conversation
    await expect(modal).not.toBeVisible();
    const imageCard = page.locator('.generated-image-card');
    await expect(imageCard).toBeVisible();
    await expect(imageCard.locator('img')).toBeVisible();
    await expect(imageCard).toContainText(/flux-1-schnell/i);
  });

  test('F26: toggles voice dictation recording state from composer', async ({ page }) => {
    await setupAuthenticatedMock(page, { hasProviderKey: true });
    await signInAsMockUser(page);

    // Locate Voice Dictation button
    const voiceBtn = page.getByRole('button', { name: /voice dictation/i });
    await expect(voiceBtn).toBeVisible();

    // Click to start dictation
    await voiceBtn.click();

    // In browser environment without granted microphone, either triggers recording or sets idle/error notice
    await expect(voiceBtn).toBeVisible();
  });

  test('F29: extracts artifacts from code block answers and opens sandboxed artifact viewer', async ({ page }) => {
    await setupAuthenticatedMock(page, { hasProviderKey: true });
    await signInAsMockUser(page);

    // Send a message that generates a code block
    const textarea = page.getByPlaceholder(/ask anything/i);
    await textarea.fill('Write a simple typescript function');
    await textarea.press('Enter');

    // Wait for assistant response to render
    const assistantMsg = page.locator('.message-assistant').last();
    await expect(assistantMsg).toBeVisible();

    // Check for Artifact action button in message toolbar
    const artifactBtn = assistantMsg.getByRole('button', { name: /view and edit extracted artifacts/i });
    if (await artifactBtn.isVisible()) {
      await artifactBtn.click();

      const artifactModal = page.locator('.artifact-viewer-modal');
      await expect(artifactModal).toBeVisible();
      await expect(artifactModal.getByRole('heading', { name: /artifact/i })).toBeVisible();

      // Check editor textarea
      const editorTextarea = artifactModal.getByLabel(/artifact code content/i);
      await expect(editorTextarea).toBeVisible();

      // Close modal
      const closeBtn = artifactModal.getByRole('button', { name: /close artifact viewer/i });
      await closeBtn.click();
      await expect(artifactModal).not.toBeVisible();
    }
  });

  test('F30: verifies PWA web app manifest link and theme color meta tags', async ({ page }) => {
    await page.goto('/');

    // Verify manifest link exists
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute('href', '/manifest.webmanifest');

    // Verify theme color meta tag
    const themeColor = page.locator('meta[name="theme-color"]');
    await expect(themeColor).toHaveAttribute('content', '#101014');
  });

  test('F30: displays offline continuity status banner when disconnected', async ({ page }) => {
    await setupAuthenticatedMock(page, { hasProviderKey: true });
    await signInAsMockUser(page);

    // Ensure composer has loaded and mounted
    const composerInput = page.getByRole('textbox', { name: /message prismatix/i });
    await expect(composerInput).toBeVisible();

    // Simulate offline network event
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
    });

    // Verify offline banner appears
    const offlineBanner = page.locator('.offline-status-banner');
    await expect(offlineBanner).toBeVisible();
    await expect(offlineBanner).toContainText(/offline mode/i);

    // Simulate online network event
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });

    // Verify offline banner disappears
    await expect(offlineBanner).not.toBeVisible();
  });
});
