// src/services/conversationExport.ts
// F10: Conversation export and portability (JSON and formatted Markdown).
// Exports provenance, model receipts, and attachment references with filename sanitization.
// Strictly excludes credentials and secrets.

import type { RouterModel } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  listConversations,
  loadConversation,
  type ConversationSummary,
  type LoadedMessage,
} from './conversationService';

export interface ExportableConversation {
  id: string;
  title: string;
  createdAt?: string;
  lastActivityAt?: string;
  projectId?: string | null;
  projectName?: string | null;
  messages: ExportableMessage[];
}

export interface ExportableMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  model?: RouterModel;
  provider?: string;
  cost?: number;
  costStatus?: string;
  promptTokens?: number;
  completionTokens?: number;
  attachments?: Array<{
    name: string;
    kind?: string;
    size?: number;
    pageCount?: number;
    sheetCount?: number;
  }>;
}

/**
 * Sanitizes a title string into a safe file name across Windows, Mac, and Linux.
 */
export function sanitizeFilename(title: string, extension: 'json' | 'md'): string {
  const safe = (title || 'conversation')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim()
    .slice(0, 60);

  const date = new Date().toISOString().slice(0, 10);
  return `${safe || 'conversation'}_${date}.${extension}`;
}

/**
 * Formats a single conversation as a portable JSON string.
 */
export function formatConversationJson(conversation: ExportableConversation): string {
  const sanitized = {
    exportVersion: '1.0',
    exportedAt: new Date().toISOString(),
    conversation: {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      lastActivityAt: conversation.lastActivityAt,
      project: conversation.projectName
        ? { id: conversation.projectId, name: conversation.projectName }
        : null,
      messages: conversation.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        model: m.model,
        provider: m.provider,
        cost: m.cost,
        costStatus: m.costStatus,
        tokens: m.promptTokens || m.completionTokens
          ? {
              promptTokens: m.promptTokens,
              completionTokens: m.completionTokens,
            }
          : undefined,
        attachments: m.attachments,
      })),
    },
  };

  return JSON.stringify(sanitized, null, 2);
}

/**
 * Formats multiple conversations into a bulk archive JSON string.
 */
export function formatBulkExportJson(conversations: ExportableConversation[]): string {
  const sanitized = {
    exportVersion: '1.0',
    exportedAt: new Date().toISOString(),
    totalConversations: conversations.length,
    conversations: conversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt,
      lastActivityAt: conv.lastActivityAt,
      project: conv.projectName ? { id: conv.projectId, name: conv.projectName } : null,
      messages: conv.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        model: m.model,
        provider: m.provider,
        cost: m.cost,
        costStatus: m.costStatus,
        tokens: m.promptTokens || m.completionTokens
          ? {
              promptTokens: m.promptTokens,
              completionTokens: m.completionTokens,
            }
          : undefined,
        attachments: m.attachments,
      })),
    })),
  };

  return JSON.stringify(sanitized, null, 2);
}

/**
 * Formats a single conversation as human-readable GitHub Flavored Markdown.
 */
