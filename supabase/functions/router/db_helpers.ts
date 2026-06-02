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
  created_at?: string;
}

// ============================================================================
// CONVERSATION HELPERS
// ============================================================================

export async function validateConversation(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
  userId: string,
): Promise<{ valid: boolean; tokenCount: number }> {
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
    return { valid: false, tokenCount: 0 };
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
        return { valid: false, tokenCount: 0 };
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

      await Promise.all([
        supabase.from('messages').insert(messageRecord as never),
        supabase.rpc('increment_token_count_for_user', {
          p_conversation_id: conversationId,
          p_user_id: userId,
          p_tokens: tokenCount,
        } as never),
      ]);
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
  try {
    await supabase.from('cost_logs').insert(record as never);
  } catch (err) {
    console.error('[DB] Cost log persist failed:', err);
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
