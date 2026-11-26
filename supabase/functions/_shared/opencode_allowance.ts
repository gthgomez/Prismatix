import type { InventoryStatus } from './serving_routes.ts';

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Account-level Go meters, separate from the model list and prices. */
export async function checkOpenCodeGoAllowance(apiKey: string, fetchFn: typeof fetch, fixtureBase?: string): Promise<InventoryStatus> {
  try {
    const response = await fetchFn(fixtureBase ? `${fixtureBase}/usage` : 'https://opencode.ai/inference/go/v1/usage', {
      headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401) return 'invalid_revoked';
    if ([402, 403, 404].includes(response.status)) return 'restricted';
    if (!response.ok) return response.status >= 500 || response.status === 429 ? 'unavailable' : 'unverified';
    const usage = object(object(await response.json())?.usage);
    const meters = ['rolling', 'weekly', 'monthly'].map((window) => object(usage?.[window]));
    if (meters.some((meter) => !meter || !['ok', 'rate-limited'].includes(String(meter.status)))) return 'unverified';
    if (meters.some((meter) => meter?.status === 'rate-limited' || typeof meter?.percent !== 'number' ||
      !Number.isFinite(meter.percent) || meter.percent < 0 || meter.percent >= 100)) return 'restricted';
    return 'verified';
  } catch {
    return 'unavailable';
  }
}
