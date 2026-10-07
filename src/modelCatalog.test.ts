import { describe, expect, it } from 'vitest';
import {
  MODEL_CATALOG,
  MODEL_HIGHLIGHTS,
  MODEL_ORDER,
  formatModelPriceLabel,
  getCatalogEntry,
  isKnownModel,
} from './modelCatalog';
import { PRICING_REGISTRY } from './pricingRegistry';

describe('getCatalogEntry (unknown-model fallback)', () => {
  it('returns the fallback entry for an unknown model id', () => {
    const entry = getCatalogEntry('totally-made-up-model');
    expect(entry.name).toBe('Unknown model');
    expect(entry.icon).toBe('❔');
    expect(entry.color).toBe('#8b949e');
    expect(entry.description).toBe('Not in local catalog');
  });

  it('returns the real entry for a known id', () => {
    const [knownId] = Object.keys(MODEL_CATALOG);
    if (!knownId) throw new Error('expected non-empty catalog');
    expect(getCatalogEntry(knownId)).toBe(MODEL_CATALOG[knownId as keyof typeof MODEL_CATALOG]);
  });

  it('isKnownModel discriminates catalog membership', () => {
    expect(isKnownModel('gemini-2.5-flash')).toBe(true);
    expect(isKnownModel('totally-made-up-model')).toBe(false);
  });
});

describe('model order / picker integrity', () => {
  it('MODEL_ORDER never contains an uncataloged id (picker renders entries only)', () => {
    for (const id of MODEL_ORDER) {
      expect(MODEL_CATALOG[id as keyof typeof MODEL_CATALOG]).toBeDefined();
    }
  });

  it('MODEL_HIGHLIGHTS are cataloged and priced', () => {
    for (const id of MODEL_HIGHLIGHTS) {
      expect(MODEL_CATALOG[id]).toBeDefined();
      expect(PRICING_REGISTRY[id]).toBeDefined();
    }
  });

  it('every orderable model produces a price label', () => {
    for (const id of MODEL_ORDER) {
      const label = formatModelPriceLabel(id);
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
