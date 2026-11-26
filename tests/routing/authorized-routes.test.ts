import { describe, expect, it } from 'vitest';
import { servingRouteId, type ServingRoute } from '../../supabase/functions/_shared/serving_routes.ts';
import { selectAuthorizedRoute } from '../../supabase/functions/router/authorized_routing.ts';

const openAI: ServingRoute = {
  id: servingRouteId('openai', 'gpt-6-sol'), provider: 'openai', upstreamId: 'gpt-6-sol',
  canonicalId: 'gpt-6-sol', developer: 'OpenAI', name: 'GPT 6 Sol', protocol: 'responses',
  contextWindow: 100_000, maxOutputTokens: 4_096, supportsImages: true, supportsTools: true,
  supportsReasoning: true,
  tariff: { version: 'fixture-v1', source: 'fixture', inputPerMillion: 2, outputPerMillion: 10, billing: 'pay_as_you_go' },
};
const gateway: ServingRoute = {
  ...openAI, id: 'openrouter:openai/gpt-6-sol', provider: 'openrouter', upstreamId: 'openai/gpt-6-sol',
  protocol: 'chat_completions', tariff: { ...openAI.tariff, inputPerMillion: 4 },
};
const options = {
  params: { userQuery: 'hello', currentSessionTokens: 0, platform: 'mobile' as const, history: [] },
  contextText: 'user: hello', imageCount: 0, additionalPromptTokens: 0, maximumCostUsd: 0.1,
};

describe('authorized route selection', () => {
  it.each(['economy', 'balanced', 'capability'] as const)('uses the OpenAI-only inventory in %s mode', (profile) => {
    expect(selectAuthorizedRoute([openAI], { ...options, profile })).toMatchObject({
      ok: true, decision: { provider: 'openai', model: 'gpt-6-sol', servingRoute: openAI },
    });
  });
  it('uses the exact selected serving provider when several serve the model', () => {
    expect(selectAuthorizedRoute([openAI, gateway], { ...options, manual: gateway.id })).toMatchObject({
      ok: true, decision: { provider: 'openrouter', model: 'openai/gpt-6-sol', servingRoute: gateway },
    });
  });
  it('will not substitute an inaccessible route with the same model elsewhere', () => {
    expect(selectAuthorizedRoute([openAI], { ...options, manual: gateway.id })).toMatchObject({ ok: false, code: 'route_unavailable' });
  });
  it('requires a route choice when a legacy canonical selection is ambiguous', () => {
    expect(selectAuthorizedRoute([openAI, gateway], { ...options, manual: openAI.canonicalId })).toMatchObject({ ok: false, code: 'route_selection_required' });
  });
  it('excludes routes unable to process images', () => {
    expect(selectAuthorizedRoute([{ ...openAI, supportsImages: false }], { ...options, imageCount: 1 })).toMatchObject({ ok: false, code: 'modality_mismatch' });
  });
  it('checks budget before applying route preference or ranking', () => {
    expect(selectAuthorizedRoute([openAI, gateway], { ...options, maximumCostUsd: 0.000001, preferredProvider: 'openrouter' })).toMatchObject({ ok: false, code: 'request_cost_limit_exceeded' });
  });
  it('uses the preferred authorized provider to break a tie in Auto mode', () => {
    const sameCost = { ...gateway, tariff: openAI.tariff };
    expect(selectAuthorizedRoute([openAI, sameCost], { ...options, preferredProvider: 'openrouter' })).toMatchObject({
      ok: true, decision: { servingRoute: sameCost },
    });
  });

  it('admits an exact new identifier with qualified metadata without a static registry entry', () => {
    const newRoute = { ...openAI, id: 'openai:new-version', upstreamId: 'new-version', canonicalId: 'openai/new-version' };
    expect(selectAuthorizedRoute([newRoute], { ...options, manual: newRoute.id })).toMatchObject({ ok: true, decision: { model: newRoute.upstreamId } });
  });
});
