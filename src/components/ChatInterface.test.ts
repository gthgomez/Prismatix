import { describe, expect, it } from 'vitest';
import {
  getDebatePayload,
  getDebateRoleInstructions,
  hasReadyVideoAttachment,
  shouldShowDebateBadges,
} from '../debateMode';
import type { FileUploadPayload, Message } from '../types';

describe('ChatInterface debate mode helpers', () => {
  it('blocks video_ui debate when no ready video attachment exists', () => {
    const attachments: FileUploadPayload[] = [
      { name: 'clip.mp4', isImage: false, kind: 'video', status: 'processing' },
      { name: 'notes.md', isImage: false, kind: 'text', content: 'hello' },
    ];

    expect(hasReadyVideoAttachment(attachments)).toBe(false);
  });

  it('allows video_ui debate when a ready video attachment exists', () => {
    const attachments: FileUploadPayload[] = [
      { name: 'clip.mp4', isImage: false, kind: 'video', status: 'ready', videoAssetId: 'video_123' },
    ];

    expect(hasReadyVideoAttachment(attachments)).toBe(true);
  });

  it('sends debate payload only when debate mode is selected', () => {
    expect(getDebatePayload('off')).toEqual({});
    expect(getDebatePayload('general')).toEqual({
      mode: 'debate',
      debateProfile: 'general',
      debateContrarianInstructions: getDebateRoleInstructions('general', 'contrarian'),
    });
    expect(getDebatePayload('code')).toEqual({
      mode: 'debate',
      debateProfile: 'code',
      debateContrarianInstructions: getDebateRoleInstructions('code', 'contrarian'),
    });
    expect(getDebatePayload('video_ui')).toEqual({
      mode: 'debate',
      debateProfile: 'video_ui',
      debateContrarianInstructions: getDebateRoleInstructions('video_ui', 'contrarian'),
    });
  });

  it('shows debate badges only when debate metadata exists', () => {
    const noDebateMessage: Message = {
      role: 'assistant',
      content: 'No debate',
      timestamp: Date.now(),
    };
    const debateMessage: Message = {
      role: 'assistant',
      content: 'Debate active',
      timestamp: Date.now(),
      debateActive: true,
      debateProfile: 'code',
      debateTrigger: 'auto',
    };

    expect(shouldShowDebateBadges(noDebateMessage)).toBe(false);
    expect(shouldShowDebateBadges(debateMessage)).toBe(true);
  });
});
