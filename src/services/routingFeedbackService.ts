// src/services/routingFeedbackService.ts
// F15: Record user routing quality feedback and model comparison preferences under RLS.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RouterModel } from '../types';

export type FeedbackType =
  | 'thumb_up'
  | 'thumb_down'
  | 'model_underpowered'
  | 'model_overpriced'
  | 'comparison_preference';

export interface RoutingFeedbackInput {
  conversationId?: string | null;
  messageId?: string | null;
  chosenModel: RouterModel;
  routingRole?: string | null;
  feedbackType: FeedbackType;
  comparisonPreferredModel?: RouterModel | null;
  userComment?: string | null;
}

export async function submitRoutingFeedback(
  client: SupabaseClient,
  input: RoutingFeedbackInput,
): Promise<{ success: boolean; id?: string }> {
  try {
    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user) {
      return { success: false };
    }

    const { data, error } = await client
      .from('routing_quality_feedback')
      .insert({
        user_id: user.id,
        conversation_id: input.conversationId || null,
        message_id: input.messageId || null,
        chosen_model: input.chosenModel,
        routing_role: input.routingRole || null,
        feedback_type: input.feedbackType,
        comparison_preferred_model: input.comparisonPreferredModel || null,
        user_comment: input.userComment?.trim() || null,
      })
      .select('id')
      .single();

    if (error) {
      console.warn('[routingFeedbackService] Feedback insert failed:', error.message);
      return { success: false };
    }

    return { success: true, id: data ? String(data.id) : undefined };
  } catch (err) {
    console.warn('[routingFeedbackService] Feedback submission exception:', err);
    return { success: false };
  }
}
