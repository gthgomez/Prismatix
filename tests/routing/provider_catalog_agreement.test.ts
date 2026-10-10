import { describe, expect, it } from 'vitest';
import { MODEL_CATALOG, getCatalogEntry } from '../../src/modelCatalog';
import { MODEL_REGISTRY } from '../../supabase/functions/router/router_logic.ts';
import { OPENROUTER_MODEL_MAP } from '../../supabase/functions/_shared/provider_registry.ts';

describe('client/server catalog agreement', () => {
  it('every OpenRouter route targets a cataloged model whose provider agrees', () => {
    for (const [modelId, openRouterId] of Object.entries(OPENROUTER_MODEL_MAP)) {
      expect(typeof openRouterId).toBe('string');
      expect(openRouterId.length).toBeGreaterThan(0);

      const serverCfg = MODEL_REGISTRY[modelId];
      expect(serverCfg, `missing MODEL_REGISTRY entry for '${modelId}'`).toBeDefined();

      const clientEntry = MODEL_CATALOG[modelId as keyof typeof MODEL_CATALOG];
      expect(clientEntry, `missing MODEL_CATALOG entry for '${modelId}'`).toBeDefined();
      expect(clientEntry.provider).toBe(serverCfg!.provider);
    }
  });

  it('every server model tier is present in the client catalog', () => {
    for (const tier of Object.keys(MODEL_REGISTRY)) {
      expect(getCatalogEntry(tier)).toBe(MODEL_CATALOG[tier as keyof typeof MODEL_CATALOG]);
    }
  });
});
