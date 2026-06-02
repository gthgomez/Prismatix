import { PRICING_REGISTRY } from './pricingRegistry';
import type { RouterModel } from './types';

export type ListedOutputSort = 'asc' | 'desc';

/**
 * All `RouterModel` keys from `PRICING_REGISTRY`, ordered by **listed output USD per 1M tokens**
 * (primary), then input $/M (tie-break). This is a catalog / UX ordering signal, not provider API rank.
 */
export function getRouterModelOrderByListedOutputUsdPerM(sort: ListedOutputSort): RouterModel[] {
  const keys = Object.keys(PRICING_REGISTRY) as RouterModel[];
  const mul = sort === 'asc' ? 1 : -1;
  keys.sort((a, b) => {
    const oa = PRICING_REGISTRY[a].outputRatePer1M;
    const ob = PRICING_REGISTRY[b].outputRatePer1M;
    if (oa !== ob) return (oa - ob) * mul;
    const ia = PRICING_REGISTRY[a].inputRatePer1M;
    const ib = PRICING_REGISTRY[b].inputRatePer1M;
    return (ia - ib) * mul;
  });
  return keys;
}
