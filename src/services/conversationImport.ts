// src/services/conversationImport.ts
// F16: Conversation import and migration for Prismatix JSON format.
// Validates schema, previews content, maps projects, avoids duplicates,
// labels historical costs as 'imported' (never billable), and enforces user isolation.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExportableConversation, ExportableMessage } from './conversationExport';

export interface ImportPreview {
  valid: boolean;
  version?: string;
  totalConversations: number;
  totalMessages: number;
  conversations: Array<{
    id: string;
    title: string;
    messageCount: number;
    createdAt?: string;
    projectName?: string | null;
  }>;
  projects: Array<{ id?: string; name: string }>;
  warnings: string[];
  error?: string;
}

export interface ImportOptions {
  skipExisting?: boolean;
  assignProjectId?: string | null;
}

export interface ImportResult {
  success: boolean;
  importedConversations: number;
  importedMessages: number;
  skippedConversations: number;
  errors: string[];
}

function isUuid(val: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Normalizes input JSON from Prismatix, ChatGPT, or Claude into standard exportable format.
 */
export function normalizeImportConversations(
  parsed: unknown,
): { version: string; conversations: ExportableConversation[] } | null {
  if (!parsed || typeof parsed !== 'object') return null;

  let version = '1.0';
  let conversationsList: ExportableConversation[] = [];

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { version, conversations: [] };
    const first = parsed[0] as Record<string, unknown>;

    // 1. Claude export: array of objects with chat_messages
    if ('chat_messages' in first) {
      conversationsList = (parsed as any[]).map((c, i) => ({
        id: typeof c.uuid === 'string' && isUuid(c.uuid) ? c.uuid : generateUuid(),
        title: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : `Claude Conversation ${i + 1}`,
        createdAt: typeof c.created_at === 'string' ? c.created_at : new Date().toISOString(),
        messages: Array.isArray(c.chat_messages)
          ? c.chat_messages
              .map((m: any) => ({
                role: m.sender === 'human' ? 'user' : 'assistant',
                content: typeof m.text === 'string' ? m.text : '',
              }))
              .filter((m: any) => m.content.length > 0)
          : [],
      }));
      return { version: 'claude-v1', conversations: conversationsList };
    }

    // 2. ChatGPT export: array of objects with mapping or create_time
    if ('mapping' in first || ('title' in first && 'create_time' in first)) {
      conversationsList = (parsed as any[]).map((c, i) => {
        const msgs: ExportableMessage[] = [];
        if (c.mapping && typeof c.mapping === 'object') {
          for (const node of Object.values(c.mapping) as any[]) {
            const m = node?.message;
            if (m && m.content && Array.isArray(m.content.parts)) {
              const text = m.content.parts.filter((p: any) => typeof p === 'string').join('\n').trim();
              const role = m.author?.role === 'user' ? 'user' : m.author?.role === 'assistant' ? 'assistant' : null;
              if (role && text) {
                msgs.push({ role, content: text });
              }
            }
          }
        }
        return {
          id: typeof c.id === 'string' && isUuid(c.id) ? c.id : generateUuid(),
          title: typeof c.title === 'string' && c.title.trim() ? c.title.trim() : `ChatGPT Conversation ${i + 1}`,
          createdAt: typeof c.create_time === 'number' ? new Date(c.create_time * 1000).toISOString() : new Date().toISOString(),
          messages: msgs,
        };
      });
      return { version: 'chatgpt-v1', conversations: conversationsList };
    }

    conversationsList = parsed as ExportableConversation[];
  } else {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.version === 'string') version = obj.version;
    if (Array.isArray(obj.conversations)) {
      conversationsList = obj.conversations as ExportableConversation[];
    } else if (obj.conversation && typeof obj.conversation === 'object') {
      conversationsList = [obj.conversation as ExportableConversation];
    } else if (typeof obj.id === 'string' && Array.isArray(obj.messages)) {
      conversationsList = [obj as unknown as ExportableConversation];
    } else {
      return null;
    }
  }

  return { version, conversations: conversationsList };
}

/**
 * Validates and previews a Prismatix, ChatGPT, or Claude JSON export without persisting anything.
 */
