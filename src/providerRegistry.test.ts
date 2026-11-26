import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_CHOICES,
  FALLBACK_DEFAULT_PROVIDER,
  PROVIDER_PLUGIN_ORDER,
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
  it('offers inference providers as default choices, but not key-only Brave Search', () => {
    expect(DEFAULT_PROVIDER_CHOICES).toEqual(PROVIDER_PLUGIN_ORDER.filter((provider) => provider !== 'brave'));
    const offered = Object.values(PROVIDER_PLUGINS)
      .filter((p) => p.offeredByDefault)
      .map((p) => p.id)
      .sort();
    expect(offered).toEqual([...DEFAULT_PROVIDER_CHOICES].sort());
  });

  it('leaves fresh and legacy-default users without a preference or enabled inference route', () => {
    expect(FALLBACK_DEFAULT_PROVIDER).toBeNull();
    expect(resolveDefaultProvider(null)).toBeNull();
    expect([...resolveEnabledProviderIds(null)]).toEqual([]);
    expect(resolveDefaultProvider({ default_provider: 'opencode' })).toBe('opencode');
    expect([...resolveEnabledProviderIds({
      default_provider: 'opencode',
      providers: [{ provider: 'opencode', enabled: true, has_key: false }],
    })]).toEqual([]);
  });

  it('enables the chosen default gateway only with fresh verified inventory', () => {
    const enabled = resolveEnabledProviderIds({ default_provider: 'openrouter', providers: [{
      provider: 'openrouter', enabled: true, has_key: true,
      inventory: { status: 'verified', discoveredAt: new Date().toISOString(), routes: [{ id: 'openrouter:google/gemini-3.8-flash' }] },
    }] });
    expect([...enabled]).toEqual(['openrouter']);
  });

  it('enables opt-in providers only when their row is on', () => {
    const enabled = resolveEnabledProviderIds({
      default_provider: 'opencode',
      providers: [
        { provider: 'opencode', enabled: true, has_key: false },
        { provider: 'anthropic', enabled: true, has_key: true, inventory: { status: 'verified', discoveredAt: new Date().toISOString(), routes: [{ id: 'anthropic:claude-sonnet-5' }] } },
        { provider: 'deepinfra', enabled: false, has_key: true },
      ],
    });
    expect(enabled.has('opencode' as ProviderId)).toBe(false);
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
    expect(isModelVisible('deepseek-v4-1-flash', { enabledProviders: enabled })).toBe(false);
    expect(isModelVisible('gpt-6.1-sol', { enabledProviders: enabled })).toBe(true);
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
