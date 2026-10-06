// db_helpers.ts - Database persistence helpers for conversations, messages, and cost logs

import { createClient } from 'npm:@supabase/supabase-js@2';
import { countTokens, countImageTokens, type ImageAttachment } from './router_logic.ts';
import { isUuid } from './security_guards.ts';

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
  idempotency_key?: string;
  created_at?: string;
}

// ============================================================================
// IDEMPOTENCY
// ============================================================================

/**
 * Builds a deterministic idempotency key from cost-log content fields.
 * The same logical cost log (same conversation, model, token counts, and
 * costs) always produces the same key, so retries collapse onto one row.
 * `created_at` is intentionally excluded: the database generates it, so
 * including it would defeat deduplication across retries.
 */
export function buildCostLogIdempotencyKey(record: CostLogRecord): string {
  return [
    record.conversation_id,
    record.user_id,
    record.model,
    record.provider,
    record.input_tokens,
    record.output_tokens,
    record.thinking_tokens,
    record.input_cost,
    record.output_cost,
    record.thinking_cost,
    record.total_cost,
    record.pricing_version ?? '',
    record.complexity_score ?? '',
    record.route_rationale ?? '',
  ].join('::');
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
// MESSAGE PERSISTENCE
// ============================================================================

export function persistMessageAsync(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  tokenCount: number,
  modelUsed?: string,
  imageUrl?: string,
): void {
  (async () => {
    try {
      const messageRecord: MessageRecord = {
        conversation_id: conversationId,
        role,
        content,
        token_count: tokenCount,
        model_used: modelUsed || undefined,
        image_url: imageUrl || undefined,
      };

      // Sequential awaits: insert the message first, then bump the token
      // counter. Running these concurrently (Promise.all) risks a partial
      // failure where the message row exists but the counter was not
      // incremented (or vice-versa), causing silent token-count drift.
      const { error: insertError } = await supabase.from('messages').insert(messageRecord as never);
      if (insertError) {
        console.error('[DB] Message insert failed:', {
          code: insertError.code,
          message: insertError.message,
        });
        return;
      }

      const { error: rpcError } = await supabase.rpc('increment_token_count_for_user', {
        p_conversation_id: conversationId,
        p_user_id: userId,
        p_tokens: tokenCount,
      } as never);
      if (rpcError) {
        // The message row is already persisted; the counter was not bumped.
        // Log loudly so the drift is visible and can be reconciled.
        console.error('[DB] Token count increment failed after message insert:', {
          code: rpcError.code,
          message: rpcError.message,
          conversationId,
          userId,
          tokenCount,
        });
      }
    } catch (err) {
      console.error('[DB] Persist failed:', err);
    }
  })();
}

// ============================================================================
// COST LOGGING
// ============================================================================

export async function persistCostLog(
  supabase: ReturnType<typeof createClient>,
  record: CostLogRecord,
): Promise<void> {
  const idempotencyKey = buildCostLogIdempotencyKey(record);
  const recordWithKey: CostLogRecord = { ...record, idempotency_key: idempotencyKey };

  const { error } = await supabase
    .from('cost_logs')
    .upsert(recordWithKey as never, {
      ignoreDuplicates: true,
      onConflict: 'idempotency_key',
    });

  if (error) {
    console.error('[DB] Cost log persist failed:', {
      code: error.code,
      message: error.message,
      idempotencyKey,
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
