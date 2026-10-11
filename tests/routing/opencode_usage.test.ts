import { describe, it, expect } from 'vitest';
import { createUsageTracker } from '../../supabase/functions/router/usage';

describe('OpenCode usage across upstream protocols', () => {
  it('settles Messages usage from the provider frames', () => {
    const tracker = createUsageTracker('opencode');
    tracker.observe({ type: 'message_start', message: { usage: { input_tokens: 23, output_tokens: 0 } } });
    tracker.observe({ type: 'message_delta', usage: { output_tokens: 4 } });
    expect(tracker.usage()).toEqual({ inputTokens: 23, outputTokens: 4, thinkingTokens: 0 });
  });
  it('settles Responses usage without double-billing reasoning', () => {
    const tracker = createUsageTracker('opencode');
    tracker.observe({ type: 'response.completed', response: { usage: {
      input_tokens: 20, output_tokens: 12, output_tokens_details: { reasoning_tokens: 8 },
    } } });
    expect(tracker.usage()).toEqual({ inputTokens: 20, outputTokens: 4, thinkingTokens: 8 });
  });
  it('settles Gemini usage and leaves absent usage pending', () => {
    const tracker = createUsageTracker('opencode');
    expect(tracker.usage()).toBeNull();
    tracker.observe({ usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 4, thoughtsTokenCount: 8 } });
    expect(tracker.usage()).toEqual({ inputTokens: 20, outputTokens: 4, thinkingTokens: 8 });
  });
});
