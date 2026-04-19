/** Canonical message when send is blocked for Video UI debate (keep in sync with checks). */
export const VIDEO_UI_DEBATE_SEND_ERROR =
  'Video UI debate requires at least one ready video attachment.';

export interface ComposerSendValidationView {
  /** Short line near Send — always shown. */
  summary: string;
  /** Full server-style line under summary, when we have a shorter summary. */
  detail: string | null;
  /** Whether to show “Open routing & debate” (header menu). */
  showRoutingCta: boolean;
}

function shouldOfferRoutingMenu(full: string): boolean {
  if (full === VIDEO_UI_DEBATE_SEND_ERROR) return true;
  const lower = full.toLowerCase();
  return lower.includes('debate') || lower.includes('video ui');
}

/** Composer hybrid: concise summary + optional full detail + routing CTA when relevant. */
export function getComposerSendValidationView(
  full: string | null,
): ComposerSendValidationView | null {
  if (!full) return null;

  if (full === VIDEO_UI_DEBATE_SEND_ERROR) {
    return {
      summary:
        'Video UI debate needs a ready video, or switch debate mode under Routing & debate.',
      detail: full,
      showRoutingCta: true,
    };
  }

  return {
    summary: full,
    detail: null,
    showRoutingCta: shouldOfferRoutingMenu(full),
  };
}
