import { describe, expect, it } from 'vitest';
import {
  getComposerSendValidationView,
  VIDEO_UI_DEBATE_SEND_ERROR,
} from './sendValidationPresentation';

describe('getComposerSendValidationView', () => {
  it('returns null for empty', () => {
    expect(getComposerSendValidationView(null)).toBeNull();
  });

  it('uses hybrid summary + detail + CTA for video UI debate error', () => {
    const v = getComposerSendValidationView(VIDEO_UI_DEBATE_SEND_ERROR);
    expect(v).not.toBeNull();
    expect(v!.summary).toContain('Video UI debate');
    expect(v!.detail).toBe(VIDEO_UI_DEBATE_SEND_ERROR);
    expect(v!.showRoutingCta).toBe(true);
  });

  it('shows routing CTA for generic debate-related copy', () => {
    const v = getComposerSendValidationView('Debate mode needs more tokens.');
    expect(v!.summary).toBe('Debate mode needs more tokens.');
    expect(v!.detail).toBeNull();
    expect(v!.showRoutingCta).toBe(true);
  });

  it('omits routing CTA for unrelated messages', () => {
    const v = getComposerSendValidationView('Network timeout.');
    expect(v!.showRoutingCta).toBe(false);
  });
});
