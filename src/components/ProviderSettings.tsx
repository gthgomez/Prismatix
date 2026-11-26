// src/components/ProviderSettings.tsx
// Provider plug-ins modal: connect BYOK keys, toggle providers on/off, and pick
// the default BYOK gateway. The legacy server-key-only OpenCode path is shown
// as disabled and is never reported as ready.

import '../styles/ProviderSettings.css';
import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

function inconclusiveVerificationMessage(provider: ProviderId): string {
  return provider === 'nvidia'
    ? 'A metadata verification check is not available in Prismatix for this provider.'
    : 'Verification was inconclusive.';
}

export const ProviderSettings: React.FC<ProviderSettingsProps> = ({ plugins, preferences, onClose }) => {
  const { providers, defaultProvider, loading, error, refresh } = plugins;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedModelsProvider, setExpandedModelsProvider] = useState<string | null>(null);
  const [showHistoricByProvider, setShowHistoricByProvider] = useState<Record<string, boolean>>({});
  const titleId = useId();
  const panelRef = useRef<HTMLDialogElement>(null);

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

  useEffect(() => {
    const dialog = panelRef.current;
    const trigger = document.activeElement;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger !== document.body && trigger.isConnected) {
        trigger.focus();
      }
      if (document.activeElement === document.body) {
        const fallback = trigger?.closest('.arctic-routing-panel')
          ? document.querySelector<HTMLElement>('.arctic-routing-toggle')
          : document.querySelector<HTMLElement>('.user-button');
        fallback?.focus();
      }
    };
  }, []);

  const run = async (key: string, fn: () => Promise<boolean>): Promise<boolean> => {
    setBusy(key);
    setNotice(null);
    try {
      const ok = await fn();
      if (!ok) setNotice('That action failed. Check your key and try again.');
      return ok;
    } catch {
      setNotice('That action could not be completed. Try again.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const connect = (id: ProviderId) =>
    run(`connect:${id}`, async () => {
      const value = (drafts[id] ?? '').trim();
      if (!value) return false;
      const validation = await plugins.validateKey(id, value);
      if (validation.stale) return false;
      if (validation.status === 'invalid_revoked') {
        setNotice('The provider rejected this key. Check the key and try again.');
        return true;
      }
      const result = await plugins.setKey(id, value, validation);
      if (result.saved) {
        setNotice(result.verified
          ? `Key saved and verified. ${result.qualifiedModelCount} models are ready.`
          : result.inventoryStatus === 'restricted'
            ? 'Key saved, but provider access is restricted. Review the provider account.'
            : result.inventoryStatus === 'unavailable'
              ? 'Key saved, but model discovery is unavailable. Refresh models to retry.'
              : result.inventoryStatus === 'verified' && result.qualifiedModelCount === 0
                ? 'Key saved, but the account has no compatible models for Prismatix yet.'
                : `Key saved. ${inconclusiveVerificationMessage(id)}`);
      }
      // Only clear the field on success so a failed save never discards the key.
      if (result.saved) setDrafts((prev) => ({ ...prev, [id]: '' }));
      return result.saved;
    });

  return createPortal(
    <dialog
      className='provider-settings'
      aria-labelledby={titleId}
      ref={panelRef}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className='provider-settings-header'>
        <h2 id={titleId}>Provider plug-ins</h2>
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
        Connect and manage your own provider keys. Auto Router can use model routes from your enabled connections.
      </p>

      {loading && <div className='provider-settings-note'>Loading providers…</div>}
      {error && (
        <div className='provider-settings-error' role='alert'>
          Provider settings could not be loaded.
          <button type='button' className='provider-settings-close' onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      {notice && <div className='provider-settings-notice' role='status'>{notice}</div>}

      <div className='provider-settings-list'>
        {[...providers].sort((a, b) => {
          const rank = (id: string) => id === 'openrouter' ? 0 : id === 'opencode' ? 2 : 1;
          return rank(a.id) - rank(b.id);
        }).map((provider) => {
          if (!isProviderId(provider.id)) return null;
          const plugin = getProviderPlugin(provider.id);
          const isServerManaged = plugin.keyKind === 'server';
          const canToggle = !isServerManaged && provider.hasKey;
          const userEnabled = provider.userEnabled ?? provider.enabled;
          const draft = drafts[provider.id] ?? '';

          return (
            <div key={provider.id} className='provider-card'>
              <div className='provider-card-head'>
                <div className='provider-card-title'>
                  <span className='provider-card-label'>{provider.label}</span>
                  {provider.defaultProvider && (
                    <span className='provider-badge provider-badge--default'>Default</span>
                  )}
                  {isServerManaged && (
                    <span className='provider-badge provider-badge--setup'>
                      Unavailable
                    </span>
                  )}
                </div>

                {!isServerManaged && (
                  <label className='provider-toggle'>
                    <input
                      type='checkbox'
                      className='provider-switch'
                      role='switch'
                      checked={userEnabled}
                      disabled={!canToggle || busy !== null}
                      aria-label={`Enable ${provider.label}`}
                      onChange={(e) =>
                        void run(`toggle:${provider.id}`, () =>
                          plugins.setEnabled(provider.id, e.target.checked),
                        )
                      }
                    />
                    <span>{userEnabled ? 'On' : 'Off'}</span>
                  </label>
                )}
              </div>

              {isServerManaged ? (
                <div className='provider-card-note needs-setup'>
                  This connection cannot be managed from your account.
                </div>
              ) : (
                <>
                  <div
                    className={`provider-state-line ${
                      !provider.hasKey
                        ? 'needs-setup'
                        : provider.status === 'invalid_revoked'
                        ? 'is-error'
                        : provider.status === 'unavailable'
                        ? 'is-warning'
                        : provider.enabled
                        ? 'is-on'
                        : 'is-off'
                    }`}
                    aria-live='polite'
                  >
                    {!provider.hasKey
                      ? 'Not configured'
                      : provider.status === 'invalid_revoked'
                      ? 'Invalid / Revoked'
                      : provider.status === 'unavailable'
                      ? 'Unavailable'
                      : provider.enabled
                      ? plugins.verifiedProviders?.has(provider.id) ? 'Enabled and verified' : 'Enabled · key unverified'
                      : userEnabled
                        ? provider.inventoryStatus === 'verified' ? 'Enabled · no ready models' : 'Enabled · verification required'
                        : 'Disabled'}

                  </div>
                  <div className='provider-card-note' aria-live='polite'>
                    {provider.inventoryStatus === 'verified'
                      ? `${provider.qualifiedModelCount ?? 0} of ${provider.availableModelCount ?? 0} discovered models are ready for chat.`
                      : provider.inventoryStatus === 'restricted'
                        ? 'Provider access is restricted. Review this key or provider account.'
                        : provider.inventoryStatus === 'unavailable'
                          ? 'Model inventory is temporarily unavailable. Retry refresh to update it.'
                          : provider.inventoryStatus === 'invalid_revoked'
                            ? 'This key was rejected. Update it to restore its model inventory.'
                            : provider.inventoryStatus === 'unverified'
                              ? 'Verify this key to load available models.'
                              : 'No verified model inventory is available yet.'}
                    {provider.lastSuccessfulRefresh && (
                      <span> Last refreshed {new Date(provider.lastSuccessfulRefresh).toLocaleString()}.</span>
                    )}
                  </div>
                  {plugins.routes.some((route) => route.provider === provider.id) && (
                    <ul className='provider-card-note' aria-label={`${provider.label} verified routes`}>
                      {plugins.routes.filter((route) => route.provider === provider.id).map((route) => (
                        <li key={route.id}>{route.name} · {route.upstreamId}</li>
                      ))}
                    </ul>
                  )}
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
                      {busy === `connect:${provider.id}` ? 'Checking…' : provider.hasKey ? 'Update' : 'Connect'}
                    </button>
                    {(provider.hasKey || draft.trim().length >= 8) && (
                      <button
                        type='button'
                        className='provider-key-test'
                        disabled={busy !== null}
                        aria-label={`Test connection for ${provider.label}`}
                        onClick={() =>
                          void run(`test:${provider.id}`, async () => {
                            const res = await plugins.validateKey(provider.id, draft.trim() || undefined);
                            setNotice(
                              `${provider.label}: ${
                                res.status === 'enabled'
                                  ? draft.trim() ? 'Draft key verified. Save it to use it.' : 'Saved key verified.'
                                  : res.status === 'invalid_revoked' ? 'Key rejected. Update the key and try again.'
                                  : res.status === 'unknown' ? inconclusiveVerificationMessage(provider.id)
                                  : 'Could not verify the key. Try again.'
                              }`,
                            );
                            return true;
                          })
                        }
                      >
                        {busy === `test:${provider.id}` ? 'Testing…' : 'Test'}
                      </button>
                    )}
                    {provider.hasKey && (
                      <button
                        type='button'
                        className='provider-key-test'
                        disabled={busy !== null}
                        onClick={() => void run(`refresh:${provider.id}`, () => plugins.refreshInventory(provider.id))}
                      >
                        {busy === `refresh:${provider.id}` ? 'Refreshing…' : 'Refresh models'}
                      </button>
                    )}
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
                  disabled={busy !== null || provider.defaultProvider || (plugin.keyKind !== 'server' && (!provider.enabled || provider.inventoryStatus !== 'verified' || (provider.qualifiedModelCount ?? 0) === 0))}
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
                        Models ({activeCount} visible / {allProviderModels.length} in catalog)
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
    </dialog>,
    document.body,
  );
};