export function previewConversationImport(rawJson: string): ImportPreview {
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    return {
      valid: false,
      totalConversations: 0,
      totalMessages: 0,
      conversations: [],
      projects: [],
      warnings: [],
      error: `Invalid JSON syntax: ${(err as Error).message}`,
    };
  }

  const normalized = normalizeImportConversations(parsed);
  if (!normalized) {
    return {
      valid: false,
      totalConversations: 0,
      totalMessages: 0,
      conversations: [],
      projects: [],
      warnings: [],
      error: 'JSON structure does not contain valid conversations or messages.',
    };
  }

  const { version, conversations: conversationsList } = normalized;

  const projectsMap = new Map<string, { id?: string; name: string }>();
  const validatedConvs: ImportPreview['conversations'] = [];
  let totalMessages = 0;

  for (let i = 0; i < conversationsList.length; i++) {
    const conv = conversationsList[i];
    if (!conv || typeof conv !== 'object') {
      warnings.push(`Item ${i + 1} is not a valid conversation object; skipped.`);
      continue;
    }

    const title = typeof conv.title === 'string' && conv.title.trim() ? conv.title.trim() : `Imported Conversation ${i + 1}`;
    const rawMessages = Array.isArray(conv.messages) ? conv.messages : [];
    const validMessages = rawMessages.filter(
      (m): m is ExportableMessage =>
        Boolean(m) && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
    );

    totalMessages += validMessages.length;

    if (conv.projectName) {
      projectsMap.set(conv.projectName, { id: conv.projectId || undefined, name: conv.projectName });
    }

    validatedConvs.push({
      id: typeof conv.id === 'string' && isUuid(conv.id) ? conv.id : generateUuid(),
      title,
      messageCount: validMessages.length,
      createdAt: conv.createdAt,
      projectName: conv.projectName,
    });
  }

  return {
    valid: validatedConvs.length > 0,
    version,
    totalConversations: validatedConvs.length,
    totalMessages,
    conversations: validatedConvs,
    projects: Array.from(projectsMap.values()),
    warnings,
  };
}

/**
 * Executes a validated import into the user's Supabase account.
 * Labels historical costs as 'imported' and prevents billing mutations.
 */
export async function executeConversationImport(
  client: SupabaseClient,
  rawJson: string,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const preview = previewConversationImport(rawJson);
  if (!preview.valid) {
    return {
      success: false,
      importedConversations: 0,
      importedMessages: 0,
      skippedConversations: 0,
      errors: [preview.error || 'Invalid import payload'],
    };
  }

  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return {
      success: false,
      importedConversations: 0,
      importedMessages: 0,
      skippedConversations: 0,
      errors: ['User session not authenticated.'],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return {
      success: false,
      importedConversations: 0,
      importedMessages: 0,
      skippedConversations: 0,
      errors: ['JSON parse failed.'],
    };
  }

  const normalized = normalizeImportConversations(parsed);
  const rawList: ExportableConversation[] = normalized?.conversations || [];

  let importedConversations = 0;
  let importedMessages = 0;
  let skippedConversations = 0;
  const errors: string[] = [];

  // Fetch existing conversation IDs to prevent collisions
  const { data: existingRows } = await client
    .from('conversations')
    .select('id')
    .eq('user_id', user.id);

  const existingIds = new Set((existingRows || []).map((r) => r.id));

  for (const conv of rawList) {
    try {
      let targetConvId = conv.id && isUuid(conv.id) ? conv.id : generateUuid();

      if (existingIds.has(targetConvId)) {
        if (options.skipExisting) {
          skippedConversations++;
          continue;
        } else {
          // Re-key conversation ID to avoid colliding with existing records
          targetConvId = generateUuid();
        }
      }

      const convTitle = conv.title?.trim() || 'Imported Chat';
      const projectId = options.assignProjectId !== undefined ? options.assignProjectId : conv.projectId || null;

      const rawMessages = Array.isArray(conv.messages) ? conv.messages : [];
      const messagesPayload = rawMessages
        .filter((msg) => msg && typeof msg.content === 'string' && msg.content.trim().length > 0)
        .map((msg) => ({
          id: msg.id && isUuid(msg.id) ? msg.id : generateUuid(),
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content,
          model: msg.model || null,
          tokenCount: (msg.promptTokens || 0) + (msg.completionTokens || 0),
          createdAt: msg.createdAt || new Date().toISOString(),
          cost: msg.cost || null,
        }));

      // Call secure server RPC to persist conversation and messages atomically
      const { data: rpcData, error: rpcErr } = await client.rpc('px16_import_conversation', {
        p_conversation: {
          id: targetConvId,
          title: convTitle,
          projectId: projectId && isUuid(projectId) ? projectId : null,
          createdAt: conv.createdAt || new Date().toISOString(),
          lastActivityAt: conv.lastActivityAt || new Date().toISOString(),
          messages: messagesPayload,
        },
      });

      if (rpcErr) {
        errors.push(`Failed to import conversation "${convTitle}": ${rpcErr.message}`);
        continue;
      }

      const res = rpcData as { success?: boolean; conversation_id?: string; messages_count?: number } | null;
      if (res?.success) {
        importedConversations++;
        importedMessages += (res.messages_count || 0);
        existingIds.add(res.conversation_id || targetConvId);
      } else {
        errors.push(`Failed to import conversation "${convTitle}": unexpected server response`);
      }
    } catch (err) {
      errors.push(`Exception importing conversation: ${(err as Error).message}`);
    }
  }

  return {
    success: importedConversations > 0 && errors.length === 0,
    importedConversations,
    importedMessages,
    skippedConversations,
    errors,
  };
}
