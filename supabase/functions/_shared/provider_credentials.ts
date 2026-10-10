// provider_credentials.ts — maps each provider plug-in to its deployment-wide
// secret env var. Keep in sync with PROVIDER_PLUGINS in provider_registry.ts.

import type { ProviderId } from './provider_registry.ts';

export const PROVIDER_KEY_ENV: Record<ProviderId, string> = {
  opencode: 'OPENCODE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  deepinfra: 'DEEPINFRA_API_KEY',
};

/** True when the deployment provides a server-side key for this provider. */
export function serverHasProviderKey(
  provider: ProviderId,
  getEnv: (key: string) => string | undefined,
): boolean {
  const raw = getEnv(PROVIDER_KEY_ENV[provider]);
  return typeof raw === 'string' && raw.trim() !== '';
}
