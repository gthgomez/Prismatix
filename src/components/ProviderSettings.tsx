// src/components/ProviderSettings.tsx
// Provider plug-ins panel: connect BYOK keys, toggle providers on/off, and pick
// the default first-class gateway. OpenCode is deployment-provided and always
// available; every other provider is opt-in.

import React, { useState } from 'react';
import type { ProviderPlugins } from '../hooks/useProviderPlugins';
import { getProviderPlugin, type ProviderId } from '../providerRegistry';

interface ProviderSettingsProps {
  plugins: ProviderPlugins;
  onClose: () => void;
}

export const ProviderSettings: React.FC<ProviderSettingsProps> = ({ plugins, onClose }) => {
  const { providers, defaultProvider, loading, error } = plugins;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const connect = (id: ProviderId) =>
    run(`connect:${id}`, async () => {
      const value = (drafts[id] ?? '').trim();
      if (!value) return;
      await plugins.setKey(id, value);
      setDrafts((prev) => ({ ...prev, [id]: '' }));
    });

  return (
    <div className='provider-settings' role='dialog' aria-label='Provider plug-ins'>
      <div className='provider-settings-header'>
        <span>Provider plug-ins</span>
        <button type='button' className='provider-settings-close' onClick={onClose}>
          Close
        </button>
      </div>

      <p className='provider-settings-intro'>
        OpenCode is always available. Connect a key and turn a provider on to unlock its models, or
        enable OpenRouter to reach many models with one key.
      </p>

      {loading && <div className='provider-settings-note'>Loading providers…</div>}
      {error && <div className='provider-settings-error'>{error}</div>}

      <div className='provider-settings-list'>
        {providers.map((provider) => {
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
                  {isOpencode && <span className='provider-badge'>Included</span>}
                </div>

                {!isOpencode && (
                  <label className='provider-toggle'>
                    <input
                      type='checkbox'
                      checked={provider.enabled}
                      disabled={!canToggle || busy !== null}
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
                <div className='provider-card-note'>
                  {plugin.docsHint ?? 'Provided by this deployment.'}
                  {!provider.hasKey && ' (no server key configured)'}
                </div>
              ) : (
                <>
                  <div className='provider-key-row'>
                    <input
                      type='password'
                      className='provider-key-input'
                      placeholder={provider.hasKey ? `Saved ••••${provider.keyLast4 ?? ''}` : plugin.keyPlaceholder}
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

                  {plugin.offeredByDefault && (
                    <button
                      type='button'
                      className='provider-set-default'
                      disabled={busy !== null || !provider.hasKey || provider.defaultProvider}
                      onClick={() =>
                        void run(`default:${provider.id}`, () => plugins.setDefault(provider.id))
                      }
                    >
                      {provider.defaultProvider ? 'Default gateway' : 'Set as default'}
                    </button>
                  )}

                  {!provider.hasKey && (
                    <div className='provider-card-note'>Add a key to turn this provider on.</div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {defaultProvider && (
        <div className='provider-settings-footnote'>Default gateway: {defaultProvider}</div>
      )}
    </div>
  );
};
