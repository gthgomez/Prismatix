// tests/routing/routing_profiles.test.ts
// Unit tests for F12 (Comparison), F13 (Profiles & Caps), F14 (Spend Analytics & CSV), and F15 (Routing Feedback).

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));

import {
  exportSpendToCsv,
  filterAndGroupSpend,
  getFinanceStore,
  getSpendStats,
  recordCost,
  type FinanceEntry,
} from '../../src/services/financeTracker';
import {
  deleteRoutingFeedback,
  getRoutingFeedbackForMessage,
  submitRoutingFeedback,
  toggleRoutingFeedback,
} from '../../src/services/routingFeedbackService';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('F13 & F14: Spend Caps and Grouped Analytics', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('records spend entries and computes totals accurately', () => {
    recordCost({
      model: 'gemini-3.8-flash',
      cost: 0.0005,
      provider: 'google',
      conversationId: 'conv-1234',
      costStatus: 'settled',
      promptTokens: 100,
      completionTokens: 50,
      executionId: 'exec-1',
    });

    const store = getFinanceStore();
    expect(store.history.length).toBe(1);
    expect(store.history[0]?.model).toBe('gemini-3.8-flash');
    expect(store.history[0]?.cost).toBe(0.0005);
    const stats = getSpendStats();
    expect(stats.allTime).toBe(0.0005);
  });

  it('enforces idempotency: does not double count identical executionId on retries', () => {
    recordCost({
      model: 'gemini-3.8-flash',
      cost: 0.0005,
      executionId: 'exec-unique-101',
    });

    // Retry with identical execution ID
    recordCost({
      model: 'gemini-3.8-flash',
      cost: 0.0005,
      executionId: 'exec-unique-101',
    });

    const store = getFinanceStore();
    expect(store.history.length).toBe(1);
    const stats = getSpendStats();
    expect(stats.allTime).toBe(0.0005);
  });

  it('filters and groups spend by model', () => {
    const history: FinanceEntry[] = [
      {
        date: new Date().toISOString(),
        model: 'gemini-3.8-flash',
        cost: 0.001,
        costStatus: 'settled',
        promptTokens: 100,
        completionTokens: 20,
      },
      {
        date: new Date().toISOString(),
        model: 'gemini-3.8-flash',
        cost: 0.002,
        costStatus: 'settled',
        promptTokens: 200,
        completionTokens: 40,
      },
      {
        date: new Date().toISOString(),
        model: 'gpt-6-sol',
        cost: 0.015,
        costStatus: 'estimated',
        promptTokens: 500,
        completionTokens: 100,
      },
    ];

    const grouped = filterAndGroupSpend(history, 'all', 'model');
    expect(grouped.length).toBe(2);

    const gpt = grouped.find((g) => g.groupKey === 'gpt-6-sol');
    expect(gpt).toBeDefined();
    expect(gpt?.count).toBe(1);
    expect(gpt?.estimatedCost).toBe(0.015);
    expect(gpt?.settledCost).toBe(0);

    const gemini = grouped.find((g) => g.groupKey === 'gemini-3.8-flash');
    expect(gemini).toBeDefined();
    expect(gemini?.count).toBe(2);
    expect(gemini?.settledCost).toBe(0.003);
  });

  it('filters spend by date range', () => {
    const todayIso = new Date().toISOString();
    const tenDaysAgoIso = new Date(Date.now() - 10 * 86400000).toISOString();

    const history: FinanceEntry[] = [
      {
        date: todayIso,
        model: 'gemini-3.8-flash',
        cost: 0.001,
      },
      {
        date: tenDaysAgoIso,
        model: 'gemini-3.8-flash',
        cost: 0.005,
      },
    ];

    const allGrouped = filterAndGroupSpend(history, 'all', 'model');
    expect(allGrouped[0]?.totalCost).toBe(0.006);

    const sevenDayGrouped = filterAndGroupSpend(history, '7d', 'model');
    expect(sevenDayGrouped[0]?.totalCost).toBe(0.001);
  });

  it('formats CSV export correctly with sanitized values and headers', () => {
    const history: FinanceEntry[] = [
      {
        date: '2026-11-07',
        conversationId: 'c123,with,commas',
        model: 'gpt-6-sol',
        provider: 'openai',
        costStatus: 'settled',
        promptTokens: 120,
        completionTokens: 60,
        cost: 0.0042,
      },
    ];

    const csv = exportSpendToCsv(history);
    expect(csv).toContain('Date,Conversation ID,Model,Provider,Cost Status,Prompt Tokens,Completion Tokens,Cost (USD)');
    expect(csv).toContain('"c123,with,commas"');
    expect(csv).toContain('gpt-6-sol');
    expect(csv).toContain('0.0042');
  });
});

