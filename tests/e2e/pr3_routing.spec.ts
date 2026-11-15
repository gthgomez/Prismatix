// tests/e2e/pr3_routing.spec.ts
// Real browser Playwright coverage for PR 3 Research and Routing Intelligence (F11-F15).

import { test, expect } from '@playwright/test';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

async function ensureDetailsOpen(details: import('@playwright/test').Locator) {
  if (!await details.evaluate((element) => element instanceof HTMLDetailsElement && element.open)) {
    await details.locator(':scope > summary').click();
  }
}

test.describe('PR 3 Research and Routing Intelligence (E2E)', () => {
  test('F11, F12, F13: routing disclosure exposes search, compare, profile, and spend cap controls', async ({ page }) => {
    await setupAuthenticatedMock(page, { hasProviderKey: true });
    await signInAsMockUser(page);

    const routingToggle = page.getByRole('button', { name: 'Routing details' });
    if (await routingToggle.isVisible()) await routingToggle.click();
    const routingPanel = page.locator('.arctic-routing-panel');
    await expect(routingPanel).toBeVisible();

    const modelOptions = routingPanel.locator('.arctic-routing-card > details').filter({ hasText: 'Model options' });
    await ensureDetailsOpen(modelOptions);
    const routingTools = modelOptions.locator('details.arctic-route-nested');
    await ensureDetailsOpen(routingTools);
    const searchToggle = routingPanel.getByLabel('Search web (BYOK)');
    await expect(searchToggle).toBeVisible();
    await expect(searchToggle).not.toBeChecked();
    await searchToggle.check();
    await expect(searchToggle).toBeChecked();

    const closeRouting = routingPanel.getByRole('button', { name: 'Close routing details' });
    if (await closeRouting.isVisible()) await closeRouting.click();
    const compareBtn = page.getByRole('group', { name: 'Chat workflow' }).getByRole('button', { name: 'Compare' });
    await expect(compareBtn).toBeVisible();
    await compareBtn.click();
    await expect(compareBtn).toHaveAttribute('aria-pressed', 'true');

    if (await routingToggle.isVisible()) await routingToggle.click();
    await ensureDetailsOpen(modelOptions);
    const modelASelect = routingPanel.getByLabel('Model A');
    await expect(modelASelect).toBeVisible();
    const modelBSelect = routingPanel.getByLabel('Model B');
    await expect(modelBSelect).toBeVisible();

    // Check profile select
    const profileSelect = routingPanel.locator('#arctic-routing-profile');
    await expect(profileSelect).toBeVisible();
    const profileOptions = await profileSelect.locator('option').allTextContents();
    expect(profileOptions).toContain('Balanced');
    expect(profileOptions).toContain('Economy');
    expect(profileOptions).toContain('Capability');

    await profileSelect.selectOption('economy');
    expect(await profileSelect.inputValue()).toBe('economy');

    // Check spend cap select
    const capSelect = routingPanel.locator('#arctic-spend-cap');
    await expect(capSelect).toBeVisible();
    const capOptions = await capSelect.locator('option').allTextContents();
    expect(capOptions).toContain('No cap');
    expect(capOptions).toContain('$0.01');
    expect(capOptions).toContain('$0.05');

    await capSelect.selectOption('0.01');
    expect(await capSelect.inputValue()).toBe('0.01');
  });

  test('F13: request exceeding spend cap displays actionable spend cap rejection notice', async ({ page }) => {
    await setupAuthenticatedMock(page, { hasProviderKey: true });

    // Mock router returning request cost limit exceeded (429)
    await page.route('**/functions/v1/router*', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Request cost limit exceeded',
          code: 'request_cost_limit_exceeded',
          dailyLimitUsd: 1.0,
          projectedTotalUsd: 0.05,
        }),
      });
    });

    await signInAsMockUser(page);

    // Select low spend cap
    const routingToggle = page.getByRole('button', { name: 'Routing details' });
    if (await routingToggle.isVisible()) await routingToggle.click();
    const routingPanel = page.locator('.arctic-routing-panel');
    await expect(routingPanel).toBeVisible();
    const modelOptions = routingPanel.locator('.arctic-routing-card > details').filter({ hasText: 'Model options' });
    await ensureDetailsOpen(modelOptions);
    await ensureDetailsOpen(modelOptions.locator('details.arctic-route-nested'));
    const capSelect = routingPanel.locator('#arctic-spend-cap');
    await expect(capSelect).toBeVisible();
    await capSelect.selectOption('0.01');
    const closeRouting = routingPanel.getByRole('button', { name: 'Close routing details' });
    if (await closeRouting.isVisible()) await closeRouting.click();

    // Send a message using chat input composer
    const textarea = page.locator('.chat-input');
    await expect(textarea).toBeVisible();
    await textarea.fill('Generate a 5000 word exhaustive breakdown of distributed algorithms.');

    const sendBtn = page.locator('.send-button');
    await expect(sendBtn).toBeVisible();
    await sendBtn.click();

    // Verify actionable spend cap notice is shown
    await expect(page.getByText(/Request cost exceeds your configured spend cap/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('F14: authoritative spend tracker displays popover, Breakdown tab, and CSV Export', async ({ page, isMobile }) => {
    await setupAuthenticatedMock(page, { hasProviderKey: true });
    await signInAsMockUser(page);

    const spendPill = page.locator('.spend-pill');
    await expect(spendPill).toBeVisible();
    await spendPill.click();

    const popover = page.locator('.spend-popover');
    await expect(popover).toBeVisible();

    // Check CSV Export button
    const csvBtn = page.locator('.spend-csv-btn');
    await expect(csvBtn).toBeVisible();
    await expect(csvBtn).toContainText(/Export Spend CSV/i);

    // Check Breakdown tab
    const breakdownTab = page.getByRole('button', { name: /breakdown/i });
    await expect(breakdownTab).toBeVisible();
    await breakdownTab.click();

    await expect(page.getByLabel(/Filter date range/i)).toBeVisible();
    await expect(page.getByLabel(/Group spend by/i)).toBeVisible();

    if (isMobile) {
      const viewport = page.viewportSize();
      expect(viewport?.width).toBeLessThan(500);
    }
  });

  test('F15: routing feedback thumbs-up toggles on and off on assistant messages', async ({ page, isMobile }) => {
    await setupAuthenticatedMock(page, {
      hasProviderKey: true,
      messages: [
        {
          id: 'm1111111-1111-4111-8111-111111111111',
          conversation_id: 'c1111111-1111-4111-8111-111111111111',
          role: 'user',
          content: 'What is consistency in Raft?',
          created_at: new Date(Date.now() - 3600000).toISOString(),
        },
        {
          id: 'm2222222-2222-4222-8222-222222222222',
          conversation_id: 'c1111111-1111-4111-8111-111111111111',
          role: 'assistant',
          content: 'In Raft, linearizable state machine replication ensures consistency.',
          created_at: new Date(Date.now() - 3590000).toISOString(),
        },
      ],
    });

    // Mock feedback endpoints
    await page.route('**/rest/v1/routing_quality_feedback*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await signInAsMockUser(page);

    if (isMobile) {
      const toggleSidebarBtn = page.locator('button[aria-label="Toggle conversations sidebar"]');
      await toggleSidebarBtn.waitFor({ state: 'visible', timeout: 5000 });
      await toggleSidebarBtn.click();
    }

    // Open first conversation
    const convItem = page.locator('.conversation-item').first();
    await expect(convItem).toBeVisible();
    await convItem.click();

    // Find thumbs up button within feedback-btn-group
    const thumbsUpBtn = page.locator('.feedback-btn-group button').first();
    await expect(thumbsUpBtn).toBeVisible({ timeout: 5000 });
    await expect(thumbsUpBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(thumbsUpBtn).toHaveAttribute('aria-label', 'Good response');

    // Click thumbs up to activate feedback
    await thumbsUpBtn.click();
    await expect(thumbsUpBtn).toHaveClass(/is-active/);
    await expect(thumbsUpBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(thumbsUpBtn).toHaveAttribute('aria-label', 'Remove positive feedback');

    // Click again to toggle feedback off (delete)
    await thumbsUpBtn.click();
    await expect(thumbsUpBtn).not.toHaveClass(/is-active/);
    await expect(thumbsUpBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(thumbsUpBtn).toHaveAttribute('aria-label', 'Good response');
  });
});
