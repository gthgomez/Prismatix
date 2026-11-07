// src/services/conversationExport.ts
// F10: Conversation export and portability (JSON and formatted Markdown).
// Exports provenance, model receipts, and attachment references with filename sanitization.
// Strictly excludes credentials and secrets.

import type { RouterModel } from '../types';

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
