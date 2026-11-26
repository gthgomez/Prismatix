import type { InferenceProtocol, InferenceProviderId, ServingRoute } from './serving_routes.ts';

type GetEnv = (key: string) => string | undefined;

const OPERATOR_FLAGS: Record<InferenceProviderId, readonly [string, boolean]> = {
  opencode: ['ENABLE_OPENCODE', true],
  opencode_go: ['ENABLE_OPENCODE_GO', true],
  commandcode: ['ENABLE_COMMANDCODE', true],
  openrouter: ['ENABLE_OPENROUTER', true],
  anthropic: ['ENABLE_ANTHROPIC', true],
  openai: ['ENABLE_OPENAI', true],
  google: ['ENABLE_GOOGLE', true],
  nvidia: ['ENABLE_NVIDIA', true],
  deepinfra: ['ENABLE_DEEPINFRA', false],
};

export function inferenceProviderEnabled(provider: InferenceProviderId, getEnv: GetEnv): boolean {
  const [name, defaultValue] = OPERATOR_FLAGS[provider];
  const flag = getEnv(name)?.trim().toLowerCase();
  if (flag && ['1', 'true', 'yes', 'on'].includes(flag)) return true;
  if (flag && ['0', 'false', 'no', 'off'].includes(flag)) return false;
  return defaultValue;
}

/** Synthetic provider destinations are usable only by a local Supabase stack. */
export function qualificationProviderBase(provider: InferenceProviderId, getEnv: GetEnv): string | undefined {
  const override = getEnv('PRISMATIX_QUAL_PROVIDER_BASE_URL');
  if (!override) return undefined;
  const stack = new URL(getEnv('SUPABASE_URL') ?? 'https://invalid.example');
  const isLocalStack = stack.protocol === 'http:' && (
    ['127.0.0.1', 'localhost', '[::1]', 'kong'].includes(stack.hostname) ||
    /^supabase_kong_[\w-]+$/.test(stack.hostname)
  );
  if (!isLocalStack) throw new Error('provider_fixture_requires_local_stack');
  const url = new URL(override);
  const localAddress = ['127.0.0.1', 'localhost', '[::1]', 'host.docker.internal'].includes(url.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(url.hostname);
  if (url.protocol !== 'http:' || !localAddress || url.port !== '8899' || url.pathname !== '/' ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('provider_fixture_destination_invalid');
  }
  return `${url.origin}/${provider}/v1`;
}

const BASES: Record<InferenceProviderId, Partial<Record<InferenceProtocol, string>>> = {
  openai: {
    chat_completions: 'https://api.openai.com/v1',
    responses: 'https://api.openai.com/v1',
  },
  openrouter: { chat_completions: 'https://openrouter.ai/api/v1' },
  anthropic: { anthropic_messages: 'https://api.anthropic.com/v1' },
  google: { google_generate_content: 'https://generativelanguage.googleapis.com/v1beta' },
  nvidia: { chat_completions: 'https://integrate.api.nvidia.com/v1' },
  deepinfra: { chat_completions: 'https://api.deepinfra.com/v1/openai' },
  commandcode: {
    chat_completions: 'https://api.commandcode.ai/provider/v1',
    responses: 'https://api.commandcode.ai/provider/v1',
    anthropic_messages: 'https://api.commandcode.ai/provider/v1',
  },
  opencode: {
    chat_completions: 'https://opencode.ai/inference/openai/v1',
    responses: 'https://opencode.ai/inference/openai/v1',
    anthropic_messages: 'https://opencode.ai/inference/anthropic/v1',
    google_generate_content: 'https://opencode.ai/inference/google/v1beta',
  },
  opencode_go: {
    chat_completions: 'https://opencode.ai/inference/go/openai/v1',
    responses: 'https://opencode.ai/inference/go/openai/v1',
    anthropic_messages: 'https://opencode.ai/inference/go/anthropic/v1',
    google_generate_content: 'https://opencode.ai/inference/go/google/v1beta',
  },
};

export function supportsInferenceProtocol(provider: InferenceProviderId, protocol: InferenceProtocol): boolean {
  return Boolean(BASES[provider]?.[protocol]);
}

export function trustedInferenceEndpoint(route: ServingRoute, getEnv: GetEnv): string {
  const official = BASES[route.provider]?.[route.protocol];
  if (!official) throw new Error('unsupported_provider_protocol');
  const base = qualificationProviderBase(route.provider, getEnv) ?? official;
  switch (route.protocol) {
    case 'chat_completions': return `${base}/chat/completions`;
    case 'responses': return `${base}/responses`;
    case 'anthropic_messages': return `${base}/messages`;
    case 'google_generate_content': return `${base}/models/${encodeURIComponent(route.upstreamId)}:streamGenerateContent?alt=sse`;
  }
}
