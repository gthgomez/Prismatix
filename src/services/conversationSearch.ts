// src/services/conversationSearch.ts
// Global account-scoped full-text search across conversations and message bodies (F05).
//
// Safe indexed search running under RLS. Treats query strictly as plain data.
// Provides XSS-safe HTML sanitization on snippets.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ChatSearchResult {
  conversationId: string;
  conversationTitle: string;
  messageId: string | null;
  role: 'user' | 'assistant' | null;
  snippet: string;
  createdAt: string;
  matchType: 'title' | 'message';
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
}

/**
 * Escapes unsafe HTML characters while preserving explicitly authorized <mark> tags.
 */
export function sanitizeSearchSnippet(raw: string): string {
  if (!raw) return '';
  // Temporary placeholder for safe mark tags
  const MARK_START = '___MARK_START___';
  const MARK_END = '___MARK_END___';

  const preserved = raw
    .replace(/<mark>/gi, MARK_START)
    .replace(/<\/mark>/gi, MARK_END);

  const escaped = preserved
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  return escaped
    .replace(new RegExp(MARK_START, 'g'), '<mark>')
    .replace(new RegExp(MARK_END, 'g'), '</mark>');
}

/**
 * Generates an excerpt snippet highlighting the query term if ts_headline is unavailable.
 */
export function extractSafeSnippet(text: string, query: string, maxLength = 160): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  const lowerText = clean.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();

  if (!lowerQuery) {
    return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength)}…`;
  }

  const matchIdx = lowerText.indexOf(lowerQuery);
  if (matchIdx === -1) {
    return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength)}…`;
  }

  const start = Math.max(0, matchIdx - 40);
  const end = Math.min(clean.length, matchIdx + lowerQuery.length + 80);

  const prefix = start > 0 ? '…' : '';
  const suffix = end < clean.length ? '…' : '';

  const matchedPart = clean.slice(matchIdx, matchIdx + lowerQuery.length);
  const beforeMatch = clean.slice(start, matchIdx);
  const afterMatch = clean.slice(matchIdx + lowerQuery.length, end);

  return `${prefix}${beforeMatch}<mark>${matchedPart}</mark>${afterMatch}${suffix}`;
}

/**
 * Searches all owned conversations and message bodies for the authenticated user.
 */
export async function searchChatHistory(
  client: SupabaseClient,
  query: string,
  options: SearchOptions = {},
): Promise<ChatSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const offset = Math.max(0, options.offset ?? 0);

  // 1. Try server RPC with indexed FTS
  try {
    const { data, error } = await client.rpc('search_account_chat_history', {
      p_query: trimmed,
      p_limit: limit,
      p_offset: offset,
    });

    if (!error && Array.isArray(data)) {
      return (data as Array<Record<string, unknown>>).map((row) => ({
        conversationId: String(row.conversation_id),
        conversationTitle: String(row.conversation_title || 'Untitled Conversation'),
        messageId: row.message_id ? String(row.message_id) : null,
        role: row.role === 'user' || row.role === 'assistant' ? row.role : null,
        snippet: sanitizeSearchSnippet(String(row.snippet || '')),
        createdAt: String(row.created_at),
        matchType: row.match_type === 'title' ? 'title' : 'message',
      }));
    }
  } catch {
    // RPC not present or failed, fall through to client RLS fallback
  }

  // 2. Client RLS query fallback (works in local/staging without migration applied)
  const [convResult, msgResult] = await Promise.all([
    client
      .from('conversations')
      .select('id, title, created_at')
      .ilike('title', `%${trimmed}%`)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),
    client
      .from('messages')
      .select('id, conversation_id, role, content, created_at, conversations!inner(id, title)')
      .ilike('content', `%${trimmed}%`)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),
  ]);

  const results: ChatSearchResult[] = [];

  if (Array.isArray(msgResult.data)) {
    for (const row of msgResult.data as Array<Record<string, unknown>>) {
      const conv = row.conversations as Record<string, unknown> | undefined;
      results.push({
        conversationId: String(row.conversation_id),
        conversationTitle: String(conv?.title || 'Untitled Conversation'),
        messageId: String(row.id),
        role: row.role === 'user' || row.role === 'assistant' ? (row.role as 'user' | 'assistant') : null,
        snippet: sanitizeSearchSnippet(extractSafeSnippet(String(row.content || ''), trimmed)),
        createdAt: String(row.created_at),
        matchType: 'message',
      });
    }
  }

  if (Array.isArray(convResult.data)) {
    for (const row of convResult.data as Array<Record<string, unknown>>) {
      results.push({
        conversationId: String(row.id),
        conversationTitle: String(row.title || 'Untitled Conversation'),
        messageId: null,
        role: null,
        snippet: sanitizeSearchSnippet(String(row.title || 'Untitled Conversation')),
        createdAt: String(row.created_at),
        matchType: 'title',
      });
    }
  }

  return results.slice(0, limit);
}
