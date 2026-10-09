// db_helpers.ts - Database persistence helpers for conversations, messages, and cost logs

// The npm: specifier resolves natively under Deno, via tsconfig "paths" under
// tsc, and via the deno-npm-stubs vite plugin under vitest.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { countTokens, countImageTokens, type ImageAttachment } from './router_logic.ts';
import { isUuid } from './security_guards.ts';
import type { CostStatus } from './execution_store.ts';
import type { AttachmentRef } from '../_shared/conversation_attachments.ts';

// ============================================================================
// TYPES
// ============================================================================

export interface Conversation {
  id: string;
  user_id: string;
  total_tokens: number;
  created_at?: string;
}

export interface MessageRecord {
  id?: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  token_count: number;
  model_used?: string | undefined;
  image_url?: string | undefined;
  created_at?: string;
}

export interface CostLogRecord {
  id?: string;
  user_id: string;
  conversation_id: string;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  input_cost: number;
  output_cost: number;
  thinking_cost: number;
  total_cost: number;
  pricing_version?: string;
  complexity_score?: number;
  route_rationale?: string;
  // Authoritative identity for the projection: supplied by the caller from the
  // execution/call ledger. Never synthesized from content. Rows written before
  // PX03 carry `legacy:` keys and are treated as estimated_legacy provenance.
  idempotency_key?: string;
  cost_status?: CostStatus;
  created_at?: string;
}

// ============================================================================
// CONVERSATION HELPERS
// ============================================================================

export interface ConversationValidationResult {
  valid: boolean;
  tokenCount: number;
  /** Present when a database error occurred (caller should return 503). */
  error?: 'db_error';
}

export async function validateConversation(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
  userId: string,
): Promise<ConversationValidationResult> {
  if (!isUuid(conversationId) || !isUuid(userId)) {
    return { valid: false, tokenCount: 0 };
  }

  const { data: conv, error } = await supabase
    .from('conversations')
    .select('user_id, total_tokens')
    .eq('id', conversationId)
    .maybeSingle();

  if (error) {
    console.error('[DB] Conversation lookup failed:', {
      code: error.code,
      message: error.message,
    });
    return { valid: false, tokenCount: 0, error: 'db_error' };
  }

  if (!conv) {
    const newConv: Conversation = { id: conversationId, user_id: userId, total_tokens: 0 };
    const { error: insertError } = await supabase.from('conversations').insert(newConv as never);
    if (insertError) {
      const { data: retryConv, error: retryError } = await supabase
        .from('conversations')
        .select('user_id, total_tokens')
        .eq('id', conversationId)
        .maybeSingle();

      if (retryError || !retryConv) {
        console.error('[DB] Conversation insert failed:', {
          code: insertError.code,
          message: insertError.message,
        });
        return { valid: false, tokenCount: 0, error: 'db_error' };
      }

      const existingConversation = retryConv as Conversation;
      if (existingConversation.user_id !== userId) {
        return { valid: false, tokenCount: 0 };
      }
      return { valid: true, tokenCount: existingConversation.total_tokens || 0 };
    }
    return { valid: true, tokenCount: 0 };
  }

  const conversation = conv as Conversation;
  if (conversation.user_id !== userId) return { valid: false, tokenCount: 0 };
  return { valid: true, tokenCount: conversation.total_tokens || 0 };
}

// ============================================================================
// MESSAGE PERSISTENCE (PX07)
// ============================================================================

export interface PersistExecutionMessageInput {
  subjectId: string;
  conversationId: string;
  executionId: string;
  role: 'user' | 'assistant';
  content: string;
  tokenCount: number;
  modelUsed?: string | undefined;
  attachments?: AttachmentRef[] | undefined;
  legacyImageUrl?: string | undefined;
}

export interface PersistExecutionMessageResult {
  messageId: string | null;
  inserted: boolean;
  conflict: boolean;
}

/**
 * Minimal structural client so this module stays free of `npm:` specifiers and
 * is injectable by vitest.
 */
export interface MessagePersistenceClient {
  rpc(
    functionName: string,
    params?: Record<string, unknown>,
  ): PromiseLike<{
    data?: unknown;
    error?: { code?: string; message?: string } | null;
  }>;
}

