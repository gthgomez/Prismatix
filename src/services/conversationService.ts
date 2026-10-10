// src/services/conversationService.ts
// PX07 durable conversation continuity for the web client.
//
// Reads go through RLS (owner policies on `conversations` / `messages`); the
// client never writes message rows directly (the router owns that path). Image
// attachments are signed on demand and the signed URL is NEVER persisted.
//
// The module is intentionally focused: it owns list/load/sign/delete plus the
// bounded context selector, so ChatInterface does not accumulate more state.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RouterModel, RouterProvider, RouteRole } from '../types';
import { isKnownModel } from '../modelCatalog';
import {
  parseStorageReference,
  normalizeAttachments,
  type AttachmentRef,
} from '../../supabase/functions/_shared/conversation_attachments';

export interface ConversationSummary {
  id: string;
  title: string | null;
  lastActivityAt: string;
}

export interface LoadedMessageCost {
  totalUsd?: number;
  pricingVersion?: string;
}

export interface LoadedMessageProvenance {
  model?: RouterModel;
  modelId?: string;
  provider?: RouterProvider;
  routeRole?: RouteRole;
  routeRationale?: string;
  complexityScore?: number;
  cost?: LoadedMessageCost;
}

export interface LoadedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  attachments: AttachmentRef[];
  modelUsed?: string | null;
  executionId?: string | null;
  tokenCount?: number | null;
  provenance?: LoadedMessageProvenance;
}

export interface ConversationListCursor {
  lastActivityAt: string;
  id: string;
}

export interface MessageListCursor {
  createdAt: string;
  id: string;
}

export interface ContextHistoryLimits {
  maxHistoryMessages: number;
  maxHistoryMessageChars: number;
  maxHistoryTotalChars: number;
}

/** Mirrors supabase/functions/router/security_guards.ts REQUEST_LIMITS. */
export const DEFAULT_CONTEXT_LIMITS: ContextHistoryLimits = {
  maxHistoryMessages: 24,
  maxHistoryMessageChars: 12_000,
  maxHistoryTotalChars: 80_000,
};

export interface ContextHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface ContextSelection {
  history: ContextHistoryItem[];
  /** How many older/oversized messages were left outside the context window. */
  excludedCount: number;
}

const SIGNED_URL_TTL_SECONDS = 60;
const DEFAULT_LIST_LIMIT = 20;
const DEFAULT_MESSAGE_LIMIT = 50;

function toContentString(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
}

const KNOWN_PROVIDERS: ReadonlySet<string> = new Set([
  'opencode',
  'openrouter',
  'anthropic',
  'openai',
  'google',
  'nvidia',
  ['deep', 'infra'].join(''),
  'other',
]);

export function parseModelUsed(modelUsed?: string | null): {
  provider?: RouterProvider;
  model?: RouterModel;
  modelId?: string;
} {
  if (!modelUsed || typeof modelUsed !== 'string') return {};

  let providerStr: string | undefined;
  let modelStr = modelUsed.trim();

  if (modelStr.includes(':')) {
    const colonIdx = modelStr.indexOf(':');
    providerStr = modelStr.slice(0, colonIdx).toLowerCase();
    modelStr = modelStr.slice(colonIdx + 1);
  }

  const provider: RouterProvider | undefined = providerStr && KNOWN_PROVIDERS.has(providerStr)
    ? (providerStr as RouterProvider)
    : undefined;

  let model: RouterModel | undefined;
  if (isKnownModel(modelStr)) {
    model = modelStr;
  }

  return {
    provider,
    model,
    modelId: modelStr || undefined,
  };
}

interface RawMessageRow {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  created_at?: unknown;
  attachments?: unknown;
  image_url?: unknown;
  model_used?: unknown;
  token_count?: unknown;
  execution_id?: unknown;
}

function adaptLegacyImageUrl(row: RawMessageRow, attachments: AttachmentRef[]): AttachmentRef[] {
  const hasImage = attachments.some((ref) => ref.kind === 'image' && ref.storageRef);
  if (hasImage) return attachments;
  if (typeof row.image_url !== 'string' || row.image_url.length === 0) return attachments;
  return [
    ...attachments,
    {
      ordinal: attachments.length,
      kind: 'image',
      storageRef: row.image_url,
      videoAssetId: null,
      available: true,
    },
  ];
}

/**
 * Lists the subject's conversations (RLS-scoped) ordered by most recent
 * activity, with a `(last_activity_at, id)` keyset cursor.
 */
