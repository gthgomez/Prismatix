// production_routing.ts
// Production chat routing: OpenCode discovery + curated role resolution.
// When OpenCode is primary, routing fails closed on discovery/resolution failure
// instead of silently falling through to legacy direct providers.

import { fetchDiscoveredModelIds } from './opencode_discovery.ts';
import {
  determineRoute,
  type RouteDecision,
  type RouterModel,
  type RouterParams,
} from './router_logic.ts';

export const DEFAULT_OPENCODE_BASE_URL = 'https://opencode.ai/zen/v1';

export interface ProductionRoutingOptions {
  openCodePrimary: boolean;
  openCodeApiKey?: string;
  openCodeBaseUrl?: string;
}

/**
 * Resolves the production route for a chat request.
 * When OpenCode is primary, live model discovery gates curated OpenCode targets;
 * discovery failure or an empty intersection throws ModelUnavailableError (fail
 * closed) rather than silently falling through to legacy direct providers.
 */
export async function resolveProductionRoute(
  params: RouterParams,
  modelOverride: RouterModel | undefined,
  options: ProductionRoutingOptions,
): Promise<RouteDecision> {
  let discoveredModelIds: Set<string> | undefined;

  if (options.openCodePrimary && options.openCodeApiKey) {
    discoveredModelIds = await fetchDiscoveredModelIds(
      options.openCodeApiKey,
      options.openCodeBaseUrl ?? DEFAULT_OPENCODE_BASE_URL,
    );
  }

  return determineRoute(
    params,
    modelOverride,
    options.openCodePrimary,
    discoveredModelIds,
  );
}
