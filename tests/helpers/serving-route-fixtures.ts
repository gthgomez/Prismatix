import { servingRouteId, type InferenceProviderId, type ServingRoute } from '../../supabase/functions/_shared/serving_routes.ts';

export function servingRouteFixture(provider: InferenceProviderId = 'openai', model = 'gpt-6.2-sol'): ServingRoute {
  const protocol = provider === 'openai' ? 'responses'
    : provider === 'anthropic' ? 'anthropic_messages'
    : provider === 'google' ? 'google_generate_content' : 'chat_completions';
  return {
    id: servingRouteId(provider, model), provider, upstreamId: model, canonicalId: model, developer: provider,
    name: model, protocol, contextWindow: 100000, maxOutputTokens: 4096, supportsImages: true,
    supportsReasoning: true, supportsTools: true,
    tariff: { version: 'fixture', source: 'fixture', inputPerMillion: 2, outputPerMillion: 10, billing: 'pay_as_you_go' },
  };
}

export function providerRow(route: ServingRoute, enabled = true, revision = 'fixture-revision') {
  const now = new Date().toISOString();
  return {
    provider: route.provider, enabled, has_key: true, credential_revision: revision,
    inventory: { status: 'verified', discoveredAt: now, checkedAt: now, modelCount: 1, routes: [route] },
  };
}