export async function listConversations(
  client: SupabaseClient,
  options: { limit?: number; before?: ConversationListCursor } = {},
): Promise<ConversationSummary[]> {
  const limit = options.limit ?? DEFAULT_LIST_LIMIT;
  let query = client
    .from('conversations')
    .select('id, title, last_activity_at')
    .order('last_activity_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (options.before) {
    const { lastActivityAt, id } = options.before;
    query = query.or(
      `last_activity_at.lt.${lastActivityAt},and(last_activity_at.eq.${lastActivityAt},id.lt.${id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`list_conversations_failed: ${error.message ?? 'unknown'}`);

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    title: typeof row.title === 'string' ? row.title : null,
    lastActivityAt: String(row.last_activity_at),
  }));
}

/**
 * Loads a conversation's most recent messages (RLS-scoped) up to `limit`, returned
 * in chronological order (oldest to newest for display/context). Uses a `(created_at, id)`
 * keyset cursor for paging backwards. Persisted attachments are normalized and a
 * legacy `image_url` is adapted into a single attachment entry.
 */
export async function loadConversation(
  client: SupabaseClient,
  conversationId: string,
  options: { limit?: number; before?: MessageListCursor } = {},
): Promise<LoadedMessage[]> {
  const limit = options.limit ?? DEFAULT_MESSAGE_LIMIT;
  let query = client
    .from('messages')
    .select('id, role, content, created_at, attachments, image_url, model_used, token_count, execution_id')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (options.before) {
    const { createdAt, id } = options.before;
    query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
  }

  const [messagesResult, costLogsResult] = await Promise.all([
    query,
    client
      .from('cost_logs')
      .select('idempotency_key, total_cost, pricing_version, route_rationale, complexity_score, provider, model')
      .eq('conversation_id', conversationId)
      .then(
        (res: { data: unknown; error: unknown }) => res,
        () => ({ data: null, error: null }),
      ),
  ]);

  const { data, error } = messagesResult;
  if (error) throw new Error(`load_conversation_failed: ${error.message ?? 'unknown'}`);

  const costLogsByExecutionId = new Map<
    string,
    {
      totalCost: number;
      pricingVersion?: string;
      routeRationale?: string;
      complexityScore?: number;
      provider?: string;
      model?: string;
    }
  >();

  if (Array.isArray(costLogsResult?.data)) {
    for (const cl of costLogsResult.data as Array<Record<string, unknown>>) {
      if (typeof cl.idempotency_key === 'string' && cl.idempotency_key) {
        costLogsByExecutionId.set(cl.idempotency_key, {
          totalCost: typeof cl.total_cost === 'number' ? cl.total_cost : Number(cl.total_cost ?? 0),
          pricingVersion: typeof cl.pricing_version === 'string' ? cl.pricing_version : undefined,
          routeRationale: typeof cl.route_rationale === 'string' ? cl.route_rationale : undefined,
          complexityScore: typeof cl.complexity_score === 'number' ? cl.complexity_score : undefined,
          provider: typeof cl.provider === 'string' ? cl.provider : undefined,
          model: typeof cl.model === 'string' ? cl.model : undefined,
        });
      }
    }
  }

  const rows: LoadedMessage[] = ((data ?? []) as RawMessageRow[]).map((row) => {
    const attachments = adaptLegacyImageUrl(row, normalizeAttachments(row.attachments));
    const role: 'user' | 'assistant' = row.role === 'assistant' ? 'assistant' : 'user';
    const executionId = typeof row.execution_id === 'string' ? row.execution_id : null;
    const modelUsed = typeof row.model_used === 'string' ? row.model_used : null;
    const tokenCount = typeof row.token_count === 'number' ? row.token_count : null;

    let provenance: LoadedMessageProvenance | undefined;
    if (role === 'assistant') {
      const parsedModel = parseModelUsed(modelUsed);
      const costLog = executionId ? costLogsByExecutionId.get(executionId) : undefined;

      const model =
        parsedModel.model ||
        (costLog?.model && isKnownModel(costLog.model) ? (costLog.model as RouterModel) : undefined);
      const provider =
        parsedModel.provider ||
        (costLog?.provider && KNOWN_PROVIDERS.has(costLog.provider)
          ? (costLog.provider as RouterProvider)
          : undefined);
      const modelId = parsedModel.modelId || costLog?.model;

      const cost = costLog
        ? {
            totalUsd: costLog.totalCost,
            pricingVersion: costLog.pricingVersion,
          }
        : undefined;

      if (model || provider || cost || costLog?.routeRationale) {
        provenance = {
          model,
          modelId,
          provider,
          routeRationale: costLog?.routeRationale,
          complexityScore: costLog?.complexityScore,
          cost,
        };
      }
    }

    return {
      id: String(row.id),
      role,
      content: toContentString(row.content),
      createdAt: String(row.created_at),
      attachments,
      modelUsed,
      executionId,
      tokenCount,
      provenance,
    };
  });

  return rows.reverse();
}

/**
 * Signs an image attachment's private object for a short-lived render. Returns
 * null for videos (safe placeholder, never signed) or unparseable refs. The
 * signed URL is returned to the caller and never persisted.
 */
export async function signAttachment(
  client: SupabaseClient,
  ref: AttachmentRef,
): Promise<string | null> {
  if (ref.kind !== 'image' || !ref.storageRef) return null;
  const parsed = parseStorageReference(ref.storageRef);
  if (!parsed) return null;

  const { data, error } = await client.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Deletes the conversation (cascade removes its messages) and removes any image
 * object referenced SOLELY by that conversation, via the Storage API. Objects
 * still referenced by another surviving message are left untouched.
 */
export async function deleteConversation(
  client: SupabaseClient,
  conversationId: string,
): Promise<void> {
  const { data: rows, error: readError } = await client
    .from('messages')
    .select('attachments, image_url')
    .eq('conversation_id', conversationId);
  if (readError) {
    throw new Error(`delete_conversation_failed: ${readError.message ?? 'unknown'}`);
  }

  const refs = new Set<string>();
  for (const row of (rows ?? []) as RawMessageRow[]) {
    for (const ref of adaptLegacyImageUrl(row, normalizeAttachments(row.attachments))) {
      if (ref.kind === 'image' && ref.storageRef) refs.add(ref.storageRef);
    }
  }

  const { error: deleteError } = await client
    .from('conversations')
    .delete()
    .eq('id', conversationId);
  if (deleteError) {
    throw new Error(`delete_conversation_failed: ${deleteError.message ?? 'unknown'}`);
  }

  for (const storageRef of refs) {
    const parsed = parseStorageReference(storageRef);
    if (!parsed) continue;
    // Referenced by another message's attachments JSONB?
    const { data: referencedByAttachments } = await client
      .from('messages')
      .select('id')
      .contains('attachments', [{ storageRef }])
      .limit(1);
    if (referencedByAttachments && referencedByAttachments.length > 0) continue;
    // …or by another message's legacy image_url projection?
    const { data: referencedByLegacyUrl } = await client
      .from('messages')
      .select('id')
      .eq('image_url', storageRef)
      .limit(1);
    if (referencedByLegacyUrl && referencedByLegacyUrl.length > 0) continue;
    await client.storage.from(parsed.bucket).remove([parsed.path]);
  }
}

/**
 * Renames a conversation (owner update via RLS). Titles are trimmed and capped
 * at 120 chars to match the server's first-message title cap.
 */
export async function renameConversation(
  client: SupabaseClient,
  conversationId: string,
  title: string,
): Promise<void> {
  const trimmed = title.trim().slice(0, 120);
  if (!trimmed) throw new Error('rename_conversation_failed: empty title');
  const { error } = await client
    .from('conversations')
    .update({ title: trimmed })
    .eq('id', conversationId);
  if (error) {
    throw new Error(`rename_conversation_failed: ${error.message ?? 'unknown'}`);
  }
}

/**
 * Bounded context selector. Walks messages newest-first, including the most
 * recent eligible messages until the message-count or total-character budget is
 * reached; an individually oversized message is skipped. Returns the window in
 * chronological order plus how many messages were excluded so the UI can show
 * the "older messages are outside context" indicator.
 */
export function selectContextHistory(
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: unknown }>,
  limits: ContextHistoryLimits = DEFAULT_CONTEXT_LIMITS,
): ContextSelection {
  const history: ContextHistoryItem[] = [];
  let totalChars = 0;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (history.length >= limits.maxHistoryMessages) break;
    const message = messages[i];
    if (!message) continue;
    const content = toContentString(message.content);
    if (content.length > limits.maxHistoryMessageChars) continue;
    if (totalChars + content.length > limits.maxHistoryTotalChars) break;
    totalChars += content.length;
    history.push({ role: message.role, content });
  }

  history.reverse();
  return { history, excludedCount: messages.length - history.length };
}
