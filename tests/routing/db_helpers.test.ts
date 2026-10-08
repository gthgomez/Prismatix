import { describe, expect, it } from 'vitest';
import {
  persistCostLog,
  persistExecutionMessage,
  validateConversation,
  type CostLogRecord,
} from '../../supabase/functions/router/db_helpers.ts';

// ============================================================================
// MOCK SUPABASE CLIENT
// ============================================================================

interface MockError {
  code: string;
  message: string;
}

interface MockResult<T> {
  data: T | null;
  error: MockError | null;
}

interface UpsertOptions {
  ignoreDuplicates?: boolean;
  onConflict?: string;
}

/**
 * Minimal query-builder mock that records calls and returns configured
 * responses. Supports the chain shapes used by db_helpers:
 *   .from(table).select(cols).eq(col, val).maybeSingle()
 *   .from(table).insert(values)
 *   .from(table).upsert(values, options)
 */
class MockQueryBuilder {
  calls: Array<{ method: string; args: unknown[] }> = [];
  private result: MockResult<unknown>;
  private upsertOptions: UpsertOptions | undefined;

  constructor(result: MockResult<unknown>) {
    this.result = result;
  }

  select(_columns?: string) {
    this.calls.push({ method: 'select', args: [_columns] });
    return this;
  }

  eq(_column: string, _value: unknown) {
    this.calls.push({ method: 'eq', args: [_column, _value] });
    return this;
  }

  maybeSingle() {
    this.calls.push({ method: 'maybeSingle', args: [] });
    return Promise.resolve(this.result);
  }

  insert(_values: unknown) {
    this.calls.push({ method: 'insert', args: [_values] });
    return Promise.resolve(this.result);
  }

  upsert(_values: unknown, options?: UpsertOptions) {
    this.calls.push({ method: 'upsert', args: [_values, options] });
    this.upsertOptions = options;
    return Promise.resolve(this.result);
  }
}

interface MockSupabaseConfig {
  /** Result for the first .from() call (e.g. conversations select). */
  fromResult?: MockResult<unknown>;
  /** Result for .from('conversations').insert() when conversation not found. */
  insertResult?: MockResult<unknown>;
  /** Result for the retry select after a failed insert. */
  retryResult?: MockResult<unknown>;
  /** Result for .from('cost_logs').upsert(). */
  upsertResult?: MockResult<unknown>;
  /** Result for .from('messages').insert(). */
  messageInsertResult?: MockResult<unknown>;
  /** Result for .rpc('increment_token_count_for_user'). */
  rpcResult?: MockResult<unknown>;
  /** If true, .from() throws to simulate a connection-level failure. */
  throwOnFrom?: boolean;
}

function createMockClient(config: MockSupabaseConfig = {}) {
  const fromCalls: MockQueryBuilder[] = [];
  const rpcCalls: Array<{ fn: string; args: unknown[] }> = [];
  // Queue of results for successive from('conversations') calls, in call
  // order: select → insert → retry-select. This lets tests model the
  // not-found → insert-fail → retry-fail path.
  const conversationsQueue: MockResult<unknown>[] = [];
  if (config.fromResult) conversationsQueue.push(config.fromResult);
  if (config.insertResult) conversationsQueue.push(config.insertResult);
  if (config.retryResult) conversationsQueue.push(config.retryResult);
  if (conversationsQueue.length === 0) {
    conversationsQueue.push({ data: null, error: null });
  }

  const client = {
    from(table: string) {
      if (config.throwOnFrom) {
        throw new Error('Connection lost');
      }
      let result: MockResult<unknown>;
      if (table === 'cost_logs') {
        result = config.upsertResult ?? { data: null, error: null };
      } else if (table === 'messages') {
        result = config.messageInsertResult ?? { data: null, error: null };
      } else if (table === 'conversations') {
        result = conversationsQueue.shift() ?? { data: null, error: null };
      } else {
        result = { data: null, error: null };
      }
      const qb = new MockQueryBuilder(result);
      fromCalls.push(qb);
      return qb;
    },
    rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args: [args] });
      const result = config.rpcResult ?? { data: null, error: null };
      return Promise.resolve(result);
    },
  };

  return { client, fromCalls, rpcCalls };
}

// ============================================================================
// HELPERS
// ============================================================================

function makeCostLogRecord(overrides: Partial<CostLogRecord> = {}): CostLogRecord {
  return {
    user_id: '11111111-1111-4111-8111-111111111111',
    conversation_id: '22222222-2222-4222-8222-222222222222',
    model: 'gpt-5.6-sol',
    provider: 'openai',
    input_tokens: 1000,
    output_tokens: 200,
    thinking_tokens: 0,
    input_cost: 0.0005,
    output_cost: 0.003,
    thinking_cost: 0,
    total_cost: 0.0035,
    pricing_version: '2026-08-16',
    complexity_score: 42,
    route_rationale: 'test',
    ...overrides,
  };
}

