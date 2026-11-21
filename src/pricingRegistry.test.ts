import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCostBreakdown } from './costEngine';
import { formatModelPriceLabel } from './modelCatalog';
import { getPricingForModel } from './pricingRegistry';

const legacyModel = 'gemini-2.5-flash';

describe('frontend legacy pricing freshness', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-21T12:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('fails closed for stale legacy rates without calling them expired', () => {
    const stale = getPricingForModel(legacyModel, new Date('2026-11-21T12:00:00Z'));
    const current = getPricingForModel('gpt-6-sol', new Date('2026-11-21T12:00:00Z'));

    expect(stale.isUnknown).toBe(true);
    expect(stale.isStale).toBe(true);
    expect(stale.isExpired).toBeFalsy();
    expect(stale.inputRatePer1M).toBe(0);
    expect(stale.outputRatePer1M).toBe(0);
    expect(formatModelPriceLabel(legacyModel)).toContain('review');
    expect(current.isUnknown).toBeFalsy();

    const breakdown = calculateCostBreakdown(legacyModel, { promptTokens: 1000, completionTokens: 500 });
    expect(breakdown.hasUnknownRate).toBe(true);
    expect(breakdown.totalCost).toBe(0);
  });

  it('allows legacy rates inside the 60-day verification window', () => {
    const withinWindow = getPricingForModel(legacyModel, new Date('2026-05-01T00:00:00Z'));
    expect(withinWindow.isUnknown).toBeFalsy();
    expect(withinWindow.isStale).toBeFalsy();
    expect(withinWindow.inputRatePer1M).toBeGreaterThan(0);
  });
});
