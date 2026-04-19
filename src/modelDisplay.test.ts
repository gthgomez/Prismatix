import { describe, expect, it } from 'vitest';
import { assistantModelPillDisplay } from './modelDisplay';

describe('assistantModelPillDisplay', () => {
  it('uses catalog shortName when model is in catalog', () => {
    const r = assistantModelPillDisplay({
      model: 'sonnet-4.6',
      modelId: 'claude-sonnet-4-6',
    });
    expect(r.label).toBe('Sonnet 4.6');
    expect(r.title).toContain('Claude Sonnet 4.6');
    expect(r.title).toContain('claude-sonnet-4-6');
  });

  it('returns empty when no model', () => {
    expect(assistantModelPillDisplay({})).toEqual({ label: '', title: '' });
  });
});
