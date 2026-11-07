// tests/e2e/pr4_productivity.spec.ts
// Real browser Playwright coverage for PR 4 Productivity & Workflow (F16-F20).

import { test, expect } from '@playwright/test';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

test.describe('PR 4 Productivity & Workflow (E2E)', () => {
  test('F16: opens import modal and displays import workflow controls', async ({ page, isMobile }) => {
    await setupAuthenticatedMock(page, { hasProviderKey: true });
    await signInAsMockUser(page);

    if (isMobile) {
      const toggleSidebarBtn = page.locator('button[aria-label="Toggle conversations sidebar"]');
      await toggleSidebarBtn.waitFor({ state: 'visible', timeout: 5000 });
      await toggleSidebarBtn.click();
    }

    // Wait for sidebar and chat to render
    const sidebar = page.locator('.conversation-sidebar');
    await expect(sidebar).toBeVisible();

    // Click Import button in sidebar
    const importBtn = sidebar.getByRole('button', { name: /^import$/i });
    await expect(importBtn).toBeVisible();
    await importBtn.click();

    // Modal opens
    const modal = page.locator('.import-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: /import conversations/i })).toBeVisible();

    // Verify format hints: Prismatix, OpenAI, Claude
    await expect(modal).toContainText(/Prismatix JSON, OpenAI \/ ChatGPT exports, or Claude/i);

    // Close modal
    const closeBtn = modal.getByRole('button', { name: /cancel/i });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    await expect(modal).not.toBeVisible();
  });

  test('F18: conversation status filters (Active, Archived, All) toggle visibility correctly', async ({ page, isMobile }) => {
    await setupAuthenticatedMock(page, {
      hasProviderKey: true,
      conversations: [
        {
          id: 'c-active-1',
          title: 'Active Project Discussion',
          last_activity_at: new Date().toISOString(),
          project_id: null,
        },
      ],
    });
    await signInAsMockUser(page);

    if (isMobile) {
      const toggleSidebarBtn = page.locator('button[aria-label="Toggle conversations sidebar"]');
      await toggleSidebarBtn.waitFor({ state: 'visible', timeout: 5000 });
      await toggleSidebarBtn.click();
    }

    const sidebar = page.locator('.conversation-sidebar');
    await expect(sidebar).toBeVisible();

    // Status filter buttons
    const activeBtn = sidebar.getByRole('button', { name: /^active$/i });
    const archivedBtn = sidebar.getByRole('button', { name: /^archived$/i });
    const allBtn = sidebar.getByRole('button', { name: /^all$/i });

    await expect(activeBtn).toBeVisible();
    await expect(archivedBtn).toBeVisible();
    await expect(allBtn).toBeVisible();

    // By default, Active is selected and conversation is visible
    await expect(sidebar.getByText('Active Project Discussion')).toBeVisible();

    // Switch to Archived: active conversation should be filtered out
    await archivedBtn.click();
    await expect(sidebar.getByText('Active Project Discussion')).not.toBeVisible();

    // Switch to All: conversation is visible again
    await allBtn.click();
    await expect(sidebar.getByText('Active Project Discussion')).toBeVisible();
  });

  test('F19: opens prompt library, fills variable, and inserts into composer', async ({ page, isMobile }) => {
    await setupAuthenticatedMock(page, { hasProviderKey: true });
    await signInAsMockUser(page);

    if (isMobile) {
      const toggleSidebarBtn = page.locator('button[aria-label="Toggle conversations sidebar"]');
      await toggleSidebarBtn.waitFor({ state: 'visible', timeout: 5000 });
      await toggleSidebarBtn.click();
    }

    // Click Prompts button in sidebar
    const sidebar = page.locator('.conversation-sidebar');
    const promptsBtn = sidebar.getByRole('button', { name: /^prompts$/i });
    await expect(promptsBtn).toBeVisible();
    await promptsBtn.click();

    // Prompt Library modal opens
    const modal = page.locator('.prompt-library-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: /prompt library/i })).toBeVisible();

    // Click "Use Template" on the "Code Reviewer" mock template
    const useBtn = modal.getByRole('button', { name: /use template/i }).first();
    await expect(useBtn).toBeVisible();
    await useBtn.click();

    // Variable fill form should appear with a field for {{code}}
    const varInput = modal.locator('textarea, input[type="text"]').last();
    await expect(varInput).toBeVisible();
    await varInput.fill('function calculateSum(a, b) { return a + b; }');

    // Click "Insert into Composer" button
    const insertBtn = modal.getByRole('button', { name: /insert into (composer|chat)/i });
    await expect(insertBtn).toBeVisible();
    await insertBtn.click();

    // Modal closes and composer textarea receives substituted prompt
    await expect(modal).not.toBeVisible();
    const chatInput = page.locator('.chat-input');
    await expect(chatInput).toBeVisible();
    await expect(chatInput).toHaveValue(/Review the following code for security and performance/);
    await expect(chatInput).toHaveValue(/function calculateSum\(a, b\)/);
  });

  test('F17: message action toolbar displays branch button on messages', async ({ page, isMobile }) => {
    const testConvId = 'c-test-branch-1';
    await setupAuthenticatedMock(page, {
      hasProviderKey: true,
      conversations: [
        {
          id: testConvId,
          title: 'Branching Test Chat',
          last_activity_at: new Date().toISOString(),
          project_id: null,
        },
      ],
      messages: [
        {
          id: 'm-branch-msg-1',
          conversation_id: testConvId,
          role: 'assistant',
          content: 'Here is an assistant response that can be branched into a new chat.',
          created_at: new Date().toISOString(),
        },
      ],
    });
    await signInAsMockUser(page);

    if (isMobile) {
      const toggleSidebarBtn = page.locator('button[aria-label="Toggle conversations sidebar"]');
      await toggleSidebarBtn.waitFor({ state: 'visible', timeout: 5000 });
      await toggleSidebarBtn.click();
    }

    // Open conversation
    const sidebar = page.locator('.conversation-sidebar');
    const chatItem = sidebar.getByText('Branching Test Chat');
    await expect(chatItem).toBeVisible();
    await chatItem.click();

    // Message is displayed
    const msg = page.locator('.message.message-assistant').first();
    await expect(msg).toBeVisible();

    // Branch button exists in toolbar
    const branchBtn = msg.getByRole('button', { name: /branch/i });
    await expect(branchBtn).toBeVisible();
  });
});
