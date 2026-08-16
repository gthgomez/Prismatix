// opencode_discovery.ts
// Dynamic model discovery for OpenCode Zen/Console with TTL caching.

import { CURATED_OPENCODE_REGISTRY } from './models_hub.ts';

const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedDiscovery {
  modelIds: Set<string>;
  discoveredAt: number;
}

let cachedDiscovery: CachedDiscovery | null = null;

export async function fetchDiscoveredModelIds(
  openCodeApiKey?: string,
  openCodeBaseUrl: string = 'https://opencode.ai/zen/v1',
): Promise<Set<string>> {
  const now = Date.now();
  if (cachedDiscovery && (now - cachedDiscovery.discoveredAt) < DISCOVERY_CACHE_TTL_MS) {
    return cachedDiscovery.modelIds;
  }

  if (!openCodeApiKey) {
    // If no key provided, return all known curated IDs for offline/mock fallback
    return new Set(Object.keys(CURATED_OPENCODE_REGISTRY));
  }

  try {
    const res = await fetch(`${openCodeBaseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${openCodeApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      console.warn(`[OpenCode Discovery] HTTP ${res.status} when fetching models; using cached/curated set`);
      return cachedDiscovery?.modelIds ?? new Set(Object.keys(CURATED_OPENCODE_REGISTRY));
    }

    const data = await res.json();
    const rawList = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []);
    const discoveredIds = new Set<string>();

    for (const item of rawList) {
      const id = typeof item === 'string' ? item : (item?.id || item?.name);
      if (typeof id === 'string' && id.trim()) {
        discoveredIds.add(id.trim());
      }
    }

    cachedDiscovery = {
      modelIds: discoveredIds,
      discoveredAt: now,
    };

    return discoveredIds;
  } catch (err) {
    console.warn('[OpenCode Discovery] Error fetching models:', err);
    return cachedDiscovery?.modelIds ?? new Set(Object.keys(CURATED_OPENCODE_REGISTRY));
  }
}

export function resetDiscoveryCacheForTests(): void {
  cachedDiscovery = null;
}
