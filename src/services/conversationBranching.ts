// src/services/conversationBranching.ts
// F17: Conversation branching and response version history.
// Supports branching from a specific message, preserving parent/branch lineage,
// and switching response versions without duplicate billing or inference.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LoadedMessage } from './conversationService';

export interface BranchResult {
  newConversationId: string;
  copiedMessageCount: number;
  newTitle: string;
}

export interface MessageVersion {
  version: number;
  content: string;
  model?: string | null;
  timestamp: number;
}

/**
 * Creates a new branched conversation starting up to and including a specific message.
 * Executes atomically on the server via `px17_branch_conversation`, preserving parent/branch
 * lineage, original message timestamps, and token counts without client-side insertion rights.
 */
export async function branchConversation(
  client: SupabaseClient,
  options: {
    sourceConversationId: string;
    fromMessageId: string;
    branchTitle?: string;
  },
): Promise<BranchResult> {
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    throw new Error('branch_conversation_failed: not authenticated');
  }

  const { data, error } = await client.rpc('px17_branch_conversation', {
    p_source_conversation_id: options.sourceConversationId,
    p_from_message_id: options.fromMessageId,
    p_branch_title: options.branchTitle?.trim() || null,
  });

  if (error || !data) {
    throw new Error(`branch_conversation_failed: ${error?.message || 'unexpected server response'}`);
  }

  const res = data as {
    success: boolean;
    new_conversation_id: string;
    copied_message_count: number;
    title: string;
  };

  if (!res.success) {
    throw new Error('branch_conversation_failed: operation failed on server');
  }

  return {
    newConversationId: res.new_conversation_id,
    copiedMessageCount: res.copied_message_count,
    newTitle: res.title,
  };
}

/**
 * Durably records an alternative response version to an assistant message in the database.
 */
export async function persistMessageVersion(
  client: SupabaseClient,
  messageId: string,
  newContent: string,
  newModel?: string,
): Promise<{ success: boolean; versions: MessageVersion[]; currentVersion: number }> {
  const { data, error } = await client.rpc('px17_record_message_version', {
    p_message_id: messageId,
    p_content: newContent,
    p_model: newModel || null,
  });

  if (error || !data) {
    throw new Error(`record_version_failed: ${error?.message || 'failed to persist version'}`);
  }

  const res = data as {
    success: boolean;
    versions: MessageVersion[];
    current_version: number;
  };

  return {
    success: res.success,
    versions: res.versions,
    currentVersion: res.current_version,
  };
}

/**
 * In-memory helper to append an alternative response version to an assistant message.
 */
export function recordMessageVersion(
  currentMessage: LoadedMessage,
  newContent: string,
  newModel?: string,
): { updatedContent: string; versions: MessageVersion[]; currentVersion: number } {
  const existingVersions: MessageVersion[] = Array.isArray(currentMessage.metadata?.versions)
    ? (currentMessage.metadata.versions as MessageVersion[])
    : [
        {
          version: 1,
          content: currentMessage.content,
          model: currentMessage.modelUsed,
          timestamp: currentMessage.createdAt ? new Date(currentMessage.createdAt).getTime() : Date.now(),
        },
      ];

  const nextVersionNum = existingVersions.length + 1;
  const newVersion: MessageVersion = {
    version: nextVersionNum,
    content: newContent,
    model: newModel || currentMessage.modelUsed,
    timestamp: Date.now(),
  };

  const updatedVersions = [...existingVersions, newVersion];
  return {
    updatedContent: newContent,
    versions: updatedVersions,
    currentVersion: nextVersionNum,
  };
}
