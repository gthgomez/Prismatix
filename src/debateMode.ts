import type { DebateProfile, DebateRole, FileUploadPayload, Message } from './types';

export type { DebateParticipant } from './types';
export type DebateSelection = 'off' | DebateProfile;

export const DEBATE_SELECTIONS: Array<{ value: DebateSelection; label: string }> = [
  { value: 'off', label: 'Debate Off' },
  { value: 'general', label: 'General' },
  { value: 'code', label: 'Code' },
  { value: 'video_ui', label: 'Video UI' },
];

export function hasReadyVideoAttachment(attachments: FileUploadPayload[]): boolean {
  return attachments.some((file) => file.kind === 'video' && file.status === 'ready');
}

export function getDebatePayload(
  selection: DebateSelection,
): { mode?: 'debate'; debateProfile?: DebateProfile; debateContrarianInstructions?: string } {
  if (selection === 'off') {
    return {};
  }
  return {
    mode: 'debate',
    debateProfile: selection,
    debateContrarianInstructions: getDebateRoleInstructions(selection, 'contrarian'),
  };
}

/**
 * Returns a system-prompt addendum for a given debate role and profile.
 * The router injects this into the second model's system prompt so it
 * explicitly challenges the proposer rather than producing a similar answer.
 */
export function getDebateRoleInstructions(profile: DebateProfile, role: DebateRole): string {
  if (role === 'proposer') {
    return 'Provide your best, well-reasoned answer to the query.';
  }

  switch (profile) {
    case 'general':
      return (
        'You are the contrarian participant in a structured debate. ' +
        'Read the proposer\'s answer carefully, then challenge it. ' +
        'Identify assumptions they made without justification, perspectives they ignored, ' +
        'evidence they overlooked, and conclusions that do not follow from their reasoning. ' +
        'Do not simply agree — your role is to find the strongest possible objection or alternative view.'
      );
    case 'code':
      return (
        'You are the contrarian reviewer in a structured code debate. ' +
        'Read the proposer\'s solution carefully, then critique it rigorously. ' +
        'Look for: edge cases that break the logic, off-by-one errors, missing null/undefined checks, ' +
        'performance bottlenecks, security vulnerabilities (injection, overflow, TOCTOU), ' +
        'poor error handling, and violations of the principle of least privilege. ' +
        'Propose concrete fixes for each issue you identify.'
      );
    case 'video_ui':
      return (
        'You are the contrarian UX reviewer in a structured debate about video UI. ' +
        'Read the proposer\'s analysis carefully, then challenge it. ' +
        'Focus on: accessibility failures (WCAG violations, missing captions, keyboard traps), ' +
        'mobile and low-bandwidth edge cases, confusing affordances, inconsistent visual hierarchy, ' +
        'and any assumptions about user intent that are not supported by the content. ' +
        'Be specific about what a real user would struggle with.'
      );
  }
}

export function shouldShowDebateBadges(msg: Message): boolean {
  return Boolean(
    msg.debateActive ||
    msg.debateProfile ||
    msg.debateTrigger ||
    msg.debateModel ||
    msg.debateCostNote,
  );
}
