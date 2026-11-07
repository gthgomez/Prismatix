// tests/productivity/productivity_wave2.test.ts
// Unit tests for Wave 2 PR 4: F16–F20 Productivity features.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { previewConversationImport, executeConversationImport } from '../../src/services/conversationImport';
import { branchConversation, persistMessageVersion, recordMessageVersion } from '../../src/services/conversationBranching';
import {
  substituteVariables,
  extractTemplateVariables,
  listPromptTemplates,
  createPromptTemplate,
  updatePromptTemplate,
} from '../../src/services/promptTemplateService';
import {
  getLocalPreferences,
  setLocalPreferences,
  clearLocalPreferences,
  saveServerPreferences,
  syncPreferences,
  DEFAULT_PREFERENCES,
} from '../../src/services/userPreferencesService';
import { archiveConversation, setConversationTags } from '../../src/services/conversationService';

describe('F16: Conversation Import & Migration', () => {
  it('parses and previews native Prismatix JSON export correctly', () => {
    const raw = JSON.stringify({
      version: '1.0',
      exportedAt: '2026-11-07T00:00:00Z',
      conversations: [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Imported Chat 1',
          createdAt: '2026-11-01T12:00:00Z',
          messages: [
            { role: 'user', content: 'Hello world' },
            { role: 'assistant', content: 'Hi there!' },
          ],
        },
      ],
    });

    const preview = previewConversationImport(raw);
    expect(preview.valid).toBe(true);
    expect(preview.totalConversations).toBe(1);
    expect(preview.totalMessages).toBe(2);
    expect(preview.conversations?.[0]?.title).toBe('Imported Chat 1');
  });

  it('parses and previews ChatGPT conversations.json format correctly', () => {
    const raw = JSON.stringify([
      {
        id: 'chatgpt-conv-1',
        title: 'ChatGPT Discussion',
        create_time: 1700000000,
        mapping: {
          node1: {
            message: {
              author: { role: 'user' },
              content: { parts: ['Explain quantum computing'] },
            },
          },
          node2: {
            message: {
              author: { role: 'assistant' },
              content: { parts: ['Quantum computing uses qubits...'] },
            },
          },
        },
      },
    ]);

    const preview = previewConversationImport(raw);
    expect(preview.valid).toBe(true);
    expect(preview.totalConversations).toBe(1);
    expect(preview.totalMessages).toBe(2);
    expect(preview.conversations?.[0]?.title).toBe('ChatGPT Discussion');
  });

  it('parses and previews Claude export format correctly', () => {
    const raw = JSON.stringify([
      {
        uuid: 'claude-uuid-1',
        name: 'Claude Brainstorm',
        created_at: '2026-10-15T10:00:00Z',
        chat_messages: [
          { sender: 'human', text: 'Write a poem' },
          { sender: 'assistant', text: 'Roses are red' },
        ],
      },
    ]);

    const preview = previewConversationImport(raw);
    expect(preview.valid).toBe(true);
    expect(preview.totalConversations).toBe(1);
    expect(preview.totalMessages).toBe(2);
    expect(preview.conversations?.[0]?.title).toBe('Claude Brainstorm');
  });

  it('returns invalid status on unparseable JSON or empty structure', () => {
    const badJson = previewConversationImport('not valid json');
    expect(badJson.valid).toBe(false);
    expect(badJson.error).toMatch(/Invalid JSON/);

    const emptyObj = previewConversationImport('{}');
    expect(emptyObj.valid).toBe(false);
    expect(emptyObj.error).toMatch(/JSON structure/);
  });

  it('executes conversation import via secure server RPC', async () => {
    let calledRpcName = '';
    let rpcPayload: any = null;

    const mockClient: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } } }),
      },
      from: (table: string) => {
        expect(table).toBe('conversations');
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      },
      rpc: vi.fn((fnName, args) => {
        calledRpcName = fnName;
        rpcPayload = args;
        return Promise.resolve({
          data: {
            success: true,
            conversation_id: 'conv-new-1',
            messages_count: 2,
          },
          error: null,
        });
      }),
    };

    const raw = JSON.stringify({
      conversations: [
        {
          title: 'Imported Topic',
          messages: [
            { role: 'user', content: 'User question' },
            { role: 'assistant', content: 'Assistant answer', model: 'gemini-3.8-flash' },
          ],
        },
      ],
    });

    const result = await executeConversationImport(mockClient, raw);
    expect(result.success).toBe(true);
    expect(result.importedConversations).toBe(1);
    expect(result.importedMessages).toBe(2);
    expect(calledRpcName).toBe('px16_import_conversation');
    expect(rpcPayload.p_conversation.title).toBe('Imported Topic');
    expect(rpcPayload.p_conversation.messages).toHaveLength(2);
    expect(rpcPayload.p_conversation.messages[0].role).toBe('user');
    expect(rpcPayload.p_conversation.messages[1].model).toBe('gemini-3.8-flash');
  });
});

