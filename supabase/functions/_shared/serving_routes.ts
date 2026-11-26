import type { ProviderId } from './provider_registry.ts';

export type InferenceProviderId = Exclude<ProviderId, 'brave'>;
export type InferenceProtocol = 'chat_completions' | 'responses' | 'anthropic_messages' | 'google_generate_content';
export type BillingArrangement = 'pay_as_you_go' | 'prepaid_credits' | 'subscription_allowance' | 'unknown';

export interface RouteTariff {
  version: string;
  source: string;
  expiresAt?: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cachedReadPerMillion?: number;
  cachedWritePerMillion?: number;
  reasoningPerMillion?: number;
  requestUsd?: number;
  /** Conservative cash rates also apply when an allowance can spill into paid usage. */
  billing: Exclude<BillingArrangement, 'unknown'>;
}

/** Exact, client-safe route. Provider responses never supply an endpoint or credential. */
export interface ServingRoute {
  id: string;
  provider: InferenceProviderId;
  upstreamId: string;
  canonicalId: string;
  developer: string;
  name: string;
  protocol: InferenceProtocol;
  contextWindow: number;
  maxOutputTokens: number;
  supportsImages: boolean;
  supportsTools: boolean;
  supportsReasoning: boolean;
  tariff: RouteTariff;
}

export function servingRouteId(provider: InferenceProviderId, upstreamId: string): string {
  return `${provider}:${upstreamId}`;
}

export type InventoryStatus = 'verified' | 'unverified' | 'unavailable' | 'invalid_revoked' | 'restricted';

/** Snapshot fields stored beside the encrypted key and returned through the scoped configuration RPC. */
export interface ProviderInventory {
  status: InventoryStatus;
  discoveredAt: string | null;
  checkedAt: string;
  modelCount: number;
  routes: ServingRoute[];
  restrictedRouteIds?: string[];
}

export const INVENTORY_FRESHNESS_MS = 24 * 60 * 60 * 1000;

export function isCurrentRouteTariff(tariff: RouteTariff | null | undefined, now = Date.now()): boolean {
  return Boolean(tariff?.version && tariff.source &&
    (tariff.expiresAt === undefined || Date.parse(tariff.expiresAt) > now));
}

export function isCurrentInventory(inventory: ProviderInventory | null | undefined, now = Date.now()): inventory is ProviderInventory {
  if (inventory?.status !== 'verified' || !inventory.discoveredAt) return false;
  const age = now - Date.parse(inventory.discoveredAt);
  return age >= 0 && age <= INVENTORY_FRESHNESS_MS;
}
