import { describe, expect, it } from 'vitest';
import { selectAuthorizedRoute } from '../../supabase/functions/router/authorized_routing.ts';
import { createProviderResolver } from '../../supabase/functions/router/provider_resolver.ts';
import { providerRow, servingRouteFixture } from '../helpers/serving-route-fixtures.ts';

const options = {
  params: { userQuery: 'hello', currentSessionTokens: 0, platform: 'mobile' as const, history: [] },
  contextText: 'hello', imageCount: 0, additionalPromptTokens: 0, maximumCostUsd: 0.1,
};

describe('production provider eligibility', () => {
  it('routes a mobile chat through the requested account’s sole authorized OpenAI connection', () => {
    const openai = servingRouteFixture();
    const google = servingRouteFixture('google', 'gemini-3.8-flash');
    const resolver = createProviderResolver({ providers: [providerRow(openai), providerRow(google, false)] }, { globalEnabled: () => true });
    expect(selectAuthorizedRoute(resolver.eligibleRoutes(), options)).toMatchObject({ ok: true, decision: { servingRoute: openai } });
  });

  it('does not let a paying gateway connection prove a specific model entitlement', () => {
    const openrouter = servingRouteFixture('openrouter', 'openai/gpt-6-luna');
    const resolver = createProviderResolver({ providers: [providerRow(openrouter)] }, { globalEnabled: () => true });
    const manual = 'openrouter:openai/gpt-6.2-sol';
    expect(selectAuthorizedRoute(resolver.eligibleRoutes(), { ...options, manual })).toMatchObject({ ok: false, code: 'route_unavailable' });
  });
});
