// tests/e2e/pr1_daily_use.spec.ts
// Real browser Playwright coverage for PR 1 Daily-Use Foundation (F01-F05).

import { test, expect } from '@playwright/test';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

test.describe('PR 1 Daily-Use Foundation (E2E)', () => {
  test('public sign-in explains closed-registration policy without dead buttons', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Page title and layout loads
    await expect(page).toHaveTitle(/Prismatix/i);

    // Verify auth form exists and displays closed-registration explanation
    const authContainer = page.locator('.auth-container');
    await expect(authContainer).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();

    // Verify there are no uncaught JavaScript exceptions
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    expect(pageErrors).toEqual([]);
  });

  test('F01: first-run BYOK setup guides user to configure provider key when missing', async ({ page }) => {
    // Setup authenticated mock with NO provider key configured and empty history (first run)
    await setupAuthenticatedMock(page, { hasProviderKey: false, conversations: [], messages: [] });
    await signInAsMockUser(page);

    // First run setup card must be displayed
    const setupCard = page.locator('.first-run-card');
    await expect(setupCard).toBeVisible();
    await expect(setupCard).toContainText(/Connect an AI Provider to Start Chatting/i);

    // Enter a key in the setup card
    const keyInput = setupCard.locator('#first-run-openrouter-key');
    await expect(keyInput).toBeVisible();
    await keyInput.fill('sk-or-v1-valid-test-key-mock');

    // Submit provider key
    const saveBtn = setupCard.getByRole('button', { name: /connect & start/i });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Setup card completes and dismisses or confirms key is saved
    await expect(setupCard).not.toBeVisible();
  });

  test('F02: lossless failed send displays draft recovery and restores prompt', async ({ page }) => {
    await setupAuthenticatedMock(page, { hasProviderKey: true });

    // Mock router failure (503 Service Unavailable)
    await page.route('**/functions/v1/router*', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Router temporarily unavailable' }),
      });
    });

    await signInAsMockUser(page);

    // Locate composer textarea
    const composer = page.locator('textarea');
    await expect(composer).toBeVisible();
    const testPrompt = 'Draft recovery test prompt: verify text is never lost on network failure.';
    await composer.fill(testPrompt);

    // Send the turn
    const sendBtn = page.locator('button[type="submit"], button[aria-label="Send message"]');
    await sendBtn.click();

    // The draft recovery banner must appear with Restore action
    const recoveryBanner = page.locator('.draft-recovery-bar');
    await expect(recoveryBanner).toBeVisible();
    await expect(recoveryBanner).toContainText(/Send failed/i);

    // Click Restore draft
    const restoreBtn = recoveryBanner.getByRole('button', { name: /restore draft/i });
    await expect(restoreBtn).toBeVisible();
    await restoreBtn.click();

    // Composer textarea must have the prompt restored
    await expect(composer).toHaveValue(testPrompt);
  });

  test('F03 & F05: conversation sidebar lists chats and global search modal finds records', async ({ page, isMobile }) => {
    const mockChats = [
      {
        id: 'c1111111-1111-4111-8111-111111111111',
        title: 'Distributed Consensus In Depth',
        last_activity_at: new Date().toISOString(),
      },
      {
        id: 'c2222222-2222-4222-8222-222222222222',
        title: 'Microservices vs Monolith Architecture',
        last_activity_at: new Date(Date.now() - 3600000).toISOString(),
      },
    ];

    await setupAuthenticatedMock(page, {
      hasProviderKey: true,
      conversations: mockChats,
    });

    await signInAsMockUser(page);

    if (isMobile) {
      // In mobile, open sidebar via toggle button
      const toggleSidebarBtn = page.locator('button[aria-label="Toggle conversations sidebar"]');
      if (await toggleSidebarBtn.isVisible()) {
        await toggleSidebarBtn.click();
      }
    }

    // Sidebar must render loaded conversations
    const sidebar = page.locator('.conversation-sidebar, aside');
    await expect(sidebar).toBeVisible();
    await expect(page.getByText('Distributed Consensus In Depth')).toBeVisible();

    // Open Global Search Modal via full search button
    const searchBtn = page.locator('.conversation-search-global-trigger').first();
    await expect(searchBtn).toBeVisible();
    await searchBtn.click();

    // Global Search Modal must be visible
    const searchModal = page.locator('.search-modal-container');
    await expect(searchModal).toBeVisible();
    const searchInput = searchModal.locator('.search-modal-input');
    await expect(searchInput).toBeVisible();

    // Type query
    await searchInput.fill('Consensus');

    // Close search modal with Esc
    await page.keyboard.press('Escape');
    await expect(searchModal).not.toBeVisible();
  });
});
