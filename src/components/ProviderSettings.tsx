// src/components/ProviderSettings.tsx
// Provider plug-ins modal: connect BYOK keys, toggle providers on/off, and pick
// the default first-class gateway. OpenCode configuration is reported by the
// deployment and must not be presented as ready when no server key is set.

import React, { useEffect, useRef, useState } from 'react';
import type { ProviderPlugins } from '../hooks/useProviderPlugins';
import { getProviderPlugin, isProviderId, type ProviderId } from '../providerRegistry';
import { MODEL_ORDER, formatModelPriceLabel, getCatalogEntry } from '../modelCatalog';
import { isHistoricModel } from '../../supabase/functions/_shared/model_lifecycle';
import type { ModelPickerPreferencesHook } from '../hooks/useModelPickerPreferences';
import { hasOpenRouterRoute, providerForModel } from '../providerRegistry';

interface ProviderSettingsProps {
  plugins: ProviderPlugins;
  preferences: ModelPickerPreferencesHook;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), input:not(:disabled), [href], select, textarea, [tabindex]:not([tabindex="-1"])';

export const ProviderSettings: React.FC<ProviderSettingsProps> = ({ plugins, preferences, onClose }) => {
  const { providers, defaultProvider, loading, error, refresh } = plugins;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedModelsProvider, setExpandedModelsProvider] = useState<string | null>(null);
  const [showHistoricByProvider, setShowHistoricByProvider] = useState<Record<string, boolean>>({});
  const panelRef = useRef<HTMLDivElement | null>(null);

  const {
    toggleFavorite,
    setModelVisible,
    isFavorite,
    isModelHidden,
  } = preferences;

  // Resolve models associated with each provider:
  // - For direct providers: catalog models whose owner matches
  // - For openrouter: models that have an openrouter route
  const getModelsForProvider = (providerId: string, includeHistoric: boolean) => {
    return MODEL_ORDER.filter((modelId) => {
      const isHistoric = isHistoricModel(modelId);
      if (isHistoric && !includeHistoric) return false;

      if (providerId === 'openrouter') {
        return hasOpenRouterRoute(modelId);
      }
      return providerForModel(modelId) === providerId;
    });
  };

  // Modal lifecycle: lock background scroll, move focus into the dialog, and
  // restore it when the dialog unmounts.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const run = async (key: string, fn: () => Promise<boolean>): Promise<boolean> => {
    setBusy(key);
    try {
      const ok = await fn();
      if (!ok) setNotice('That action failed. Check your key and try again.');
      return ok;
    } finally {
      setBusy(null);
    }
  };

  const connect = (id: ProviderId) =>
    run(`connect:${id}`, async () => {
      const value = (drafts[id] ?? '').trim();
      if (!value) return false;
      const ok = await plugins.setKey(id, value);
      // Only clear the field on success so a failed save never discards the key.
      if (ok) setDrafts((prev) => ({ ...prev, [id]: '' }));
      return ok;
    });

  return (
    <div
      className='provider-settings-backdrop'
      onClick={onClose}
      aria-hidden='false'
    >
      <div
        className='provider-settings'
        role='dialog'
        aria-modal='true'
        aria-label='Provider plug-ins'
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className='provider-settings-header'>
          <span>Provider plug-ins</span>
          <button
            type='button'
            className='provider-settings-close'
            onClick={onClose}
            aria-label='Close provider plug-ins'
          >
            Close
          </button>
        </div>

        <p className='provider-settings-intro'>
          Connect a provider key and turn it on to make its models available. OpenCode availability
          depends on this deployment’s server configuration.
        </p>

        {loading && <div className='provider-settings-note'>Loading providers…</div>}
        {error && (
          <div className='provider-settings-error' role='alert'>
            {error}
            <button type='button' className='provider-settings-close' onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}
        {notice && <div className='provider-settings-error' role='status'>{notice}</div>}

        <div className='provider-settings-list'>
          {providers.map((provider) => {
            if (!isProviderId(provider.id)) return null;
            const plugin = getProviderPlugin(provider.id);
            const isOpencode = provider.id === 'opencode';
            const canToggle = !isOpencode && provider.hasKey;
            const draft = drafts[provider.id] ?? '';

            return (
              <div key={provider.id} className='provider-card'>
                <div className='provider-card-head'>
                  <div className='provider-card-title'>
                    <span className='provider-card-label'>{provider.label}</span>
                    {provider.defaultProvider && (
                      <span className='provider-badge provider-badge--default'>Default</span>
                    )}
                    {isOpencode && (
                      <span
                        className={`provider-badge ${provider.hasKey ? 'provider-badge--configured' : 'provider-badge--setup'}`}
                      >
                        {provider.hasKey ? 'Server key set' : 'No server key'}
                      </span>
                    )}
                  </div>

                  {!isOpencode && (
                    <label className='provider-toggle'>
                      <input
                        type='checkbox'
                        className='provider-switch'
                        role='switch'
                        checked={provider.enabled}
                        disabled={!canToggle || busy !== null}
                        aria-label={`Enable ${provider.label}`}
                        onChange={(e) =>
                          void run(`toggle:${provider.id}`, () =>
                            plugins.setEnabled(provider.id, e.target.checked),
                          )
                        }
                      />
                      <span>{provider.enabled ? 'On' : 'Off'}</span>
                    </label>
                  )}
                </div>

                {isOpencode ? (
                  <div
                    className={`provider-card-note ${provider.hasKey ? 'is-configured' : 'needs-setup'}`}
                  >
                    {provider.hasKey
                      ? 'Server key configured. Credentials are supplied by this deployment; no key is needed from you.'
                      : 'No server key is configured. Ask the deployment operator to configure one before using OpenCode.'}
                  </div>
                ) : (
                  <>
                    <div
                      className={`provider-state-line ${
                        provider.hasKey ? (provider.enabled ? 'is-on' : 'is-off') : 'needs-setup'
                      }`}
                      aria-live='polite'
                    >
                      {!provider.hasKey
                        ? 'Key required'
                        : 'Key saved'}
                    </div>
                    <div className='provider-key-row'>
                      <input
                        type='password'
                        className='provider-key-input'
                        aria-label={plugin.keyLabel}
                        placeholder={
                          provider.hasKey
                            ? `Saved ••••${provider.keyLast4 ?? ''}`
                            : plugin.keyPlaceholder
                        }
                        value={draft}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [provider.id]: e.target.value }))
                        }
                        autoComplete='off'
                      />
                      <button
                        type='button'
                        className='provider-key-save'
                        disabled={busy !== null || draft.trim() === ''}
                        onClick={() => void connect(provider.id)}
                      >
                        {provider.hasKey ? 'Update' : 'Connect'}
                      </button>
                      {provider.hasKey && (
                        <button
                          type='button'
                          className='provider-key-remove'
                          disabled={busy !== null}
                          onClick={() =>
                            void run(`remove:${provider.id}`, () => plugins.removeKey(provider.id))
                          }
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    {!provider.hasKey && (
                      <div className='provider-card-note'>Add a key to turn this provider on.</div>
                    )}
                  </>
                )}

                {plugin.offeredByDefault && (
                  <button
                    type='button'
                    className='provider-set-default'
                    disabled={busy !== null || provider.defaultProvider || (!isOpencode && !provider.hasKey)}
                    onClick={() =>
                      void run(`default:${provider.id}`, () => plugins.setDefault(provider.id))
                    }
                  >
                    {provider.defaultProvider ? 'Default gateway' : 'Set as default'}
                  </button>
                )}

                {/* Per-provider Model Management & Visibility */}
                {(() => {
                  const showHistoric = !!showHistoricByProvider[provider.id];
                  const providerModels = getModelsForProvider(provider.id, showHistoric);
                  const allProviderModels = getModelsForProvider(provider.id, true);
                  const hasHistoric = allProviderModels.length > getModelsForProvider(provider.id, false).length;

                  if (allProviderModels.length === 0) return null;
                  const isExpanded = expandedModelsProvider === provider.id;
                  const activeCount = allProviderModels.filter((m) => !isModelHidden(m)).length;

                  return (
                    <div className='provider-models-section'>
                      <button
                        type='button'
                        className='provider-models-toggle'
                        aria-expanded={isExpanded}
                        onClick={() =>
                          setExpandedModelsProvider((curr) =>
                            curr === provider.id ? null : provider.id,
                          )
                        }
                      >
                        <span className='provider-models-toggle-title'>
                          Models ({activeCount} active / {allProviderModels.length} available)
                        </span>
                        <span className='provider-models-toggle-chevron' aria-hidden='true'>
                          {isExpanded ? '▴' : '▾'}
                        </span>
                      </button>

                      {isExpanded && (
                        <div className='provider-models-list' role='region' aria-label={`${provider.label} models`}>
                          <p className='provider-models-help'>
                            Unchecking a model removes it from quick model pickers. Intelligent Auto Routing can still select it when ideal.
                          </p>

                          {providerModels.map((modelId) => {
                            const config = getCatalogEntry(modelId);
                            const visible = !isModelHidden(modelId);
                            const fav = isFavorite(modelId);
                            const historic = isHistoricModel(modelId);

                            return (
                              <div key={modelId} className='provider-model-item'>
                                <label className='provider-model-checkbox-label'>
                                  <input
                                    type='checkbox'
                                    className='provider-model-checkbox'
                                    checked={visible}
                                    onChange={(e) => setModelVisible(modelId, e.target.checked)}
                                    aria-label={`Enable ${config.shortName}`}
                                  />
                                  <span className='provider-model-icon' aria-hidden='true'>
                                    {config.icon}
                                  </span>
                                  <div className='provider-model-item-info'>
                                    <span className='provider-model-name'>
                                      {config.shortName}
                                      {historic && <span className='provider-model-historic-badge'>Historic</span>}
                                    </span>
                                    <span className='provider-model-price'>
                                      {formatModelPriceLabel(modelId)}
                                    </span>
                                  </div>
                                </label>

                                <button
                                  type='button'
                                  className={`provider-model-star ${fav ? 'is-favorite' : ''}`}
                                  title={fav ? 'Remove from pinned models' : 'Pin model to quick access'}
                                  aria-label={fav ? `Unpin ${config.shortName}` : `Pin ${config.shortName}`}
                                  onClick={() => toggleFavorite(modelId)}
                                >
                                  {fav ? '★' : '☆'}
                                </button>
                              </div>
                            );
                          })}

                          {hasHistoric && (
                            <button
                              type='button'
                              className='provider-models-historic-toggle'
                              onClick={() =>
                                setShowHistoricByProvider((prev) => ({
                                  ...prev,
                                  [provider.id]: !prev[provider.id],
                                }))
                              }
                            >
                              {showHistoric ? 'Hide older models' : `Show older models (${allProviderModels.length - getModelsForProvider(provider.id, false).length})`}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {defaultProvider && (
          <div className='provider-settings-footnote'>Default gateway: {defaultProvider}</div>
        )}
      </div>
    </div>
  );
};