const VALID_USER = '11111111-1111-4111-8111-111111111111';
const VALID_CONVERSATION = '22222222-2222-4222-8222-222222222222';
const OTHER_USER = '99999999-9999-4999-8999-999999999999';

// ============================================================================
// persistCostLog — server-written compatibility projection (PX03/F07)
// ============================================================================

describe('persistCostLog idempotency', () => {
  it('uses upsert with ignoreDuplicates and onConflict on idempotency_key', async () => {
    const { client, fromCalls } = createMockClient({
      upsertResult: { data: { id: 'abc' }, error: null },
    });

    const record = makeCostLogRecord({ idempotency_key: 'exec-123' });
    await persistCostLog(client as never, record);

    expect(fromCalls.length).toBe(1);
    const qb = fromCalls[0]!;
    const upsertCall = qb.calls.find((c) => c.method === 'upsert');
    expect(upsertCall).toBeDefined();
    const [values, options] = upsertCall!.args as [Record<string, unknown>, UpsertOptions];
    expect(options.ignoreDuplicates).toBe(true);
    expect(options.onConflict).toBe('idempotency_key');
    // The authoritative identity is the caller-supplied execution/call ID.
    expect(values.idempotency_key).toBe('exec-123');
  });

  it('does NOT replace a caller-supplied idempotency_key (no content hashing)', async () => {
    const { client, fromCalls } = createMockClient({
      upsertResult: { data: { id: 'abc' }, error: null },
    });

    const record = makeCostLogRecord({ idempotency_key: 'execution:abc:baseline:primary:1' });
    await persistCostLog(client as never, record);

    const upsertCall = fromCalls[0]!.calls.find((c) => c.method === 'upsert');
    const [values] = upsertCall!.args as [Record<string, unknown>];
    expect(values.idempotency_key).toBe('execution:abc:baseline:primary:1');
  });

  it('preserves a null idempotency_key rather than fabricating one', async () => {
    const { client, fromCalls } = createMockClient({
      upsertResult: { data: { id: 'abc' }, error: null },
    });

    const record = makeCostLogRecord();
    delete record.idempotency_key;
    await persistCostLog(client as never, record);

    const upsertCall = fromCalls[0]!.calls.find((c) => c.method === 'upsert');
    const [values] = upsertCall!.args as [Record<string, unknown>];
    expect(values.idempotency_key).toBeUndefined();
  });

  it('passes cost_status provenance through unchanged', async () => {
    const { client, fromCalls } = createMockClient({
      upsertResult: { data: { id: 'abc' }, error: null },
    });

    const record = makeCostLogRecord({ cost_status: 'pending' });
    await persistCostLog(client as never, record);

    const upsertCall = fromCalls[0]!.calls.find((c) => c.method === 'upsert');
    const [values] = upsertCall!.args as [Record<string, unknown>];
    expect(values.cost_status).toBe('pending');
  });
});

// ============================================================================
// persistCostLog — error handling
// ============================================================================

describe('persistCostLog error handling', () => {
  it('re-throws on database error (connection lost)', async () => {
    const { client } = createMockClient({
      upsertResult: {
        data: null,
        error: { code: '08006', message: 'Connection lost' },
      },
    });

    await expect(
      persistCostLog(client as never, makeCostLogRecord()),
    ).rejects.toThrow('Cost log persist failed');
  });

  it('re-throws on constraint violation', async () => {
    const { client } = createMockClient({
      upsertResult: {
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      },
    });

    await expect(
      persistCostLog(client as never, makeCostLogRecord()),
    ).rejects.toThrow('Cost log persist failed');
  });

  it('re-throws when the client throws (network failure)', async () => {
    const { client } = createMockClient({ throwOnFrom: true });

    await expect(
      persistCostLog(client as never, makeCostLogRecord()),
    ).rejects.toThrow('Connection lost');
  });
});

// ============================================================================
// persistExecutionMessage — awaited, idempotent PX07 persistence via the
// service-role-only px07_persist_message RPC
// ============================================================================

