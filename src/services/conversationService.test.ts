import { describe, expect, it } from 'vitest';
import {
  deleteConversation,
  listConversations,
  loadConversation,
  parseModelUsed,
  selectContextHistory,
  signAttachment,
  DEFAULT_CONTEXT_LIMITS,
} from './conversationService';
import type { AttachmentRef } from '../../supabase/functions/_shared/conversation_attachments';

const CONV = '22222222-2222-4222-8222-222222222222';
const MSG = '33333333-3333-4333-8333-333333333333';

interface QResult {
  data: unknown;
  error: unknown;
}

class FakeQuery {
  calls: string[] = [];
  constructor(private result: QResult) {}
  select(columns?: string): this {
    this.calls.push(`select:${columns ?? ''}`);
    return this;
  }
  eq(column: string, value: unknown): this {
    this.calls.push(`eq:${column}=${String(value)}`);
    return this;
  }
  order(column: string, options?: { ascending?: boolean }): this {
    this.calls.push(`order:${column}${options?.ascending === false ? ':desc' : options?.ascending === true ? ':asc' : ''}`);
    return this;
  }
  limit(n: number): this {
    this.calls.push(`limit:${n}`);
    return this;
  }
  or(filter: string): this {
    this.calls.push(`or:${filter}`);
    return this;
  }
  contains(column: string, value: unknown): this {
    this.calls.push(`contains:${column}=${JSON.stringify(value)}`);
    return this;
  }
  delete(): this {
    this.calls.push('delete');
    return this;
  }
  maybeSingle(): Promise<QResult> {
    return Promise.resolve(this.result);
  }
  then<T1, T2>(
    onfulfilled?: ((value: QResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

interface FakeClient {
  client: unknown;
  queries: Record<string, FakeQuery[]>;
  signedUrls: Array<{ bucket: string; path: string; expires: number }>;
  removed: Array<{ bucket: string; paths: string[] }>;
}

function makeClient(fromResults: Record<string, QResult[]> = {}): FakeClient {
  const queues: Record<string, QResult[]> = {};
  for (const [table, results] of Object.entries(fromResults)) {
    queues[table] = [...results];
  }
  const queries: Record<string, FakeQuery[]> = {};
  const signedUrls: FakeClient['signedUrls'] = [];
  const removed: FakeClient['removed'] = [];

  const client = {
    from(table: string) {
      const result = queues[table]?.shift() ?? { data: null, error: null };
      const q = new FakeQuery(result);
      (queries[table] ??= []).push(q);
      return q;
    },
    storage: {
      from(bucket: string) {
        return {
          createSignedUrl(path: string, expires: number) {
            signedUrls.push({ bucket, path, expires });
            return Promise.resolve({
              data: { signedUrl: `https://signed.example/${bucket}/${path}?t=${expires}` },
              error: null,
            });
          },
          remove(paths: string[]) {
            removed.push({ bucket, paths });
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    },
  };

  return { client, queries, signedUrls, removed };
}

function imageRef(storageRef: string, ordinal = 0): AttachmentRef {
  return { ordinal, kind: 'image', storageRef, videoAssetId: null, available: true };
}

describe('listConversations', () => {
  it('maps rows and orders by last activity then id descending', async () => {
    const fake = makeClient({
      conversations: [
        {
          data: [
            { id: CONV, title: 'First', last_activity_at: '2026-10-01T00:00:00Z' },
            { id: MSG, title: null, last_activity_at: '2026-09-01T00:00:00Z' },
          ],
          error: null,
        },
      ],
    });

    const result = await listConversations(fake.client as never, { limit: 20 });

    expect(result).toEqual([
      { id: CONV, title: 'First', lastActivityAt: '2026-10-01T00:00:00Z' },
      { id: MSG, title: null, lastActivityAt: '2026-09-01T00:00:00Z' },
    ]);
    const calls = fake.queries.conversations![0]!.calls;
    expect(calls).toContain('order:last_activity_at:desc');
    expect(calls).toContain('order:id:desc');
    expect(calls).toContain('limit:20');
  });

  it('applies the (last_activity_at, id) cursor when `before` is supplied', async () => {
    const fake = makeClient({ conversations: [{ data: [], error: null }] });

    await listConversations(fake.client as never, {
      limit: 10,
      before: { lastActivityAt: '2026-10-01T00:00:00Z', id: CONV },
    });

    const calls = fake.queries.conversations![0]!.calls;
    const orCall = calls.find((c) => c.startsWith('or:'));
    expect(orCall).toBeDefined();
    expect(orCall).toContain('last_activity_at.lt.2026-10-01T00:00:00Z');
    expect(orCall).toContain(`and(last_activity_at.eq.2026-10-01T00:00:00Z,id.lt.${CONV})`);
  });

  it('throws when the query errors', async () => {
    const fake = makeClient({ conversations: [{ data: null, error: { message: 'boom' } }] });
    await expect(listConversations(fake.client as never, {})).rejects.toThrow('list_conversations_failed');
  });
});

describe('loadConversation', () => {
  it('queries newest-first, reverses to chronological order, maps persisted attachments and adapts a legacy image_url', async () => {
    // Database returns the newest rows first (created_at descending)
    const fake = makeClient({
      messages: [
        {
          data: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              role: 'assistant',
              content: 'hi',
              created_at: '2026-10-01T00:00:01Z',
              attachments: [],
              image_url: 'supabase://chat-uploads/u/legacy.png',
            },
            {
              id: MSG,
              role: 'user',
              content: 'hello',
              created_at: '2026-10-01T00:00:00Z',
              attachments: [imageRef('supabase://chat-uploads/u/a.png', 2)],
              image_url: 'supabase://chat-uploads/u/a.png',
            },
          ],
          error: null,
        },
      ],
    });

    const messages = await loadConversation(fake.client as never, CONV, { limit: 50 });

    expect(messages).toHaveLength(2);
    // Returned in chronological order (oldest user message first, then assistant response)
    expect(messages[0]!.id).toBe(MSG);
    expect(messages[0]!.role).toBe('user');
    expect(messages[0]!.content).toBe('hello');
    expect(messages[0]!.attachments).toEqual([imageRef('supabase://chat-uploads/u/a.png', 0)]);

    expect(messages[1]!.id).toBe('44444444-4444-4444-8444-444444444444');
    expect(messages[1]!.role).toBe('assistant');
    expect(messages[1]!.content).toBe('hi');
    expect(messages[1]!.attachments).toEqual([
      {
        ordinal: 0,
        kind: 'image',
        storageRef: 'supabase://chat-uploads/u/legacy.png',
        videoAssetId: null,
        available: true,
      },
    ]);
    const calls = fake.queries.messages![0]!.calls;
    expect(calls).toContain('order:created_at:desc');
    expect(calls).toContain('order:id:desc');
  });

  it('maps file (text/code) attachments as metadata with no signed URL', async () => {
    const fake = makeClient({
      messages: [
        {
          data: [
            {
              id: MSG,
              role: 'user',
              content: 'process this',
              created_at: '2026-10-01T00:00:00Z',
              attachments: [{ ordinal: 0, kind: 'file', name: 'notes.md', size: 9 }],
              image_url: null,
            },
          ],
          error: null,
        },
      ],
    });

    const messages = await loadConversation(fake.client as never, CONV, { limit: 50 });

    expect(messages[0]!.attachments).toEqual([
      {
        ordinal: 0,
        kind: 'file',
        storageRef: null,
        videoAssetId: null,
        available: true,
        name: 'notes.md',
        size: 9,
      },
    ]);
    // A file attachment never triggers a storage signed URL.
    expect(fake.signedUrls).toEqual([]);
  });

  it('applies a (created_at, id) cursor and limit', async () => {
    const fake = makeClient({ messages: [{ data: [], error: null }] });

    await loadConversation(fake.client as never, CONV, {
      limit: 25,
      before: { createdAt: '2026-10-01T00:00:00Z', id: MSG },
    });

    const calls = fake.queries.messages![0]!.calls;
    expect(calls).toContain('limit:25');
    const orCall = calls.find((c) => c.startsWith('or:'));
    expect(orCall).toContain(`and(created_at.eq.2026-10-01T00:00:00Z,id.lt.${MSG})`);
  });

  it('loads the newest messages chronologically when conversation has more messages than the limit', async () => {
    // 60 messages: msg 1 (oldest) to msg 60 (newest).
    // Database ordered DESC returns top 50 rows (msg 60 down to msg 11).
    const top50Rows = Array.from({ length: 50 }, (_, i) => {
      const num = 60 - i; // 60, 59, ..., 11
      return {
        id: `msg-${num}`,
        role: num % 2 === 0 ? 'assistant' : 'user',
        content: `content-${num}`,
        created_at: `2026-10-01T${String(Math.floor(num / 60)).padStart(2, '0')}:${String(num % 60).padStart(2, '0')}:00Z`,
        attachments: [],
        image_url: null,
      };
    });

    const fake = makeClient({ messages: [{ data: top50Rows, error: null }] });
    const messages = await loadConversation(fake.client as never, CONV, { limit: 50 });

    expect(messages).toHaveLength(50);
    // Chronological order: msg-11 is first, msg-60 is last
    expect(messages[0]!.id).toBe('msg-11');
    expect(messages[messages.length - 1]!.id).toBe('msg-60');
  });

  it('rehydrates provenance and cost by joining messages with cost_logs on execution_id', async () => {
    const EXEC_ID = '99999999-9999-4999-8999-999999999999';
    const fake = makeClient({
      messages: [
        {
          data: [
            {
              id: MSG,
              role: 'assistant',
              content: 'Here is your analysis',
              created_at: '2026-10-01T00:01:00Z',
              attachments: [],
              image_url: null,
              model_used: 'google:gemini-3.8-flash',
              token_count: 120,
              execution_id: EXEC_ID,
            },
          ],
          error: null,
        },
      ],
      cost_logs: [
        {
          data: [
            {
              idempotency_key: EXEC_ID,
              total_cost: 0.00015,
              pricing_version: '2026-10-07-v9',
              route_rationale: 'code_detected',
              complexity_score: 80,
              provider: 'google',
              model: 'gemini-3.8-flash',
            },
          ],
          error: null,
        },
      ],
    });

    const messages = await loadConversation(fake.client as never, CONV);
    expect(messages).toHaveLength(1);
    const msg = messages[0]!;
    expect(msg.modelUsed).toBe('google:gemini-3.8-flash');
    expect(msg.executionId).toBe(EXEC_ID);
    expect(msg.provenance).toBeDefined();
    expect(msg.provenance?.model).toBe('gemini-3.8-flash');
    expect(msg.provenance?.provider).toBe('google');
    expect(msg.provenance?.routeRationale).toBe('code_detected');
    expect(msg.provenance?.complexityScore).toBe(80);
    expect(msg.provenance?.cost).toEqual({
      totalUsd: 0.00015,
      pricingVersion: '2026-10-07-v9',
    });
  });

  it('degrades gracefully to model_used when cost_logs returns null or empty', async () => {
    const fake = makeClient({
      messages: [
        {
          data: [
            {
              id: MSG,
              role: 'assistant',
              content: 'Quick answer',
              created_at: '2026-10-01T00:01:00Z',
              attachments: [],
              image_url: null,
              model_used: 'opencode:deepseek-v4-flash',
              token_count: 50,
              execution_id: null,
            },
          ],
          error: null,
        },
      ],
      cost_logs: [
        {
          data: [],
          error: null,
        },
      ],
    });

    const messages = await loadConversation(fake.client as never, CONV);
    expect(messages).toHaveLength(1);
    const msg = messages[0]!;
    expect(msg.provenance).toBeDefined();
    expect(msg.provenance?.model).toBe('deepseek-v4-flash');
    expect(msg.provenance?.provider).toBe('opencode');
    expect(msg.provenance?.cost).toBeUndefined();
  });
});

describe('parseModelUsed', () => {
  it('parses provider:modelId format correctly', () => {
    expect(parseModelUsed('google:gemini-3.8-flash')).toEqual({
      provider: 'google',
      model: 'gemini-3.8-flash',
      modelId: 'gemini-3.8-flash',
    });
    expect(parseModelUsed('opencode:deepseek-v4-flash')).toEqual({
      provider: 'opencode',
      model: 'deepseek-v4-flash',
      modelId: 'deepseek-v4-flash',
    });
  });

  it('parses raw model identifier with known model fallback', () => {
    expect(parseModelUsed('gemini-3.8-flash')).toEqual({
      provider: undefined,
      model: 'gemini-3.8-flash',
      modelId: 'gemini-3.8-flash',
    });
  });

  it('handles null, undefined, or empty strings gracefully', () => {
    expect(parseModelUsed(null)).toEqual({});
    expect(parseModelUsed(undefined)).toEqual({});
    expect(parseModelUsed('')).toEqual({});
  });
});

describe('signAttachment', () => {
  it('signs an image ref parsed from its supabase:// bucket/path', async () => {
    const fake = makeClient();
    const url = await signAttachment(fake.client as never, imageRef('supabase://chat-uploads/u/a.png'));

    expect(url).toBe('https://signed.example/chat-uploads/u/a.png?t=60');
    expect(fake.signedUrls).toEqual([{ bucket: 'chat-uploads', path: 'u/a.png', expires: 60 }]);
  });

  it('never signs a video ref or an unparseable reference', async () => {
    const fake = makeClient();
    expect(
      await signAttachment(fake.client as never, {
        ordinal: 0,
        kind: 'video',
        storageRef: null,
        videoAssetId: 'video-1',
        available: true,
      }),
    ).toBeNull();
    expect(await signAttachment(fake.client as never, imageRef('bare/path.png'))).toBeNull();
    expect(fake.signedUrls).toEqual([]);
  });
});

describe('deleteConversation', () => {
  it('deletes the conversation rows and removes objects referenced solely by it', async () => {
    const sole = 'supabase://chat-uploads/u/sole.png';
    const shared = 'supabase://chat-uploads/u/shared.png';
    const fake = makeClient({
      messages: [
        { data: [{ attachments: [imageRef(sole), imageRef(shared, 1)], image_url: null }], error: null },
        // sole: no attachments reference, no legacy image_url → remove.
        { data: [], error: null },
        { data: [], error: null },
        // shared: no attachments reference, but another row's legacy image_url
        // still points at it → keep.
        { data: [], error: null },
        { data: [{ id: 'other' }], error: null },
      ],
      conversations: [{ data: null, error: null }],
    });

    await deleteConversation(fake.client as never, CONV);

    const convCalls = fake.queries.conversations![0]!.calls;
    expect(convCalls).toContain('delete');
    expect(fake.removed).toEqual([{ bucket: 'chat-uploads', paths: ['u/sole.png'] }]);
  });

  it('throws and removes nothing when the conversation delete fails', async () => {
    const fake = makeClient({
      messages: [{ data: [{ attachments: [imageRef('supabase://chat-uploads/u/a.png')], image_url: null }], error: null }],
      conversations: [{ data: null, error: { message: 'nope' } }],
    });

    await expect(deleteConversation(fake.client as never, CONV)).rejects.toThrow(
      'delete_conversation_failed',
    );
    expect(fake.removed).toEqual([]);
  });
});

describe('selectContextHistory', () => {
  const msg = (role: 'user' | 'assistant', content: string) => ({ role, content });

  it('keeps the most recent messages within the 24-message window', () => {
    const messages = Array.from({ length: 40 }, (_, i) => msg('user', `m${i}`));
    const selection = selectContextHistory(messages, DEFAULT_CONTEXT_LIMITS);

    expect(selection.history).toHaveLength(24);
    expect(selection.history[0]!.content).toBe('m16');
    expect(selection.history[23]!.content).toBe('m39');
    expect(selection.excludedCount).toBe(16);
  });

  it('excludes an individually oversized message and still counts it', () => {
    const huge = 'x'.repeat(DEFAULT_CONTEXT_LIMITS.maxHistoryMessageChars + 1);
    const selection = selectContextHistory(
      [msg('user', 'old'), msg('assistant', huge), msg('user', 'new')],
      DEFAULT_CONTEXT_LIMITS,
    );

    expect(selection.history.map((m) => m.content)).toEqual(['old', 'new']);
    expect(selection.excludedCount).toBe(1);
  });

  it('stops once the total character budget would be exceeded', () => {
    const selection = selectContextHistory(
      [msg('user', 'a'.repeat(5000)), msg('assistant', 'b'.repeat(5000))],
      { ...DEFAULT_CONTEXT_LIMITS, maxHistoryTotalChars: 8000 },
    );

    // Newest message fits; adding the older one would exceed the budget.
    expect(selection.history).toEqual([msg('assistant', 'b'.repeat(5000))]);
    expect(selection.excludedCount).toBe(1);
  });
});
