// memory_helpers.ts - Long-term user memory retrieval and conversation summarization

import { createClient } from 'npm:@supabase/supabase-js@2';
import { countTokens, type Message } from './router_logic.ts';
import { MODEL_REGISTRY } from './router_logic.ts';

// ============================================================================
// CONSTANTS
// ============================================================================

const MEMORY_MAX_CANDIDATES = 24;
const MEMORY_MAX_INJECT = 3;
const MEMORY_MAX_CONTEXT_CHARS = 1500;
const MEMORY_SUMMARY_MIN_INTERVAL_MS = 10 * 60 * 1000;
const MEMORY_SUMMARY_MIN_TOKEN_DELTA = 2200;
const MEMORY_SUMMARY_MAX_MESSAGES = 24;
const MEMORY_SUMMARY_MIN_TRANSCRIPT_TOKENS = 220;

const MEMORY_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'your',
  'you', 'are', 'was', 'were', 'but', 'not', 'all', 'any', 'can', 'will',
  'just', 'about', 'into', 'over', 'when', 'what', 'where', 'how', 'why',
  'use', 'using', 'need', 'please',
]);

// ============================================================================
// TYPES
// ============================================================================

interface UserMemoryRecord {
  id: string;
  user_id: string;
  conversation_id: string | null;
  source_window_end_at: string;
  summary_text: string;
  tags: string[] | null;
  created_at: string;
}

interface ConversationMemoryStateRecord {
  conversation_id: string;
  user_id: string;
  last_summarized_at: string | null;
  last_summarized_message_created_at: string | null;
  last_summarized_total_tokens: number | null;
  updated_at: string;
}

interface ConversationMessageRecord {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface MemoryRetrievalResult {
  contextBlock: string;
  hits: number;
  tokenCount: number;
}

// ============================================================================
// KEYWORD / SCORING UTILITIES
// ============================================================================

export function extractKeywords(input: string): string[] {
  const words = input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !MEMORY_STOP_WORDS.has(word));
  return [...new Set(words)].slice(0, 20);
}

function truncateWithEllipsis(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

function scoreMemory(summary: string, tags: string[] | null, keywords: string[]): number {
  if (keywords.length === 0) return 1;
  const haystack = summary.toLowerCase();
  const tagSet = new Set((tags || []).map((tag) => tag.toLowerCase()));
  let score = 0;

  for (const keyword of keywords) {
    if (haystack.includes(keyword)) score += 2;
    if (tagSet.has(keyword)) score += 3;
  }
  return score;
}

function buildMemoryContextBlock(memories: UserMemoryRecord[]): string {
  const lines = memories.map((memory, idx) => {
    const stamp = memory.created_at ? memory.created_at.slice(0, 10) : 'unknown-date';
    return `- [${idx + 1}] (${stamp}) ${truncateWithEllipsis(memory.summary_text.trim(), 420)}`;
  });

  const block = [
    '### Long-Term User Memory',
    'Use this memory only when relevant to the current request.',
    ...lines,
    '### End Memory',
  ].join('\n');

  return truncateWithEllipsis(block, MEMORY_MAX_CONTEXT_CHARS);
}

// ============================================================================
// MEMORY RETRIEVAL
// ============================================================================

export async function fetchRelevantMemories(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  query: string,
): Promise<MemoryRetrievalResult> {
  const { data, error } = await supabase
    .from('user_memories')
    .select('id, user_id, conversation_id, source_window_end_at, summary_text, tags, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MEMORY_MAX_CANDIDATES);

  if (error || !data || data.length === 0) {
    return { contextBlock: '', hits: 0, tokenCount: 0 };
  }

  const memories = data as UserMemoryRecord[];
  const keywords = extractKeywords(query);
  const ranked = memories
    .map((memory, index) => ({
      memory,
      index,
      score: scoreMemory(memory.summary_text, memory.tags, keywords),
    }))
    .sort((a, b) => {
      if (b.score === a.score) return a.index - b.index;
      return b.score - a.score;
    });

  const selected = ranked
    .filter((entry) => entry.score > 0)
    .slice(0, MEMORY_MAX_INJECT)
    .map((entry) => entry.memory);

  if (selected.length === 0) {
    selected.push(memories[0]!);
  }

  const contextBlock = buildMemoryContextBlock(selected);
  return {
    contextBlock,
    hits: selected.length,
    tokenCount: countTokens(contextBlock),
  };
}

// ============================================================================
// CONVERSATION SUMMARIZATION
// ============================================================================

function normalizeSummary(text: string): string {
  const MAX_SUMMARY_CHARS = 1200;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_SUMMARY_CHARS) return normalized;
  return `${normalized.slice(0, MAX_SUMMARY_CHARS - 1)}…`;
}

function extractSummaryFromOpenAI(payload: unknown): string | undefined {
  const data = payload as {
    choices?: Array<{
      message?: { content?: string | Array<{ text?: string; type?: string }> };
    }>;
  };
  const first = data.choices?.[0]?.message?.content;
  if (typeof first === 'string') return first;
  if (Array.isArray(first)) {
    const parts = first
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
  }
  return undefined;
}

function extractSummaryFromAnthropic(payload: unknown): string | undefined {
  const data = payload as { content?: Array<{ type?: string; text?: string }> };
  const parts = (data.content || [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text || '');
  if (parts.length === 0) return undefined;
  return parts.join(' ');
}

function extractSummaryFromGoogle(payload: unknown): string | undefined {
  const data = payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const firstCandidate = data.candidates?.[0];
  if (!firstCandidate) return undefined;
  const parts = (firstCandidate.content?.parts || [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.join(' ');
}

async function summarizeConversationWindow(
  transcript: string,
  signal: AbortSignal,
  apiKeys: { openai: string; anthropic: string; google: string },
): Promise<string | undefined> {
  const prompt = [
    'Summarize key persistent facts about the user from this transcript.',
    'Prioritize: preferences, projects, constraints, deadlines, recurring goals.',
    'Exclude small talk and one-off ephemeral details.',
    'Return plain text in 4-8 bullet points, max 120 words.',
    '',
    transcript,
  ].join('\n');

  if (apiKeys.openai) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeys.openai}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: 'You extract durable user memory for future chat context.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 220,
      }),
      signal,
    });
    if (response.ok) {
      const payload = await response.json();
      const summary = extractSummaryFromOpenAI(payload);
      if (summary) return normalizeSummary(summary);
    }
  }

  if (apiKeys.anthropic) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKeys.anthropic,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_REGISTRY['haiku-4.5'].modelId,
        max_tokens: 220,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal,
    });
    if (response.ok) {
      const payload = await response.json();
      const summary = extractSummaryFromAnthropic(payload);
      if (summary) return normalizeSummary(summary);
    }
  }

  if (apiKeys.google) {
    const resolvedModel = MODEL_REGISTRY['gemini-2.5-flash'].modelId;
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${
        encodeURIComponent(resolvedModel)
      }:generateContent?key=${encodeURIComponent(apiKeys.google)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 220 },
      }),
      signal,
    });
    if (response.ok) {
      const payload = await response.json();
      const summary = extractSummaryFromGoogle(payload);
      if (summary) return normalizeSummary(summary);
    }
  }

  return undefined;
}

