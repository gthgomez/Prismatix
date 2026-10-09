// src/services/conversationState.ts
// PX07 per-account selected-conversation state + the stream-update guard.
//
// Kept out of ChatInterface so the isolation and switch-guard rules are pure
// and testable. The selection key includes the authenticated user id, so an
// account change can never open another account's conversation.

export const NEW_CHAT_SELECTION = '__new__';

const STORAGE_KEY_PREFIX = 'prismatix_selected_conversation_';

export interface InitialConversationPlan {
  /** The stored conversation to open, or null for a fresh New Chat. */
  conversationId: string | null;
  /**
   * True when the shared (non-per-account) conversation id must be reset, so a
   * prior account's draft id can never leak into the new account's first send.
   */
  resetGlobalConversation: boolean;
}

/**
 * Decides the initial conversation for the current account from its stored
 * selection. Any account WITHOUT a concrete stored conversation must reset the
 * shared global conversation id (account-change isolation).
 */
export function planInitialConversation(stored: string | null): InitialConversationPlan {
  if (stored && stored !== NEW_CHAT_SELECTION) {
    return { conversationId: stored, resetGlobalConversation: false };
  }
  return { conversationId: null, resetGlobalConversation: true };
}

/** localStorage key namespaced by the authenticated user id. */
export function selectedConversationKey(userId: string | null | undefined): string {
  return `${STORAGE_KEY_PREFIX}${userId ?? 'anonymous'}`;
}

/** Reads the stored selection (a conversation id, the New Chat sentinel, or null). */
export function readSelectedConversation(userId: string | null | undefined): string | null {
  try {
    return localStorage.getItem(selectedConversationKey(userId));
  } catch {
    return null;
  }
}

/** Persists the selection for this account (New Chat writes the sentinel). */
export function writeSelectedConversation(
  userId: string | null | undefined,
  selection: string,
): void {
  try {
    localStorage.setItem(selectedConversationKey(userId), selection);
  } catch {
    // Storage unavailable (private mode); the in-memory selection still applies.
  }
}

export interface StreamUpdateGuard {
  activeConversationId: string | null;
  activeClientRequestId: string | null;
  updateConversationId: string | null;
  updateClientRequestId: string | null;
}

/**
 * True only when a stream update belongs to the currently active
 * (conversationId, clientRequestId). A response for a conversation the user has
 * left, or for a superseded request, is ignored.
 */
export function streamUpdateAppliesToActive(guard: StreamUpdateGuard): boolean {
  if (!guard.activeConversationId || !guard.activeClientRequestId) return false;
  return (
    guard.activeConversationId === guard.updateConversationId &&
    guard.activeClientRequestId === guard.updateClientRequestId
  );
}
