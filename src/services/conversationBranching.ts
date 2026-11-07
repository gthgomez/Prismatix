// src/services/conversationBranching.ts
// F17: Conversation branching and response version history.
// Supports branching from a specific message, preserving parent/branch lineage,
// and switching response versions without duplicate billing or inference.

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConversation, type LoadedMessage } from './conversationService';

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

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Creates a new branched conversation starting up to and including a specific message.
 * Preserves parent/branch lineage and copies prior transcript context.
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

  // 1. Fetch source conversation metadata
  const { data: sourceConv, error: sourceErr } = await client
    .from('conversations')
    .select('id, title, project_id')
    .eq('id', options.sourceConversationId)
    .single();

  if (sourceErr || !sourceConv) {
    throw new Error(`branch_conversation_failed: source conversation not found (${sourceErr?.message})`);
  }

  // 2. Fetch all messages in the source conversation
  const messages = await loadConversation(client, options.sourceConversationId, { limit: 1000 });

  // Locate the target message boundary
  const targetIndex = messages.findIndex((m) => m.id === options.fromMessageId);
  if (targetIndex === -1) {
    throw new Error(`branch_conversation_failed: message ${options.fromMessageId} not found in conversation`);
  }

  // Slice messages up to and including target message
  const messagesToCopy = messages.slice(0, targetIndex + 1);

  const newConvId = generateUuid();
  const defaultTitle = `Branch: ${sourceConv.title || 'Conversation'}`;
  const newTitle = options.branchTitle?.trim() || defaultTitle;

  // 3. Create the new branched conversation with lineage
  const { error: insertConvErr } = await client.from('conversations').insert({
    id: newConvId,
    user_id: user.id,
    title: newTitle,
    project_id: sourceConv.project_id || null,
    parent_conversation_id: options.sourceConversationId,
    forked_from_message_id: options.fromMessageId,
    created_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
  });

  if (insertConvErr) {
    throw new Error(`branch_conversation_failed: failed to create branch conversation (${insertConvErr.message})`);
  }

  // 4. Duplicate messages into the new branch with new message IDs
  let copiedCount = 0;
  for (const msg of messagesToCopy) {
    const newMsgId = generateUuid();
    const { error: msgErr } = await client.from('messages').insert({
      id: newMsgId,
      conversation_id: newConvId,
      role: msg.role,
      content: msg.content,
      token_count: msg.tokenCount || 0,
      model_used: msg.modelUsed,
      attachments: msg.attachments || [],
      created_at: msg.createdAt || new Date().toISOString(),
      metadata: {
        ...(msg.metadata || {}),
        branchedFromMessageId: msg.id,
      },
    });

    if (!msgErr) {
      copiedCount++;
    }
  }

  return {
    newConversationId: newConvId,
    copiedMessageCount: copiedCount,
    newTitle,
  };
}

/**
 * Adds an alternative response version to an assistant message metadata.
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
