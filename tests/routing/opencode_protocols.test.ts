import { describe, it, expect } from 'vitest';
import { CURATED_OPENCODE_REGISTRY } from '../../supabase/functions/router/models_hub';

describe('OpenCode Protocol Wire Invariants', () => {
  it('binds GPT-5.6 family and Grok 4.6 to openai-responses', () => {
    expect(CURATED_OPENCODE_REGISTRY['gpt-5.6-luna']?.protocol).toBe('openai-responses');
    expect(CURATED_OPENCODE_REGISTRY['gpt-5.6-terra']?.protocol).toBe('openai-responses');
    expect(CURATED_OPENCODE_REGISTRY['gpt-5.6-sol']?.protocol).toBe('openai-responses');
    expect(CURATED_OPENCODE_REGISTRY['grok-4.6']?.protocol).toBe('openai-responses');
  });

  it('binds Claude 5 models to anthropic-messages', () => {
    expect(CURATED_OPENCODE_REGISTRY['claude-sonnet-5']?.protocol).toBe('anthropic-messages');
    expect(CURATED_OPENCODE_REGISTRY['claude-opus-5']?.protocol).toBe('anthropic-messages');
    expect(CURATED_OPENCODE_REGISTRY['claude-haiku-4-5']?.protocol).toBe('anthropic-messages');
  });

  it('binds DeepSeek V4 family to openai-chat', () => {
    expect(CURATED_OPENCODE_REGISTRY['deepseek-v4-flash']?.protocol).toBe('openai-chat');
    expect(CURATED_OPENCODE_REGISTRY['deepseek-v4-pro']?.protocol).toBe('openai-chat');
  });

  it('binds Gemini 3.7 Flash to gemini / specialized endpoint', () => {
    expect(CURATED_OPENCODE_REGISTRY['gemini-3.7-flash']?.protocol).toBe('gemini');
  });

  it('quarantines free models as isExperimentalFree: true', () => {
    expect(CURATED_OPENCODE_REGISTRY['deepseek-v4-flash-free']?.isExperimentalFree).toBe(true);
    expect(CURATED_OPENCODE_REGISTRY['mimo-v2.5-free']?.isExperimentalFree).toBe(true);

    expect(CURATED_OPENCODE_REGISTRY['deepseek-v4-flash']?.isExperimentalFree).toBeFalsy();
    expect(CURATED_OPENCODE_REGISTRY['gpt-5.6-luna']?.isExperimentalFree).toBeFalsy();
  });
});
