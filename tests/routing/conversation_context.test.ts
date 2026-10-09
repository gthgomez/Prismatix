// PX07 bounded context selector.
//
// `selectContextHistory` must send at most the router's history window to the
// model: the most recent eligible messages within maxHistoryMessages (24) and
// the per-message / total character limits, with older messages excluded.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTEXT_LIMITS,
  selectContextHistory,
} from '../../src/services/conversationService.ts';
import { REQUEST_LIMITS } from '../../supabase/functions/router/security_guards.ts';

const msg = (role: 'user' | 'assistant', content: string) => ({ role, content });

describe('context limits mirror the router', () => {
  it('aligns the client window with REQUEST_LIMITS (24 / 12k / 80k)', () => {
    expect(DEFAULT_CONTEXT_LIMITS.maxHistoryMessages).toBe(REQUEST_LIMITS.maxHistoryMessages);
    expect(DEFAULT_CONTEXT_LIMITS.maxHistoryMessageChars).toBe(
      REQUEST_LIMITS.maxHistoryMessageChars,
    );
    expect(DEFAULT_CONTEXT_LIMITS.maxHistoryTotalChars).toBe(REQUEST_LIMITS.maxHistoryTotalChars);
  });
});

describe('selectContextHistory', () => {
  it('never sends more than 24 messages', () => {
    const selection = selectContextHistory(
      Array.from({ length: 100 }, (_, i) => msg('user', `m${i}`)),
    );
    expect(selection.history.length).toBeLessThanOrEqual(REQUEST_LIMITS.maxHistoryMessages);
    expect(selection.history.length).toBe(24);
    // The window is the newest 24 in chronological order.
    expect(selection.history[0]!.content).toBe('m76');
    expect(selection.history[23]!.content).toBe('m99');
  });

  it('keeps every included message within the per-message char limit', () => {
    const oversized = 'x'.repeat(REQUEST_LIMITS.maxHistoryMessageChars + 1);
    const selection = selectContextHistory([msg('user', oversized), msg('assistant', 'ok')]);
    expect(selection.history).toEqual([msg('assistant', 'ok')]);
    expect(selection.excludedCount).toBe(1);
  });

  it('reports the excluded count so the UI can show the out-of-context indicator', () => {
    const selection = selectContextHistory(
      Array.from({ length: 30 }, (_, i) => msg('user', `m${i}`)),
    );
    expect(selection.excludedCount).toBe(6);
  });

  it('returns nothing (and no false indicator) for an empty conversation', () => {
    expect(selectContextHistory([])).toEqual({ history: [], excludedCount: 0 });
  });
});
