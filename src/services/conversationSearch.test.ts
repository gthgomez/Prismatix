// src/services/conversationSearch.test.ts
import { describe, it, expect, vi } from 'vitest';
import { sanitizeSearchSnippet, extractSafeSnippet, searchChatHistory } from './conversationSearch';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('conversationSearch', () => {
  describe('sanitizeSearchSnippet', () => {
    it('escapes raw HTML tags to prevent XSS while preserving <mark> and </mark>', () => {
      const malicious = '<script>alert(1)</script> Here is <mark>matching</mark> text and <img src=x onerror=alert(2) />';
      const sanitized = sanitizeSearchSnippet(malicious);
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('<img');
      expect(sanitized).toContain('&lt;script&gt;');
      expect(sanitized).toContain('&lt;img');
      expect(sanitized).toContain('<mark>matching</mark>');
    });

    it('returns empty string for empty input', () => {
      expect(sanitizeSearchSnippet('')).toBe('');
    });
  });

  describe('extractSafeSnippet', () => {
    it('creates an excerpt with <mark> tags around the query match', () => {
      const text = 'The quick brown fox jumps over the lazy dog in the sunny meadow.';
      const snippet = extractSafeSnippet(text, 'lazy dog');
      expect(snippet).toContain('<mark>lazy dog</mark>');
    });

    it('handles query not found gracefully', () => {
      const text = 'Short text';
      const snippet = extractSafeSnippet(text, 'nonexistent');
      expect(snippet).toBe('Short text');
    });
  });

  describe('searchChatHistory', () => {
    it('returns empty array when query is empty or whitespace', async () => {
      const mockSupabase = {} as SupabaseClient;
      const res = await searchChatHistory(mockSupabase, '   ');
      expect(res).toEqual([]);
    });

    it('invokes RPC search_account_chat_history with sanitized parameters', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: [
          {
            conversation_id: 'conv-123',
            conversation_title: 'Research Chat',
            message_id: 'msg-456',
            role: 'assistant',
            snippet: 'Found <mark>Prismatix</mark> release note',
            created_at: '2026-11-07T00:00:00Z',
            match_type: 'message',
          },
        ],
        error: null,
      });

      const mockSupabase = {
        rpc: mockRpc,
      } as unknown as SupabaseClient;

      const results = await searchChatHistory(mockSupabase, 'Prismatix', { limit: 10, offset: 0 });
      expect(mockRpc).toHaveBeenCalledWith('search_account_chat_history', {
        p_query: 'Prismatix',
        p_limit: 10,
        p_offset: 0,
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.conversationId).toBe('conv-123');
      expect(results[0]?.conversationTitle).toBe('Research Chat');
      expect(results[0]?.snippet).toContain('<mark>Prismatix</mark>');
    });

    it('falls back to client-side query if RPC fails or is missing', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'function search_account_chat_history does not exist' },
      });

      const mockSupabase = {
        rpc: mockRpc,
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'conversations') {
            return {
              select: vi.fn().mockReturnValue({
                ilike: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    range: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: 'conv-999',
                          title: 'Fallback Conversation Test',
                          created_at: '2026-11-07T00:00:00Z',
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          return {
            select: vi.fn().mockReturnValue({
              ilike: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  range: vi.fn().mockResolvedValue({
                    data: [],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }),
      } as unknown as SupabaseClient;

      const results = await searchChatHistory(mockSupabase, 'Fallback', { limit: 5 });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]?.conversationId).toBe('conv-999');
      expect(results[0]?.matchType).toBe('title');
    });
  });
});
