// Type declarations for the dependency-free scripts/verify-catalog.mjs drift gate.
export interface VerifyCatalogOptions {
  root?: string;
  today?: string;
  prices?: unknown;
  approved?: unknown;
  serverRegistry?: Record<string, unknown>;
  frontendRegistry?: Record<string, unknown>;
  serverVersion?: string;
  frontendVersion?: string;
  autoPolicy?: Record<string, { primary: string; fallback: string[] }>;
  serverRegistrySource?: string;
  frontendRegistrySource?: string;
  modelsHubSource?: string;
}

export interface VerifyCatalogResult {
  ok: boolean;
  violations: string[];
}

export function verifyCatalog(options?: VerifyCatalogOptions): VerifyCatalogResult;