export class PersistMessageError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? `persist_message_failed: ${code}`);
    this.name = 'PersistMessageError';
    this.code = code;
  }
}

/**
 * PX07: durably persist a user or assistant message through the
 * service-role-only `public.px07_persist_message` RPC. This is awaited by the
 * router:
 *   * a pre-inference user-persist failure must fail the request closed
 *     (503 `transcript_unavailable`, zero provider calls);
 *   * an idempotent replay returns the existing row (`inserted: false`);
 *   * a genuine (execution_id, role) replay with different content/attachments
 *     is a conflict (SQLSTATE `PT409`), surfaced as `conflict: true`.
 */
export async function persistExecutionMessage(
  client: MessagePersistenceClient,
  input: PersistExecutionMessageInput,
): Promise<PersistExecutionMessageResult> {
  const response = await client.rpc('px07_persist_message', {
    p_subject_id: input.subjectId,
    p_conversation_id: input.conversationId,
    p_execution_id: input.executionId,
    p_role: input.role,
    p_content: input.content,
    p_token_count: input.tokenCount,
    p_model_used: input.modelUsed ?? null,
    p_attachments: input.attachments ?? [],
    p_legacy_image_url: input.legacyImageUrl ?? null,
  });

  if (response.error) {
    const code = response.error.code;
    const message = response.error.message ?? '';
    if (code === 'PT409' || message.includes('message_conflict')) {
      return { messageId: null, inserted: false, conflict: true };
    }
    throw new PersistMessageError(
      'persist_message_failed',
      `persist_message_failed: ${message || 'unknown database error'}`,
    );
  }

  const payload = response.data as { message_id?: unknown; inserted?: unknown } | null | undefined;
  return {
    messageId: typeof payload?.message_id === 'string' ? payload.message_id : null,
    inserted: payload?.inserted === true,
    conflict: false,
  };
}

// ============================================================================
// COST LOGGING
// ============================================================================

export async function persistCostLog(
  supabase: ReturnType<typeof createClient>,
  record: CostLogRecord,
): Promise<void> {
  // PX03 (F07): the authoritative identity is the execution/call ID supplied by
  // the caller. This projection NEVER synthesizes a content-based key and NEVER
  // replaces a caller-supplied `idempotency_key`. cost_logs remains a
  // server-written compatibility projection; the ledger owns authority.
  const { error } = await supabase
    .from('cost_logs')
    .upsert(record as never, {
      ignoreDuplicates: true,
      onConflict: 'idempotency_key',
    });

  if (error) {
    console.error('[DB] Cost log persist failed:', {
      code: error.code,
      message: error.message,
      idempotencyKey: record.idempotency_key ?? null,
    });
    // Re-throw so the caller can decide whether to dead-letter or retry.
    // Swallowing here silently loses cost data.
    throw new Error(`Cost log persist failed: ${error.message}`);
  }
}

// ============================================================================
// TOKEN COUNTING UTILITIES
// ============================================================================

const VIDEO_IMAGE_TOKEN_ESTIMATE = 1600;
const VIDEO_TRANSCRIPT_TOKEN_ESTIMATE = 3000;
const VIDEO_MAX_FRAME_TOKENS = 8 * VIDEO_IMAGE_TOKEN_ESTIMATE;

export function estimateVideoPromptTokens(videoAssetCount: number): number {
  if (videoAssetCount <= 0) return 0;
  const estimatedFrameCount = Math.min(videoAssetCount * 4, 8);
  const estimatedFrameTokens = Math.min(
    estimatedFrameCount * VIDEO_IMAGE_TOKEN_ESTIMATE,
    VIDEO_MAX_FRAME_TOKENS,
  );
  return estimatedFrameTokens + VIDEO_TRANSCRIPT_TOKEN_ESTIMATE;
}

export function computeUserTokenCount(
  query: string,
  imageAttachments: ImageAttachment[],
  estimatedVideoPromptTokens: number,
): number {
  return countTokens(query) + countImageTokens(imageAttachments) + estimatedVideoPromptTokens;
}
