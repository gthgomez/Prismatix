import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_CHOICES,
  FALLBACK_DEFAULT_PROVIDER,
  PROVIDER_PLUGINS,
  filterVisibleModels,
  isModelVisible,
  providerForModel,
  resolveDefaultProvider,
  resolveEnabledProviderIds,
  type ProviderId,
} from './providerRegistry';
import { MODEL_ORDER } from './modelCatalog';

describe('provider plug-in defaults', () => {
  it('offers exactly opencode + openrouter by default', () => {
    expect(DEFAULT_PROVIDER_CHOICES).toEqual(['opencode', 'openrouter']);
    const offered = Object.values(PROVIDER_PLUGINS)
      .filter((p) => p.offeredByDefault)
      .map((p) => p.id)
      .sort();
    expect(offered).toEqual(['opencode', 'openrouter']);
  });

  it('enables only opencode for a fresh user with no rows', () => {
    expect(resolveDefaultProvider(null)).toBe(FALLBACK_DEFAULT_PROVIDER);
    expect([...resolveEnabledProviderIds(null)]).toEqual(['opencode']);
  });

  it('enables the chosen default gateway when it is openrouter', () => {
    const enabled = resolveEnabledProviderIds({ default_provider: 'openrouter', providers: [] });
    expect([...enabled]).toEqual(['openrouter']);
  });

  it('enables opt-in providers only when their row is on', () => {
    const enabled = resolveEnabledProviderIds({
      default_provider: 'opencode',
      providers: [
        { provider: 'opencode', enabled: true, has_key: false },
        { provider: 'anthropic', enabled: true, has_key: true },
        { provider: 'deepinfra', enabled: false, has_key: true },
      ],
    });
    expect(enabled.has('opencode' as ProviderId)).toBe(true);
    expect(enabled.has('anthropic' as ProviderId)).toBe(true);
    expect(enabled.has('deepinfra' as ProviderId)).toBe(false);
  });
});

describe('model visibility', () => {
  it('maps catalog models to their owning provider', () => {
    expect(providerForModel('deepseek-v4-1-flash')).toBe('opencode');
    expect(providerForModel('opus-4.6')).toBe('anthropic');
    expect(providerForModel('gemini-2.5-flash')).toBe('google');
  });

  it('shows opencode models when only opencode is on', () => {
    const enabled = new Set<ProviderId>(['opencode']);
    expect(isModelVisible('deepseek-v4-1-flash', { enabledProviders: enabled })).toBe(true);
    expect(isModelVisible('opus-4.6', { enabledProviders: enabled })).toBe(false);
  });

  it('unlocks a native provider model when that provider is enabled', () => {
    const enabled = new Set<ProviderId>(['opencode', 'anthropic']);
    expect(isModelVisible('opus-4.6', { enabledProviders: enabled })).toBe(true);
  });

  it('unlocks routed models when openrouter is enabled', () => {
    const enabled = new Set<ProviderId>(['opencode', 'openrouter']);
    expect(isModelVisible('opus-4.6', { enabledProviders: enabled })).toBe(true);
    expect(isModelVisible('gemini-2.5-flash', { enabledProviders: enabled })).toBe(true);
  });

  it('does not unlock a model with no OpenRouter route via openrouter', () => {
    // gemini-3.1-pro has a route; a model without a mapping would stay hidden.
    const enabled = new Set<ProviderId>(['openrouter']);
    const onlyOpencode = filterVisibleModels(MODEL_ORDER, { enabledProviders: enabled });
    for (const id of onlyOpencode) {
      expect(providerForModel(id)).not.toBe('opencode');
    }
  });

  it('filterVisibleModels never returns models from disabled providers', () => {
    const enabled = new Set<ProviderId>(['opencode']);
    const visible = filterVisibleModels(MODEL_ORDER, { enabledProviders: enabled });
    expect(visible.length).toBeGreaterThan(0);
    for (const id of visible) {
      expect(providerForModel(id)).toBe('opencode');
    }
  });
});
