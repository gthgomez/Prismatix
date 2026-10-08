import { describe, expect, it } from 'vitest';
import {
  deleteConversation,
  listConversations,
  loadConversation,
  selectContextHistory,
  signAttachment,
  DEFAULT_CONTEXT_LIMITS,
} from './conversationService';
import type { AttachmentRef } from '../../supabase/functions/_shared/conversation_attachments';

const SUBJECT = '11111111-1111-4111-8111-111111111111';
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
  order(column: string): this {
    this.calls.push(`order:${column}`);
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
    expect(calls).toContain('order:last_activity_at');
    expect(calls).toContain('order:id');
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
  it('maps persisted attachments and adapts a legacy image_url', async () => {
    const fake = makeClient({
      messages: [
        {
          data: [
            {
              id: MSG,
              role: 'user',
              content: 'hello',
              created_at: '2026-10-01T00:00:00Z',
              attachments: [imageRef('supabase://chat-uploads/u/a.png', 2)],
              image_url: 'supabase://chat-uploads/u/a.png',
            },
            {
              id: '44444444-4444-4444-8444-444444444444',
              role: 'assistant',
              content: 'hi',
              created_at: '2026-10-01T00:00:01Z',
              attachments: [],
              image_url: 'supabase://chat-uploads/u/legacy.png',
            },
          ],
          error: null,
        },
      ],
    });

    const messages = await loadConversation(fake.client as never, CONV, { limit: 50 });

    expect(messages).toHaveLength(2);
    // normalizeAttachments resets ordinals to the array position (order kept).
    expect(messages[0]!.attachments).toEqual([imageRef('supabase://chat-uploads/u/a.png', 0)]);
    // A legacy image_url is adapted into an ordinal-0 attachment entry.
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
    expect(calls).toContain('order:created_at');
    expect(calls).toContain('order:id');
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
        // sole: no other message references it → remove. shared: still referenced → keep.
        // Order of the reference probes follows the collected ref order.
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
