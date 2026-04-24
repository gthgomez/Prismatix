import { describe, expect, it } from 'vitest';
import {
  analyzeRouting,
  determineRoute,
  type ImageAttachment,
  type RouterParams,
} from '../../supabase/functions/router/router_logic.ts';

function baseParams(over: Partial<RouterParams>): RouterParams {
  return {
    userQuery: '',
    currentSessionTokens: 0,
    platform: 'web',
    history: [],
    ...over,
  };
}

describe('routing matrix', () => {
  it('low complexity: very short casual query → GPT mini', () => {
    const params = baseParams({ userQuery: 'hi' });
    const d = determineRoute(params);
    expect(d.modelTier).toBe('gpt-5.4-mini');
    expect(d.routingDebug.routeStep).toBe('gpt-mini');
  });

  it('mid complexity: analytical question without code → Qwen', () => {
    const params = baseParams({
      userQuery: 'How does caching work in a typical web stack? What trade-offs matter for latency?',
    });
    const a = analyzeRouting(params);
    expect(a.complexityScore).toBeGreaterThanOrEqual(29);
    expect(a.complexityScore).toBeLessThanOrEqual(45);
    const d = determineRoute(params);
    expect(d.modelTier).toBe('qwen3-235b');
    expect(d.routingDebug.routeStep).toBe('qwen');
  });

  it('high complexity: reasoningDifficulty crosses Opus threshold', () => {
    const kw =
      'analyze research comprehensive detailed analysis evaluate synthesize critique design architect strategy in-depth thorough explain why reasoning implications trade-offs debug this review this code optimize refactor';
    const params = baseParams({ userQuery: kw });
    const a = analyzeRouting(params);
    expect(a.reasoningDifficulty).toBeGreaterThanOrEqual(90);
    const d = determineRoute(params);
    expect(d.modelTier).toBe('opus-4.6');
    expect(d.routingDebug.routeStep).toBe('opus');
  });

  it('code-heavy: mid score with fenced code → DeepSeek (code-mid)', () => {
    const params = baseParams({
      userQuery: '```ts\nfunction foo() { return 1; }\n```\nFix the bug and debug this exception.',
    });
    const a = analyzeRouting(params);
    expect(a.isCodeHeavy).toBe(true);
    expect(a.codeSignals).toBeGreaterThanOrEqual(2);
    const d = determineRoute(params);
    expect(d.modelTier).toBe('deepseek-v3');
    expect(d.routingDebug.routeStep).toBe('code-mid-deepseek');
  });

  it('long context small query: Opus via context + reasoning gate', () => {
    const params = baseParams({
      userQuery:
        'analyze research comprehensive detailed analysis evaluate synthesize critique design architect strategy in-depth thorough implications',
      currentSessionTokens: 125_000,
    });
    const a = analyzeRouting(params);
    expect(a.contextTokens).toBeGreaterThan(120_000);
    expect(a.reasoningDifficulty).toBeGreaterThanOrEqual(70);
    const d = determineRoute(params);
    expect(d.modelTier).toBe('opus-4.6');
    expect(d.routingDebug.matchedBranch).toBe('opus-reasoning-or-context');
  });

  it('multimodal: images + strong text → Gemini Pro when complexity ≥ 75', () => {
    const opusHeavy =
      'analyze research comprehensive detailed analysis evaluate synthesize critique design architect strategy in-depth thorough explain why reasoning implications trade-offs debug this review this code optimize refactor';
    const img: ImageAttachment[] = [{ data: 'a', mediaType: 'image/jpeg' }];
    const params = baseParams({
      userQuery: `${opusHeavy} compare these UI screenshots versus the mockups`,
      images: img,
    });
    const a = analyzeRouting(params);
    expect(a.hasImages).toBe(true);
    expect(a.multimodalLoad).toBeGreaterThanOrEqual(1);
    expect(a.complexityScore).toBeGreaterThanOrEqual(75);
    const d = determineRoute(params);
    expect(d.modelTier).toBe('gemini-3.1-pro');
    expect(d.routingDebug.routeStep).toBe('images-pro');
  });
});
