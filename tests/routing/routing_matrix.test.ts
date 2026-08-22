import { describe, expect, it } from 'vitest';
import {
  analyzeRouting,
  determineRoute,
  determineRouteRole,
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
  describe('OpenCode Primary Routing', () => {
    it('low complexity: short casual query → economy role & deepseek-v4-flash', () => {
      const params = baseParams({ userQuery: 'hi' });
      const role = determineRouteRole(params);
      expect(role).toBe('economy');
      const d = determineRoute(params);
      expect(d.modelTier).toBe('deepseek-v4-flash');
      expect(d.routeRole).toBe('economy');
    });

    it('high complexity: reasoning crosses max threshold → max role & gpt-5.6-sol', () => {
      const kw =
        'analyze research comprehensive detailed analysis evaluate synthesize critique design architect strategy in-depth thorough explain why reasoning implications trade-offs debug this review this code optimize refactor';
      const params = baseParams({ userQuery: kw });
      const a = analyzeRouting(params);
      expect(a.reasoningDifficulty).toBeGreaterThanOrEqual(90);
      const d = determineRoute(params);
      expect(d.modelTier).toBe('gpt-5.6-sol');
      expect(d.routeRole).toBe('max');
    });

    it('code-heavy query → code_review role & claude-sonnet-5', () => {
      const params = baseParams({
        userQuery: '```ts\nfunction foo() { return 1; }\nclass ComplexPipeline {\n  constructor(private config: Config) {}\n  execute() { throw new Error("crash"); }\n}\n```\nFix the bug, review this code, optimize performance, and debug this exception in-depth.',
      });
      const d = determineRoute(params);
      expect(d.modelTier).toBe('claude-sonnet-5');
      expect(['code_review', 'strong']).toContain(d.routeRole);
    });

    it('images query → vision_fast role & gemini-3.7-flash', () => {
      const img: ImageAttachment = {
        data: 'fake-base64-bytes',
        mediaType: 'image/png',
      };
      const params = baseParams({
        userQuery: 'What is shown in this screenshot?',
        images: [img],
      });
      const d = determineRoute(params);
      expect(d.modelTier).toBe('gemini-3.7-flash');
      expect(d.routeRole).toBe('vision_fast');
    });
  });

  describe('Legacy Direct Fallback Mode', () => {
    it('low complexity fallback → qwen3-235b', () => {
      const params = baseParams({ userQuery: 'hi' });
      const d = determineRoute(params, undefined, false);
      expect(d.modelTier).toBe('qwen3-235b');
    });

    it('opus fallback when reasoning difficulty crosses threshold', () => {
      const kw =
        'analyze research comprehensive detailed analysis evaluate synthesize critique design architect strategy in-depth thorough explain why reasoning implications trade-offs debug this review this code optimize refactor';
      const params = baseParams({ userQuery: kw });
      const d = determineRoute(params, undefined, false);
      expect(d.modelTier).toBe('opus-4.6');
    });
  });
});
