// src/components/chatTypes.ts
// Shared types and accessible metadata for ChatInterface and ChatInputComposer

export type SendBlockedReason = 'empty' | 'streaming' | 'video' | 'invalid' | null;

export interface StreamOutcomeState {
  status: 'cancelled' | 'receipt' | 'interrupted' | 'error';
  executionId?: string;
  settlementState?: string;
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
  'ready' | 'empty' | 'streaming' | 'video' | 'invalid',
  string
> = {
  ready: 'Send message',
  empty: 'Send message — type a message or attach a file first',
  streaming: 'Send message — waiting for the current response; use Stop to cancel',
  video: 'Send message — video is still processing',
  invalid: 'Send message — resolve the routing issue below first',
};
