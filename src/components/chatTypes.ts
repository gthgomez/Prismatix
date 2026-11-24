// src/components/chatTypes.ts
// Shared types and accessible metadata for ChatInterface and ChatInputComposer

export type SendBlockedReason = 'empty' | 'streaming' | 'pending' | 'history' | 'video' | 'provider-checking' | 'invalid' | null;

export interface StreamOutcomeState {
  status: 'cancelled' | 'receipt' | 'interrupted' | 'error';
  executionId?: string;
  settlementState?: string;
  receiptStatus?: import('../../supabase/functions/_shared/execution_receipt').ExecutionReceiptStatus;
  terminalOutcome?: string | null;
  error?: string;
}

export interface PromptStarter {
  title: string;
  prompt: string;
  icon?: string;
  desc?: string;
}

/**
 * Accessible name + tooltip for the send control, keyed by why it is blocked
 * (`null` reason = ready). Keeps the disabled state self-explanatory instead of
 * leaving a generic "Send message" label on an inert control.
 */
export const SEND_BLOCKED_TITLES: Record<
  'ready' | NonNullable<SendBlockedReason>,
  string
> = {
  ready: 'Send message',
  empty: 'Send message — type a message or attach a file first',
  streaming: 'Send message — waiting for the current response; use Stop to cancel',
  pending: 'Send message — checking the daily budget; please wait',
  history: 'Send message — loading the conversation; please wait',
  video: 'Send message — video is still processing',
  'provider-checking': 'Send message — checking provider setup; your draft is preserved',
  invalid: 'Send message — resolve the routing issue below first',
};
