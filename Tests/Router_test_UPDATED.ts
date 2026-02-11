import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { determineRoute, type RouterParams } from '../supabase/functions/router/router_logic.ts';

function params(
  userQuery: string,
  currentSessionTokens = 0,
  platform: 'web' | 'mobile' = 'web',
): RouterParams {
  return { userQuery, currentSessionTokens, platform, history: [] };
}

Deno.test('Router: defaults to Sonnet for normal web queries', () => {
  const decision = determineRoute(params('Hello, world!', 0, 'web'));
  assertEquals(decision.modelTier, 'sonnet-4.5');
  assertEquals(decision.rationaleTag, 'default-balanced');
});

Deno.test('Router: routes to Opus for very large context', () => {
  const decision = determineRoute(params('Summarize.', 155000, 'web'));
  assertEquals(decision.modelTier, 'opus-4.5');
  assertEquals(decision.rationaleTag, 'high-complexity');
});
