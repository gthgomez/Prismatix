// Scripted authenticated chat journey against mock/local test provider.
// Covers: resume conversation, attach document, grounded sources, provider
// unavailability recovery, and reload without losing authorized session.

import { test, expect } from '@playwright/test';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

const GROUNDED_CONVERSATION = {
  id: 'c1111111-1111-4111-8111-111111111111',
  title: 'Grounded Doc Q&A',
  last_activity_at: new Date().toISOString(),
  project_id: 'proj-synth-1',
};

const GROUNDED_MESSAGES = [
  {
    id: 'm1111111-1111-4111-8111-111111111111',
    conversation_id: GROUNDED_CONVERSATION.id,
    role: 'user' as const,
    content: 'What SLA does the runbook require for the router?',
    created_at: new Date(Date.now() - 60_000).toISOString(),
  },
  {
    id: 'm2222222-2222-4222-8222-222222222222',
    conversation_id: GROUNDED_CONVERSATION.id,
    role: 'assistant' as const,
    content: 'The runbook requires a 99.9% monthly SLA for the router edge function [1].',
    created_at: new Date(Date.now() - 50_000).toISOString(),
    metadata: {
      citations: [
        {
          id: 1,
          title: 'Prismatix Router Runbook',
          url: 'https://docs.prismatix.test/runbook',
          domain: 'docs.prismatix.test',
          snippet: 'Router availability target: 99.9% monthly SLA.',
        },
      ],
    },
  },
];

test.describe('Authenticated chat journey (mock provider)', () => {
  test('resume chat, attach document, inspect sources, recover provider outage, reload session', async ({
    page,
    isMobile,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await setupAuthenticatedMock(page, {
      hasProviderKey: true,
      conversations: [GROUNDED_CONVERSATION],
      messages: GROUNDED_MESSAGES,
      projects: [
        {
          id: 'proj-synth-1',
          name: 'Synthetic Ops Docs',
          description: 'Disposable fixture workspace',
          instructions: 'Answer only from attached runbook excerpts.',
          archived: false,
          created_at: new Date().toISOString(),
        },
      ],
    });

    // Messages mock in fixture filters by conversation_id query; extend metadata pass-through
    // by fulfilling messages with the grounded rows (setup already seeded GROUNDED_MESSAGES).
    await signInAsMockUser(page);

    // Authorized shell
    await expect(page.getByRole('textbox', { name: /message prismatix/i })).toBeVisible();

    if (isMobile) {
      const toggle = page.locator('button[aria-label="Toggle conversations sidebar"]');
      if (await toggle.isVisible()) {
        await toggle.click();
      }
    }

    // Resume existing conversation
    await expect(page.getByText('Grounded Doc Q&A')).toBeVisible();
    await page.getByText('Grounded Doc Q&A').click();
    await expect(page.getByText(/99\.9% monthly SLA/i)).toBeVisible();

    // Inspect grounded source citations mapped from message.metadata.citations.
    const sources = page.locator('.message-citations-container');
    await expect(sources.first()).toBeVisible();
    await expect(sources.first()).toContainText(/Sources/i);
    await expect(sources.first()).toContainText(/docs\.prismatix\.test/i);

    // Attach a controlled document and verify composer attachment chrome.
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);
    await fileInput.setInputFiles({
      name: 'router-runbook.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Router Runbook\n\nAvailability target: 99.9% monthly SLA.\n'),
    });
    await expect(page.getByText('1 file attached')).toBeVisible();
    await expect(page.locator('.draft-filename')).toContainText(/router-runbook/i);

    // Provider unavailable: failed send must restore draft (existing F02 contract).
    await page.route('**/functions/v1/router*', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Router temporarily unavailable' }),
      });
    });

    const composer = page.getByRole('textbox', { name: /message prismatix/i });
    const prompt = 'Confirm the router SLA from the attached runbook.';
    await composer.fill(prompt);
    await page.locator('button[aria-label="Send message"]').click();

    const recovery = page.locator('.draft-recovery-bar');
    await expect(recovery).toBeVisible();
    await expect(recovery).toContainText(/Send failed/i);
    await recovery.getByRole('button', { name: /restore draft/i }).click();
    await expect(composer).toHaveValue(prompt);
    await expect(composer).toBeFocused();

    // Reload must keep authorized session (mock storage + auth routes).
    await page.reload();
    await expect(page.getByRole('textbox', { name: /message prismatix/i })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('#email')).toHaveCount(0);
    await expect(page.locator('.user-button')).toBeVisible();
  });
});