describe('persistExecutionMessage', () => {
  const EXECUTION_ID = '33333333-3333-4333-8333-333333333333';

  function baseInput() {
    return {
      subjectId: VALID_USER,
      conversationId: VALID_CONVERSATION,
      executionId: EXECUTION_ID,
      role: 'user' as const,
      content: 'Hello',
      tokenCount: 5,
      modelUsed: 'opencode:deepseek-v4-pro',
      attachments: [],
    };
  }

  it('calls the px07_persist_message RPC with the full identity and returns the row', async () => {
    const { client, rpcCalls } = createMockClient({
      rpcResult: { data: { message_id: 'msg-1', inserted: true }, error: null },
    });

    const result = await persistExecutionMessage(client as never, baseInput());

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.fn).toBe('px07_persist_message');
    expect(rpcCalls[0]!.args[0]).toMatchObject({
      p_subject_id: VALID_USER,
      p_conversation_id: VALID_CONVERSATION,
      p_execution_id: EXECUTION_ID,
      p_role: 'user',
      p_content: 'Hello',
      p_token_count: 5,
      p_model_used: 'opencode:deepseek-v4-pro',
      p_attachments: [],
    });
    expect(result).toEqual({ messageId: 'msg-1', inserted: true, conflict: false });
  });

  it('maps SQLSTATE PT409 / message_conflict to a conflict result (never throws)', async () => {
    const { client } = createMockClient({
      rpcResult: {
        data: null,
        error: { code: 'PT409', message: 'message_conflict' },
      },
    });

    const result = await persistExecutionMessage(client as never, baseInput());

    expect(result).toEqual({ messageId: null, inserted: false, conflict: true });
  });

  it('throws on any other database error so the router can fail closed', async () => {
    const { client } = createMockClient({
      rpcResult: { data: null, error: { code: '08006', message: 'connection lost' } },
    });

    await expect(
      persistExecutionMessage(client as never, baseInput()),
    ).rejects.toThrow('persist_message_failed');
  });

  it('forwards attachments and the legacy first-image projection', async () => {
    const { client, rpcCalls } = createMockClient({
      rpcResult: { data: { message_id: 'msg-2', inserted: true }, error: null },
    });

    await persistExecutionMessage(client as never, {
      ...baseInput(),
      legacyImageUrl: 'supabase://chat-uploads/u/a.png',
      attachments: [
        {
          ordinal: 0,
          kind: 'image',
          storageRef: 'supabase://chat-uploads/u/a.png',
          videoAssetId: null,
          available: true,
        },
      ],
    });

    expect(rpcCalls[0]!.args[0]).toMatchObject({
      p_legacy_image_url: 'supabase://chat-uploads/u/a.png',
      p_attachments: [
        {
          ordinal: 0,
          kind: 'image',
          storageRef: 'supabase://chat-uploads/u/a.png',
          videoAssetId: null,
          available: true,
        },
      ],
    });
  });
});

// ============================================================================
// validateConversation — error vs ownership distinction
// ============================================================================

describe('validateConversation', () => {
  it('returns error:db_error when the database lookup fails (→ 503)', async () => {
    const { client } = createMockClient({
      fromResult: {
        data: null,
        error: { code: '08006', message: 'Connection lost' },
      },
    });

    const result = await validateConversation(
      client as never,
      VALID_CONVERSATION,
      VALID_USER,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toBe('db_error');
  });

  it('returns error:db_error when the insert fails and retry also fails (→ 503)', async () => {
    const { client } = createMockClient({
      fromResult: { data: null, error: null }, // conversation not found
      insertResult: {
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      },
      retryResult: {
        data: null,
        error: { code: '08006', message: 'Connection lost' },
      },
    });

    const result = await validateConversation(
      client as never,
      VALID_CONVERSATION,
      VALID_USER,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toBe('db_error');
  });

  it('returns valid:false without error on ownership mismatch (→ 403)', async () => {
    const { client } = createMockClient({
      fromResult: {
        data: { user_id: OTHER_USER, total_tokens: 10 },
        error: null,
      },
    });

    const result = await validateConversation(
      client as never,
      VALID_CONVERSATION,
      VALID_USER,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('returns valid:true with token count on successful validation', async () => {
    const { client } = createMockClient({
      fromResult: {
        data: { user_id: VALID_USER, total_tokens: 42 },
        error: null,
      },
    });

    const result = await validateConversation(
      client as never,
      VALID_CONVERSATION,
      VALID_USER,
    );

    expect(result.valid).toBe(true);
    expect(result.tokenCount).toBe(42);
    expect(result.error).toBeUndefined();
  });

  it('creates a new conversation when none exists and returns valid', async () => {
    const { client } = createMockClient({
      fromResult: { data: null, error: null }, // not found
      insertResult: { data: { id: VALID_CONVERSATION }, error: null },
    });

    const result = await validateConversation(
      client as never,
      VALID_CONVERSATION,
      VALID_USER,
    );

    expect(result.valid).toBe(true);
    expect(result.tokenCount).toBe(0);
  });

  it('returns valid:false for invalid UUIDs without hitting the database', async () => {
    const { client, fromCalls } = createMockClient();

    const result = await validateConversation(
      client as never,
      'not-a-uuid',
      VALID_USER,
    );

    expect(result.valid).toBe(false);
    expect(fromCalls.length).toBe(0);
  });
});