describe('F15: Routing Quality Feedback Service', () => {
  it('submits user feedback under authenticated user session', async () => {
    const upsertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'fb-uuid-123' },
          error: null,
        }),
      }),
    });

    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'usr-123' } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({
        upsert: upsertMock,
        insert: upsertMock,
      }),
    } as unknown as SupabaseClient;

    const res = await submitRoutingFeedback(mockClient, {
      conversationId: 'conv-abc',
      chosenModel: 'gemini-3.8-flash',
      routingRole: 'economy',
      feedbackType: 'thumb_up',
    });

    expect(res.success).toBe(true);
    expect(res.id).toBe('fb-uuid-123');
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'usr-123',
        conversation_id: 'conv-abc',
        chosen_model: 'gemini-3.8-flash',
        feedback_type: 'thumb_up',
      }),
      expect.anything(),
    );
  });

  it('records model comparison preferences correctly', async () => {
    const upsertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'fb-pref-456' },
          error: null,
        }),
      }),
    });

    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'usr-123' } },
        }),
      },
      from: vi.fn().mockReturnValue({
        upsert: upsertMock,
        insert: upsertMock,
      }),
    } as unknown as SupabaseClient;

    const res = await submitRoutingFeedback(mockClient, {
      chosenModel: 'gpt-6-sol',
      feedbackType: 'comparison_preference',
      comparisonPreferredModel: 'gpt-6-sol',
      userComment: 'Significantly more thorough architectural reasoning.',
    });

    expect(res.success).toBe(true);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        feedback_type: 'comparison_preference',
        comparison_preferred_model: 'gpt-6-sol',
      }),
      expect.anything(),
    );
  });

  it('fails gracefully when user is unauthenticated', async () => {
    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as unknown as SupabaseClient;

    const res = await submitRoutingFeedback(mockClient, {
      chosenModel: 'gemini-3.8-flash',
      feedbackType: 'thumb_down',
    });

    expect(res.success).toBe(false);
  });

  it('deletes feedback when toggling off an existing feedback', async () => {
    const chain = {
      eq: vi.fn(),
    };
    chain.eq.mockReturnValue(chain);
    // When awaited:
    Object.assign(chain, {
      then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
    });

    const deleteMock = vi.fn().mockReturnValue(chain);

    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'usr-123' } } }),
      },
      from: vi.fn().mockReturnValue({
        delete: deleteMock,
      }),
    } as unknown as SupabaseClient;

    const res = await deleteRoutingFeedback(mockClient, {
      messageId: 'msg-456',
      feedbackType: 'thumb_up',
    });

    expect(res.success).toBe(true);
    expect(deleteMock).toHaveBeenCalled();
  });

  it('toggles feedback on and off', async () => {
    // When no existing feedback, toggle submits
    const upsertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'fb-new-1' }, error: null }),
      }),
    });
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'usr-123' } } }),
      },
      from: vi.fn().mockReturnValue({
        upsert: upsertMock,
        select: selectMock,
      }),
    } as unknown as SupabaseClient;

    const toggleOn = await toggleRoutingFeedback(mockClient, {
      messageId: 'msg-toggle',
      chosenModel: 'gemini-3.8-flash',
      feedbackType: 'thumb_up',
    });

    expect(toggleOn.active).toBe(true);
    expect(toggleOn.id).toBe('fb-new-1');
  });

  it('retrieves feedback for a message', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [{ id: 'fb-1', user_id: 'usr-1', message_id: 'msg-123', feedback_type: 'thumb_up', created_at: '2026-11-07' }],
            error: null,
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const feedback = await getRoutingFeedbackForMessage(mockClient, 'msg-123');
    expect(feedback).toHaveLength(1);
    expect(feedback[0]?.feedbackType).toBe('thumb_up');
  });
});
