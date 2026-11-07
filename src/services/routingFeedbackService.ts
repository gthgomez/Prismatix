// src/services/routingFeedbackService.ts
// F15: Record user routing quality feedback and model comparison preferences under RLS.
// Supports create, update, remove (toggle off), and retrieval lifecycles.

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

export interface RoutingFeedbackRecord {
  id: string;
  userId: string;
  conversationId: string | null;
  messageId: string | null;
  chosenModel: RouterModel;
  routingRole: string | null;
  feedbackType: FeedbackType;
  comparisonPreferredModel: RouterModel | null;
  userComment: string | null;
  createdAt: string;
}

/**
 * Submits or updates routing quality feedback for a given message.
 * Upserts on (user_id, message_id, feedback_type) to maintain idempotency.
 */
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
      .upsert(
        {
          user_id: user.id,
          conversation_id: input.conversationId || null,
          message_id: input.messageId || null,
          chosen_model: input.chosenModel,
          routing_role: input.routingRole || null,
          feedback_type: input.feedbackType,
          comparison_preferred_model: input.comparisonPreferredModel || null,
          user_comment: input.userComment?.trim() || null,
        },
        { onConflict: 'user_id,message_id,feedback_type' },
      )
      .select('id')
      .single();

    if (error) {
      console.warn('[routingFeedbackService] Feedback upsert failed:', error.message);
      return { success: false };
    }

    return { success: true, id: data ? String(data.id) : undefined };
  } catch (err) {
    console.warn('[routingFeedbackService] Feedback submission exception:', err);
    return { success: false };
  }
}

/**
 * Deletes routing feedback for a given message and feedback type (e.g. toggling off).
 */
export async function deleteRoutingFeedback(
  client: SupabaseClient,
  options: { messageId: string; feedbackType: FeedbackType },
): Promise<{ success: boolean }> {
  try {
    const {
      data: { user },
    } = await client.auth.getUser();

    if (!user) {
      return { success: false };
    }

    const { error } = await client
      .from('routing_quality_feedback')
      .delete()
      .eq('user_id', user.id)
      .eq('message_id', options.messageId)
      .eq('feedback_type', options.feedbackType);

    if (error) {
      console.warn('[routingFeedbackService] Feedback deletion failed:', error.message);
      return { success: false };
    }

    return { success: true };
  } catch (err) {
    console.warn('[routingFeedbackService] Feedback delete exception:', err);
    return { success: false };
  }
}

/**
 * Toggles routing feedback on/off. If the user already provided this feedback type
 * for the message, it is deleted. Otherwise, it is submitted.
 */
export async function toggleRoutingFeedback(
  client: SupabaseClient,
  input: RoutingFeedbackInput,
): Promise<{ active: boolean; id?: string }> {
  if (!input.messageId) {
    const res = await submitRoutingFeedback(client, input);
    return { active: res.success, id: res.id };
  }

  const existing = await getRoutingFeedbackForMessage(client, input.messageId);
  const matched = existing.find((f) => f.feedbackType === input.feedbackType);

  if (matched) {
    const delRes = await deleteRoutingFeedback(client, {
      messageId: input.messageId,
      feedbackType: input.feedbackType,
    });
    return { active: !delRes.success };
  }

  const submitRes = await submitRoutingFeedback(client, input);
  return { active: submitRes.success, id: submitRes.id };
}

/**
 * Retrieves all routing feedback records for a specific message under user's RLS.
 */
export async function getRoutingFeedbackForMessage(
  client: SupabaseClient,
  messageId: string,
): Promise<RoutingFeedbackRecord[]> {
  try {
    const { data, error } = await client
      .from('routing_quality_feedback')
      .select('*')
      .eq('message_id', messageId);

    if (error || !Array.isArray(data)) {
      return [];
    }

    return data.map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
      conversationId: row.conversation_id ? String(row.conversation_id) : null,
      messageId: row.message_id ? String(row.message_id) : null,
      chosenModel: row.chosen_model as RouterModel,
      routingRole: row.routing_role ? String(row.routing_role) : null,
      feedbackType: row.feedback_type as FeedbackType,
      comparisonPreferredModel: row.comparison_preferred_model
        ? (row.comparison_preferred_model as RouterModel)
        : null,
      userComment: row.user_comment ? String(row.user_comment) : null,
      createdAt: String(row.created_at),
    }));
  } catch (err) {
    console.warn('[routingFeedbackService] Get feedback exception:', err);
    return [];
  }
}