export async function maybeSummarizeConversationAsync(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  conversationId: string,
  totalTokens: number,
  apiKeys: { openai: string; anthropic: string; google: string },
): Promise<void> {
  try {
    const { data: stateRaw } = await supabase
      .from('conversation_memory_state')
      .select(
        'conversation_id, user_id, last_summarized_at, last_summarized_message_created_at, last_summarized_total_tokens, updated_at',
      )
      .eq('conversation_id', conversationId)
      .maybeSingle();

    const state = (stateRaw as ConversationMemoryStateRecord | null) || null;
    const lastSummarizedAtMs = state?.last_summarized_at
      ? Date.parse(state.last_summarized_at)
      : 0;
    const lastSummarizedTokens = state?.last_summarized_total_tokens || 0;
    const nowMs = Date.now();
    const dueByTime = !lastSummarizedAtMs ||
      nowMs - lastSummarizedAtMs >= MEMORY_SUMMARY_MIN_INTERVAL_MS;
    const dueByTokenDelta = totalTokens - lastSummarizedTokens >= MEMORY_SUMMARY_MIN_TOKEN_DELTA;

    if (!dueByTime && !dueByTokenDelta) return;

    let query = supabase
      .from('messages')
      .select('id, conversation_id, role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(MEMORY_SUMMARY_MAX_MESSAGES);

    if (state?.last_summarized_message_created_at) {
      query = query.gt('created_at', state.last_summarized_message_created_at);
    }

    const { data: rowsRaw, error: rowsError } = await query;
    if (rowsError || !rowsRaw || rowsRaw.length < 2) return;

    const rows = rowsRaw as ConversationMessageRecord[];
    const transcript = rows
      .map((row) => `${row.role.toUpperCase()}: ${row.content}`)
      .join('\n');

    if (countTokens(transcript) < MEMORY_SUMMARY_MIN_TRANSCRIPT_TOKENS && !dueByTime) return;

    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), 15000);
    let summary: string | undefined;
    try {
      summary = await summarizeConversationWindow(transcript, abortController.signal, apiKeys);
    } finally {
      clearTimeout(timer);
    }
    if (!summary) return;

    const sourceWindowEndAt = rows[rows.length - 1]!.created_at;
    const tags = extractKeywords(summary).slice(0, 8);

    await supabase.from('user_memories').upsert(
      {
        user_id: userId,
        conversation_id: conversationId,
        source_window_end_at: sourceWindowEndAt,
        summary_text: summary,
        tags,
      } as never,
      { onConflict: 'conversation_id,source_window_end_at' },
    );

    const nowIso = new Date().toISOString();
    await supabase.from('conversation_memory_state').upsert(
      {
        conversation_id: conversationId,
        user_id: userId,
        last_summarized_at: nowIso,
        last_summarized_message_created_at: sourceWindowEndAt,
        last_summarized_total_tokens: totalTokens,
        updated_at: nowIso,
      } as never,
      { onConflict: 'conversation_id' },
    );
  } catch (error) {
    console.warn('[Memory] summarize skipped:', error);
  }
}
