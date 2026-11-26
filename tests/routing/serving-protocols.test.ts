import { describe, expect, it, vi } from 'vitest';
import type { ServingRoute } from '../../supabase/functions/_shared/serving_routes.ts';
import { dispatchServingRoute } from '../../supabase/functions/router/provider_stream.ts';
import { createUsageTracker } from '../../supabase/functions/router/usage.ts';

const openAI: ServingRoute = {
  id: 'openai:gpt-6.2-sol', provider: 'openai', upstreamId: 'gpt-6.2-sol',
  canonicalId: 'gpt-6.2-sol', developer: 'OpenAI', name: 'GPT 6.2 Sol', protocol: 'responses',
  contextWindow: 1050000, maxOutputTokens: 128000, supportsImages: true, supportsTools: true, supportsReasoning: true,
  tariff: { version: 'test', source: 'fixture', inputPerMillion: 2, outputPerMillion: 10, billing: 'pay_as_you_go' },
};

const request = {
  route: openAI, apiKey: 'fixture-key', messages: [{ role: 'user' as const, content: 'hello' }],
  images: [{ data: 'AA==', mediaType: 'image/png' }], outputCap: 256,
  signal: new AbortController().signal, getEnv: () => undefined,
};

describe('serving protocol dispatch', () => {
  it('sends GPT 6.2 to Responses with typed image input and extracts only answer deltas', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response());
    const result = await dispatchServingRoute({ ...request, fetchFn });
    const [url, options] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options?.redirect).toBe('error');
    expect(JSON.parse(String(options?.body))).toEqual({
      model: 'gpt-6.2-sol', stream: true, max_output_tokens: 256, store: false,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }, { type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'auto' }] }],
    });
    expect(result.extractDeltas({ type: 'response.output_text.delta', delta: 'yes' })).toEqual(['yes']);
    expect(result.extractDeltas({ type: 'response.reasoning_summary_text.delta', delta: 'private' })).toEqual([]);
  });
  it('uses the Command Code product endpoint and bearer authentication for Messages', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response());
    const route = { ...openAI, provider: 'commandcode' as const, protocol: 'anthropic_messages' as const, upstreamId: 'claude-sonnet-4-6' };
    await dispatchServingRoute({ ...request, route, fetchFn });
    const [url, options] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.commandcode.ai/provider/v1/messages');
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer fixture-key');
    expect(JSON.parse(String(options?.body))).toMatchObject({ model: 'claude-sonnet-4-6', max_tokens: 256 });
  });
  it('does not send fixture credentials to a configured destination in a hosted stack', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const getEnv = (key: string) => key === 'SUPABASE_URL' ? 'https://hosted.supabase.co' : 'http://127.0.0.1:8899';
    await expect(dispatchServingRoute({ ...request, fetchFn, getEnv })).rejects.toThrow('provider_fixture_requires_local_stack');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('normalizes Responses usage, including cached input and reasoning subsets', () => {
    const tracker = createUsageTracker('openai', 'responses');
    tracker.observe({ type: 'response.completed', response: { usage: {
      input_tokens: 100, input_tokens_details: { cached_tokens: 60 }, output_tokens: 30,
      output_tokens_details: { reasoning_tokens: 20 },
    } } });
    expect(tracker.usage()).toEqual({ inputTokens: 100, cachedReadTokens: 60, outputTokens: 10, thinkingTokens: 20 });
  });
});
