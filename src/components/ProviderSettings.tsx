// src/components/ProviderSettings.tsx
// Provider plug-ins modal: connect BYOK keys, toggle providers on/off, and pick
// the default first-class gateway. OpenCode is deployment-provided and always
// available; every other provider is opt-in. Rendered as a backdrop modal so it
// never overlays the composer or floating widgets.

import React, { useEffect, useRef, useState } from 'react';
import type { ProviderPlugins } from '../hooks/useProviderPlugins';
import { getProviderPlugin, isProviderId, type ProviderId } from '../providerRegistry';

interface ProviderSettingsProps {
  plugins: ProviderPlugins;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), input:not(:disabled), [href], select, textarea, [tabindex]:not([tabindex="-1"])';

export const ProviderSettings: React.FC<ProviderSettingsProps> = ({ plugins, onClose }) => {
  const { providers, defaultProvider, loading, error, refresh } = plugins;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

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
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
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
          OpenCode is always available. Connect a key and turn a provider on to unlock its models, or
          enable OpenRouter to reach many models with one key.
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
                    {isOpencode && <span className='provider-badge'>Included</span>}
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
                  <div className='provider-card-note'>
                    {provider.hasKey
                      ? plugin.docsHint ?? 'Provided by this deployment — no key needed from you.'
                      : 'Provided by this deployment — no key needed from you. The operator has not configured a server key yet, so routed requests may fail until one is added.'}
                  </div>
                ) : (
                  <>
                    <div className='provider-state-line'>
                      {!provider.hasKey
                        ? 'Not connected'
                        : provider.enabled
                          ? 'Connected and on'
                          : 'Key saved — turned off'}
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
