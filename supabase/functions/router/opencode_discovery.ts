// opencode_discovery.ts
// Dynamic model discovery for OpenCode Zen/Console with scoped TTL caching and fail-safe fallback.

const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedDiscovery {
  modelIds: Set<string>;
  discoveredAt: number;
}

// Scoped cache map keyed by endpoint + credential scope
const discoveryCache = new Map<string, CachedDiscovery>();

function getCacheKey(openCodeApiKey?: string, openCodeBaseUrl: string = 'https://opencode.ai/zen/v1'): string {
  const keyTail = openCodeApiKey ? openCodeApiKey.slice(-8) : 'anon';
  return `${openCodeBaseUrl}::${keyTail}`;
}

export async function fetchDiscoveredModelIds(
  openCodeApiKey?: string,
  openCodeBaseUrl: string = 'https://opencode.ai/zen/v1',
): Promise<Set<string>> {
  const cacheKey = getCacheKey(openCodeApiKey, openCodeBaseUrl);
  const now = Date.now();
  const cached = discoveryCache.get(cacheKey);

  if (cached && now - cached.discoveredAt < DISCOVERY_CACHE_TTL_MS) {
    return cached.modelIds;
  }

  if (!openCodeApiKey) {
    // If no credentials provided, return empty set (fail closed, do NOT assume models exist)
    return new Set<string>();
  }

  try {
    const res = await fetch(`${openCodeBaseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${openCodeApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      console.warn(
        `[OpenCode Discovery] HTTP ${res.status} when fetching models; falling back to scoped cache or failing closed`,
      );
      return cached?.modelIds ?? new Set<string>();
    }

    const data = await res.json();
    const rawList = Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.models)
      ? data.models
      : [];
    const discoveredIds = new Set<string>();

    for (const item of rawList) {
      const id = typeof item === 'string' ? item : item?.id || item?.name;
      if (typeof id === 'string' && id.trim()) {
        discoveredIds.add(id.trim());
      }
    }

    discoveryCache.set(cacheKey, {
      modelIds: discoveredIds,
      discoveredAt: now,
    });

    return discoveredIds;
  } catch (err) {
    console.warn('[OpenCode Discovery] Error fetching models; failing closed:', err);
    return cached?.modelIds ?? new Set<string>();
  }
}

export function resetDiscoveryCacheForTests(): void {
  discoveryCache.clear();
}
