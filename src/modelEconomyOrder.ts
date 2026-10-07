import { PRICING_REGISTRY } from './pricingRegistry';
import { MODEL_CATALOG } from './modelCatalog';
import type { RouterModel } from './types';

export type ListedOutputSort = 'asc' | 'desc';

/**
 * Catalog entries that also have pricing, ordered by **listed output USD per 1M tokens**
 * (primary), then input $/M (tie-break). This is a catalog / UX ordering signal, not provider API
 * rank. Priced-but-uncataloged keys are excluded: the picker renders catalog entries only, and an
 * uncataloged key would crash `MODEL_CATALOG[id]` consumers.
 */
export function getRouterModelOrderByListedOutputUsdPerM(sort: ListedOutputSort): RouterModel[] {
  const keys = (Object.keys(PRICING_REGISTRY) as RouterModel[]).filter(
    (key) => key in MODEL_CATALOG,
  );
  const mul = sort === 'asc' ? 1 : -1;
  keys.sort((a, b) => {
    const oa = PRICING_REGISTRY[a]?.outputRatePer1M ?? 0;
    const ob = PRICING_REGISTRY[b]?.outputRatePer1M ?? 0;
    if (oa !== ob) return (oa - ob) * mul;
    const ia = PRICING_REGISTRY[a]?.inputRatePer1M ?? 0;
    const ib = PRICING_REGISTRY[b]?.inputRatePer1M ?? 0;
    return (ia - ib) * mul;
  });
  return keys;
}
