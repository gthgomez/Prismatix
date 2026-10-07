// catalogSkew.ts — client-side model-catalog skew detection.
//
// The router stamps every response with its release identity (PX02):
// X-Prismatix-Tariff carries the server's PRICING_VERSION. When it differs
// from the version bundled into this client, routing decisions and listed
// prices may reflect a different catalog than the UI shows. Unknown model
// ids render via the catalog fallback; this flag is only the visible hint.

import { PRICING_VERSION } from './pricingRegistry';

let serverTariffVersion: string | null = null;
const listeners = new Set<() => void>();

/** Record the tariff version observed on a router response. */
export function noteServerTariffVersion(version: string | null | undefined): void {
  const next = version || null;
  if (next === serverTariffVersion) return;
  serverTariffVersion = next;
  for (const listener of listeners) listener();
}

/** True when a server response has been seen with a different tariff version. */
export function isCatalogSkewed(): boolean {
  return serverTariffVersion !== null && serverTariffVersion !== PRICING_VERSION;
}

/** The server tariff version last observed, if any. */
export function getServerTariffVersion(): string | null {
  return serverTariffVersion;
}

/** The client's own tariff version (re-exported for consumers). */
export const CLIENT_TARIFF_VERSION = PRICING_VERSION;

export function subscribeCatalogSkew(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
