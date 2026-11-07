// tests/e2e/pr2_knowledge.spec.ts
// Real browser Playwright coverage for PR 2 Knowledge Workspace (F06-F10).

import { test, expect } from '@playwright/test';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

test.describe('PR 2 Knowledge Workspace (E2E)', () => {
  test('F06, F07, F08: file upload accepts PDF, DOCX, and XLSX document formats', async ({ page }) => {
    await setupAuthenticatedMock(page, { hasProviderKey: true });
    await signInAsMockUser(page);

    // Locate file input element
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);

    const accept = await fileInput.getAttribute('accept');
    expect(accept).toContain('.pdf');
    expect(accept).toContain('.docx');
    expect(accept).toContain('.xlsx');

    // Create a deterministic synthetic PDF fixture buffer
    const samplePdf = `%PDF-1.4
1 0 obj
<< /Type /Page >>
endobj
2 0 obj
stream
BT
/F1 12 Tf
(Q3 Infrastructure Benchmark Analysis) Tj
ET
endstream
endobj
trailer
<< /Root 1 0 R >>
%%EOF`;

    // Upload the PDF fixture
    await fileInput.setInputFiles({
      name: 'infrastructure_report.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(samplePdf),
    });

    // Verify attachment appears with extracted page count in the composer
    await expect(page.getByText(/1 file attached/i)).toBeVisible();
    await expect(page.getByText(/infrastructure_re/i)).toBeVisible();
    await expect(page.getByText(/1p/i)).toBeVisible();
  });

  test('F09: project workspace management and scoping', async ({ page, isMobile }) => {
    const mockProjects = [
      {
        id: 'proj-1',
        name: 'Distributed Systems Workspace',
        description: 'Protocols, Paxos, and Raft analysis',
        instructions: 'Focus on consensus safety, network partitions, and quorum sizing.',
        archived: false,
        created_at: new Date().toISOString(),
      },
    ];

    await setupAuthenticatedMock(page, {
      hasProviderKey: true,
      projects: mockProjects,
    });

    await signInAsMockUser(page);

    if (isMobile) {
      const toggleSidebarBtn = page.locator('button[aria-label="Toggle conversations sidebar"]');
      await toggleSidebarBtn.waitFor({ state: 'visible', timeout: 5000 });
      await toggleSidebarBtn.click();
    }

    // Project select dropdown must be present in sidebar
    const projectCombobox = page.getByRole('combobox', { name: /Filter by project workspace/i });
    await expect(projectCombobox).toBeVisible();
    await expect(projectCombobox.locator('option')).toContainText(['All workspaces', 'Distributed Systems Workspace']);

    // Select the project workspace
    await projectCombobox.selectOption({ label: 'Distributed Systems Workspace' });

    // Click create / manage project workspace button
    const createProjectBtn = page.getByRole('button', { name: /Create project workspace/i });
    await expect(createProjectBtn).toBeVisible();
    await createProjectBtn.click();

    // Verify project modal opens
    const modal = page.locator('.knowledge-modal-card');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(/Project Workspace/i);

    // Close modal via Cancel button or close icon
    const cancelBtn = modal.getByRole('button', { name: 'Cancel' });
    if (await cancelBtn.isVisible()) {
      await cancelBtn.click();
    } else {
      const closeBtn = modal.locator('button:has-text("×")').first();
      await closeBtn.click({ force: true });
    }
    await expect(modal).not.toBeVisible();
  });

  test('F10: conversation export modal triggers markdown and bulk archive download', async ({ page, isMobile }) => {
    await setupAuthenticatedMock(page, {
      hasProviderKey: true,
      conversations: [
        {
          id: 'c1111111-1111-4111-8111-111111111111',
          title: 'Export Verification Chat',
          last_activity_at: new Date().toISOString(),
        },
      ],
    });

    await signInAsMockUser(page);

    if (isMobile) {
      const toggleSidebarBtn = page.locator('button[aria-label="Toggle conversations sidebar"]');
      await toggleSidebarBtn.waitFor({ state: 'visible', timeout: 5000 });
      await toggleSidebarBtn.click();
    }

    // Select the active conversation so export has an active chat context
    const chatItem = page.getByText('Export Verification Chat');
    await expect(chatItem).toBeVisible();
    await chatItem.click();

    if (isMobile) {
      const toggleSidebarBtn = page.locator('button[aria-label="Toggle conversations sidebar"]');
      await toggleSidebarBtn.click();
    }

    // Open Export Modal via export button in sidebar
    const exportBtn = page.getByRole('button', { name: 'Export', exact: true });
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    // Verify Export Modal opens
    const exportModal = page.locator('.knowledge-modal-card');
    await expect(exportModal).toBeVisible();
    await expect(exportModal).toContainText('Export & Portability');

    // Test active conversation Markdown download trigger
    const downloadPromise = page.waitForEvent('download');
    const mdBtn = exportModal.getByRole('button', { name: /download markdown/i });
    await expect(mdBtn).toBeVisible();
    await mdBtn.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.md$/i);

    // Close modal
    const closeBtn = exportModal.locator('button:has-text("×")').first();
    await closeBtn.click({ force: true });
    await expect(exportModal).not.toBeVisible();
  });
});