export function formatConversationMarkdown(conversation: ExportableConversation): string {
  const lines: string[] = [];

  lines.push(`# ${conversation.title || 'Untitled Conversation'}`);
  lines.push('');
  lines.push(`- **Conversation ID**: \`${conversation.id}\``);
  if (conversation.createdAt) lines.push(`- **Created**: ${conversation.createdAt}`);
  if (conversation.projectName) lines.push(`- **Project Workspace**: ${conversation.projectName}`);
  lines.push(`- **Exported**: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of conversation.messages) {
    const isUser = msg.role === 'user';
    const roleHeading = isUser ? '### User' : `### Assistant (${msg.model || 'Auto-routed'})`;

    lines.push(roleHeading);
    if (msg.createdAt) {
      lines.push(`*Sent: ${msg.createdAt}*`);
    }

    if (msg.attachments && msg.attachments.length > 0) {
      lines.push('');
      lines.push('**Attachments:**');
      for (const att of msg.attachments) {
        const details: string[] = [];
        if (att.size) details.push(`${Math.round(att.size / 1024)} KB`);
        if (att.pageCount) details.push(`${att.pageCount} pages`);
        if (att.sheetCount) details.push(`${att.sheetCount} sheets`);
        const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
        lines.push(`- 📎 \`${att.name}\`${detailStr}`);
      }
    }

    lines.push('');
    lines.push(msg.content);
    lines.push('');

    if (!isUser && (msg.cost !== undefined || msg.costStatus)) {
      const costAmount = msg.cost !== undefined ? `$${msg.cost.toFixed(4)}` : 'N/A';
      const status = msg.costStatus ? ` [${msg.costStatus}]` : '';
      lines.push(`> *Receipt: ${costAmount}${status}*`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Initiates browser file download for exported content.
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  if (typeof window === 'undefined') return;

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ExportProgress {
  stage: 'listing' | 'messages' | 'complete' | 'cancelled';
  conversationsLoaded: number;
  totalConversations?: number;
  currentTitle?: string;
}

export interface ExportResult {
  conversations: ExportableConversation[];
  partialErrors: Array<{ conversationId: string; error: string }>;
  isComplete: boolean;
}

/**
 * Paginates through the user's complete conversation and message history.
 * Never silences errors, preserves full model/cost/receipt metadata, and supports cancellation (F10).
 */
export async function fetchAllExportableConversations(
  client: SupabaseClient,
  options: {
    onProgress?: (progress: ExportProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<ExportResult> {
  const allSummaries: ConversationSummary[] = [];
  let beforeCursor: { lastActivityAt: string; id: string } | undefined = undefined;
  const PAGE_LIMIT = 50;

  // 1. Fetch entire conversation list without arbitrary 100-item cap
  while (true) {
    if (options.signal?.aborted) {
      return { conversations: [], partialErrors: [], isComplete: false };
    }

    const batch = await listConversations(client, {
      limit: PAGE_LIMIT,
      before: beforeCursor,
    });

    if (batch.length === 0) break;
    allSummaries.push(...batch);

    if (options.onProgress) {
      options.onProgress({
        stage: 'listing',
        conversationsLoaded: allSummaries.length,
      });
    }

    if (batch.length < PAGE_LIMIT) break;
    const last = batch[batch.length - 1];
    if (!last) break;
    beforeCursor = { lastActivityAt: last.lastActivityAt, id: last.id };
  }

  const exportableList: ExportableConversation[] = [];
  const partialErrors: Array<{ conversationId: string; error: string }> = [];

  // 2. Fetch all messages per conversation
  for (let i = 0; i < allSummaries.length; i++) {
    if (options.signal?.aborted) {
      return { conversations: exportableList, partialErrors, isComplete: false };
    }

    const summary = allSummaries[i];
    if (!summary) continue;

    if (options.onProgress) {
      options.onProgress({
        stage: 'messages',
        conversationsLoaded: i + 1,
        totalConversations: allSummaries.length,
        currentTitle: summary.title || 'Untitled',
      });
    }

    try {
      const allMessages: LoadedMessage[] = [];
      let msgBeforeCursor: { createdAt: string; id: string } | undefined = undefined;
      const MSG_PAGE_LIMIT = 100;

      while (true) {
        if (options.signal?.aborted) break;

        const msgBatch = await loadConversation(client, summary.id, {
          limit: MSG_PAGE_LIMIT,
          before: msgBeforeCursor,
        });

        if (msgBatch.length === 0) break;
        allMessages.unshift(...msgBatch);

        if (msgBatch.length < MSG_PAGE_LIMIT) break;
        const oldest = msgBatch[0];
        if (!oldest) break;
        msgBeforeCursor = { createdAt: oldest.createdAt, id: oldest.id };
      }

      exportableList.push({
        id: summary.id,
        title: summary.title || 'Untitled Conversation',
        lastActivityAt: summary.lastActivityAt,
        projectId: summary.projectId,
        messages: allMessages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          model: m.provenance?.model,
          provider: m.provenance?.provider,
          cost: m.provenance?.cost?.totalUsd,
          costStatus: m.provenance?.cost?.costStatus,
          promptTokens: m.tokenCount ?? undefined,
          attachments: m.attachments?.map((a) => ({
            name: a.name || 'attachment',
            kind: a.kind,
            size: a.size || undefined,
          })),
        })),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      partialErrors.push({ conversationId: summary.id, error: errMsg });
    }
  }

  if (options.onProgress) {
    options.onProgress({
      stage: 'complete',
      conversationsLoaded: exportableList.length,
      totalConversations: allSummaries.length,
    });
  }

  return {
    conversations: exportableList,
    partialErrors,
    isComplete: true,
  };
}