describe('F17: Conversation Branching & Version History', () => {
  it('branches conversation via px17_branch_conversation server RPC', async () => {
    let rpcName = '';
    let rpcArgs: any = null;

    const mockClient: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      rpc: vi.fn((name, args) => {
        rpcName = name;
        rpcArgs = args;
        return Promise.resolve({
          data: {
            success: true,
            new_conversation_id: 'conv-branch-123',
            copied_message_count: 2,
            title: 'Branch: Custom Title',
          },
          error: null,
        });
      }),
    };

    const res = await branchConversation(mockClient, {
      sourceConversationId: '123e4567-e89b-12d3-a456-426614174000',
      fromMessageId: '123e4567-e89b-12d3-a456-426614174001',
      branchTitle: 'Branch: Custom Title',
    });

    expect(rpcName).toBe('px17_branch_conversation');
    expect(rpcArgs.p_source_conversation_id).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(rpcArgs.p_from_message_id).toBe('123e4567-e89b-12d3-a456-426614174001');
    expect(rpcArgs.p_branch_title).toBe('Branch: Custom Title');
    expect(res.newConversationId).toBe('conv-branch-123');
    expect(res.copiedMessageCount).toBe(2);
    expect(res.newTitle).toBe('Branch: Custom Title');
  });

  it('persists message versions durably via px17_record_message_version RPC', async () => {
    let rpcName = '';
    let rpcArgs: any = null;

    const mockClient: any = {
      rpc: vi.fn((name, args) => {
        rpcName = name;
        rpcArgs = args;
        return Promise.resolve({
          data: {
            success: true,
            versions: [
              { version: 1, content: 'Initial', model: 'flash', timestamp: 1000 },
              { version: 2, content: 'Regenerated', model: 'sol', timestamp: 2000 },
            ],
            current_version: 2,
          },
          error: null,
        });
      }),
    };

    const res = await persistMessageVersion(
      mockClient,
      '123e4567-e89b-12d3-a456-426614174002',
      'Regenerated',
      'gpt-6-sol',
    );

    expect(rpcName).toBe('px17_record_message_version');
    expect(rpcArgs.p_message_id).toBe('123e4567-e89b-12d3-a456-426614174002');
    expect(rpcArgs.p_content).toBe('Regenerated');
    expect(rpcArgs.p_model).toBe('gpt-6-sol');
    expect(res.currentVersion).toBe(2);
    expect(res.versions).toHaveLength(2);
  });

  it('records message response versions in memory without overwriting previous versions', () => {
    const initialMessage: any = {
      id: 'msg-10',
      role: 'assistant',
      content: 'Initial answer from Flash',
      modelUsed: 'gemini-3.8-flash',
      createdAt: '2026-11-07T10:00:00Z',
      metadata: {},
    };

    const v2 = recordMessageVersion(initialMessage, 'Regenerated answer from Sol', 'gpt-6-sol');
    expect(v2.currentVersion).toBe(2);
    expect(v2.versions).toHaveLength(2);
    expect(v2.versions?.[0]?.version).toBe(1);
    expect(v2.versions?.[0]?.content).toBe('Initial answer from Flash');
    expect(v2.versions?.[1]?.version).toBe(2);
    expect(v2.versions?.[1]?.content).toBe('Regenerated answer from Sol');
    expect(v2.versions?.[1]?.model).toBe('gpt-6-sol');
  });
});

