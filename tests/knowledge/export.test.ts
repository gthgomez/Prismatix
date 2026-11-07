// tests/knowledge/export.test.ts
import { describe, it, expect } from 'vitest';
import {
  formatConversationJson,
  formatConversationMarkdown,
  formatBulkExportJson,
  sanitizeFilename,
  type ExportableConversation,
} from '../../src/services/conversationExport';

describe('Conversation Export Service (F10)', () => {
  const sampleConversation: ExportableConversation = {
    id: 'c123',
    title: 'Financial Analysis: Q4/2026',
    createdAt: '2026-11-07T10:00:00Z',
    lastActivityAt: '2026-11-07T10:05:00Z',
    projectId: 'p456',
    projectName: 'Tax Workspace',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Please summarize our 2026 operating expenses.',
        createdAt: '2026-11-07T10:00:00Z',
        attachments: [
          {
            name: 'expenses.xlsx',
            size: 20480,
            sheetCount: 2,
          },
        ],
      },
      {
        id: 'm2',
        role: 'assistant',
        content: 'Total expenses were $145,200 across engineering and operations.',
        createdAt: '2026-11-07T10:00:05Z',
        model: 'gpt-4o',
        provider: 'openai',
        cost: 0.0012,
        costStatus: 'settled',
        promptTokens: 250,
        completionTokens: 80,
      },
    ],
  };

  it('sanitizes filename across filesystems', () => {
    const filename = sanitizeFilename('Report: Q4/2026? *Special* <Final>', 'md');
    expect(filename).not.toMatch(/[<>:"/\\|?*]/);
    expect(filename).toMatch(/Report_Q4_2026_Special_Final_\d{4}-\d{2}-\d{2}\.md/);
  });

  it('exports conversation to structured JSON with model provenance and cost receipt', () => {
    const jsonStr = formatConversationJson(sampleConversation);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.exportVersion).toBe('1.0');
    expect(parsed.conversation.id).toBe('c123');
    expect(parsed.conversation.title).toBe('Financial Analysis: Q4/2026');
    expect(parsed.conversation.project.name).toBe('Tax Workspace');
    expect(parsed.conversation.messages).toHaveLength(2);
    expect(parsed.conversation.messages[1].model).toBe('gpt-4o');
    expect(parsed.conversation.messages[1].cost).toBe(0.0012);
    expect(parsed.conversation.messages[1].costStatus).toBe('settled');
    expect(parsed.conversation.messages[0].attachments[0].sheetCount).toBe(2);
  });

  it('exports conversation to formatted Markdown with provenance and receipt headers', () => {
    const md = formatConversationMarkdown(sampleConversation);

    expect(md).toContain('# Financial Analysis: Q4/2026');
    expect(md).toContain('- **Project Workspace**: Tax Workspace');
    expect(md).toContain('### User');
    expect(md).toContain('📎 `expenses.xlsx` (20 KB, 2 sheets)');
    expect(md).toContain('### Assistant (gpt-4o)');
    expect(md).toContain('> *Receipt: $0.0012 [settled]*');
  });

  it('formats bulk archive export JSON', () => {
    const bulkJson = formatBulkExportJson([sampleConversation]);
    const parsed = JSON.parse(bulkJson);

    expect(parsed.totalConversations).toBe(1);
    expect(parsed.conversations[0].id).toBe('c123');
  });
});
