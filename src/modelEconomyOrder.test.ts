import { describe, expect, it } from 'vitest';
import { PRICING_REGISTRY } from './pricingRegistry';
import { getRouterModelOrderByListedOutputUsdPerM } from './modelEconomyOrder';

describe('getRouterModelOrderByListedOutputUsdPerM', () => {
  it('ascending puts minimum listed output first and Opus last', () => {
    const asc = getRouterModelOrderByListedOutputUsdPerM('asc');
    expect(asc.length).toBeGreaterThan(0);
    const first = asc[0];
    const last = asc[asc.length - 1];
    if (!first || !last) throw new Error('expected non-empty order');
    const minOut = Math.min(...Object.values(PRICING_REGISTRY).map((p) => p.outputRatePer1M));
    expect(PRICING_REGISTRY[first].outputRatePer1M).toBe(minOut);
    expect(last).toBe('opus-4.6');
    for (let i = 1; i < asc.length; i++) {
      const pk = asc[i - 1];
      const ck = asc[i];
      if (!pk || !ck) continue;
      const prev = PRICING_REGISTRY[pk];
      const cur = PRICING_REGISTRY[ck];
      expect(
        prev.outputRatePer1M < cur.outputRatePer1M ||
          (prev.outputRatePer1M === cur.outputRatePer1M && prev.inputRatePer1M <= cur.inputRatePer1M),
      ).toBe(true);
    }
  });

  it('descending puts Opus first', () => {
    const desc = getRouterModelOrderByListedOutputUsdPerM('desc');
    const head = desc[0];
    if (!head) throw new Error('expected non-empty order');
    expect(head).toBe('opus-4.6');
    expect(desc[desc.length - 1]).toBeDefined();
  });

  it('includes all pricing registry models', () => {
    const asc = getRouterModelOrderByListedOutputUsdPerM('asc');
    const registryKeys = Object.keys(PRICING_REGISTRY).sort();
    expect([...asc].sort()).toEqual(registryKeys);
  });
});