describe('F18: Chat Archiving and Tagging', () => {
  it('updates conversation archive flag via Supabase update', async () => {
    let updatePayload: any = null;
    let targetId: string | null = null;

    const mockClient: any = {
      from: (table: string) => {
        expect(table).toBe('conversations');
        return {
          update: (payload: any) => {
            updatePayload = payload;
            return {
              eq: (_col: string, val: string) => {
                targetId = val;
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    };

    await archiveConversation(mockClient, 'conv-test-1', true);
    expect(targetId).toBe('conv-test-1');
    expect(updatePayload).toEqual({ archived: true });

    await archiveConversation(mockClient, 'conv-test-1', false);
    expect(updatePayload).toEqual({ archived: false });
  });

  it('updates conversation tags array and trims whitespace', async () => {
    let updatePayload: any = null;

    const mockClient: any = {
      from: () => ({
        update: (payload: any) => {
          updatePayload = payload;
          return {
            eq: () => Promise.resolve({ error: null }),
          };
        },
      }),
    };

    await setConversationTags(mockClient, 'conv-test-2', [' research ', 'AI ', 'research']);
    expect(updatePayload).toEqual({ tags: ['research', 'AI'] });
  });
});

describe('F19: Reusable Prompt Library with Variable Substitution', () => {
  it('extracts unique variable placeholders from template text', () => {
    const text = 'Translate {{text}} into {{language}}. Ensure {{text}} is preserved.';
    const vars = extractTemplateVariables(text);
    expect(vars).toEqual(['text', 'language']);
  });

  it('substitutes variables safely into template text', () => {
    const template = 'Review this code for {{language}}: \n```\n{{code}}\n```\nFocus on {{priority}}.';
    const values = {
      language: 'TypeScript',
      code: 'const x: number = 42;',
      priority: 'performance and memory',
    };

    const substituted = substituteVariables(template, values);
    expect(substituted).toContain('Review this code for TypeScript:');
    expect(substituted).toContain('const x: number = 42;');
    expect(substituted).toContain('Focus on performance and memory.');
  });

  it('replaces unsupplied variables with empty string', () => {
    const template = 'Hello {{name}}, welcome to {{place}}!';
    const substituted = substituteVariables(template, { name: 'Alice' });
    expect(substituted).toBe('Hello Alice, welcome to !');
  });

  it('creates, updates, and lists prompt templates via Supabase client', async () => {
    const templatesList = [
      {
        id: 't-1',
        title: 'Code Review',
        template: 'Review code: {{code}}',
        variables: ['code'],
        category: 'coding',
      },
    ];

    let updatedPayload: any = null;

    const mockClient: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-123' } } }),
      },
      from: (table: string) => {
        expect(table).toBe('prompt_templates');
        return {
          select: () => ({
            order: () => Promise.resolve({ data: templatesList, error: null }),
          }),
          insert: vi.fn().mockReturnValue({
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    id: 't-2',
                    user_id: 'u-123',
                    title: 'Summarize',
                    template: 'Summarize {{doc}}',
                    variables: ['doc'],
                    category: 'writing',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  },
                  error: null,
                }),
            }),
          }),
          update: vi.fn((data) => {
            updatedPayload = data;
            return {
              eq: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: {
                        id: 't-1',
                        user_id: 'u-123',
                        title: data.title || 'Code Review Updated',
                        template: data.template || 'Updated {{code}}',
                        variables: ['code'],
                        category: 'coding',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                      },
                      error: null,
                    }),
                }),
              }),
            };
          }),
        };
      },
    };

    const list = await listPromptTemplates(mockClient);
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe('Code Review');

    const created = await createPromptTemplate(mockClient, {
      title: 'Summarize',
      template: 'Summarize {{doc}}',
      category: 'writing',
    });
    expect(created.success).toBe(true);
    expect(created.template?.variables).toEqual(['doc']);

    const updated = await updatePromptTemplate(mockClient, 't-1', {
      title: 'Code Review Advanced',
      template: 'Advanced review: {{code}}',
    });
    expect(updated.success).toBe(true);
    expect(updatedPayload.title).toBe('Code Review Advanced');
    expect(updatedPayload.variables).toEqual(['code']);
  });
});

describe('F20: User Preference Synchronization', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('scopes localStorage preferences by user ID to prevent cross-account leakage', () => {
    const prefsA = { ...DEFAULT_PREFERENCES, routingProfile: 'economy' as const };
    const prefsB = { ...DEFAULT_PREFERENCES, routingProfile: 'capability' as const };

    setLocalPreferences(prefsA, 'user-A');
    setLocalPreferences(prefsB, 'user-B');

    expect(getLocalPreferences('user-A').routingProfile).toBe('economy');
    expect(getLocalPreferences('user-B').routingProfile).toBe('capability');

    clearLocalPreferences('user-A');
    expect(getLocalPreferences('user-A').routingProfile).toBe('balanced'); // back to default
    expect(getLocalPreferences('user-B').routingProfile).toBe('capability'); // preserved
  });

  it('syncs preferences from server and merges with defaults', async () => {
    const mockClient: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-123' } } }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  preferences: {
                    routingProfile: 'deep_reasoning',
                    maxSpendCap: 0.5,
                  },
                  updated_at: '2026-11-07T08:00:00Z',
                },
                error: null,
              }),
          }),
        }),
      }),
    };

    const synced = await syncPreferences(mockClient);
    expect(synced.routingProfile).toBe('deep_reasoning');
    expect(synced.maxSpendCap).toBe(0.5);
    // Cached to user-scoped localStorage
    expect(getLocalPreferences('u-123').routingProfile).toBe('deep_reasoning');
  });

  it('saves preferences to server and updates local cache with user scoping', async () => {
    let upsertedData: any = null;

    const mockClient: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-123' } } }),
      },
      from: () => ({
        upsert: (payload: any) => {
          upsertedData = payload;
          return Promise.resolve({ error: null });
        },
      }),
    };

    const res = await saveServerPreferences(mockClient, {
      routingProfile: 'capability',
      webSearchEnabled: true,
    });

    expect(res.success).toBe(true);
    expect(upsertedData.user_id).toBe('u-123');
    expect(upsertedData.preferences.routingProfile).toBe('capability');
    expect(upsertedData.preferences.webSearchEnabled).toBe(true);
    expect(getLocalPreferences('u-123').routingProfile).toBe('capability');
  });
});
