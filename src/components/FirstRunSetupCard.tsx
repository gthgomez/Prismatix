// src/components/FirstRunSetupCard.tsx
// Guided, trustworthy BYOK onboarding card shown to authorized users who have
// not yet connected an AI provider key.

import React, { useEffect, useRef, useState } from 'react';
import type { ProviderPlugins } from '../hooks/useProviderPlugins';
import { describeProviderSettingsError } from '../providerSetupPresentation';

interface FirstRunSetupCardProps {
  plugins: ProviderPlugins;
  onOpenSettings: () => void;
}

type ConnectPhase = 'idle' | 'checking' | 'saving' | 'rejected';

export const FirstRunSetupCard: React.FC<FirstRunSetupCardProps> = ({
  plugins,
  onOpenSettings,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [phase, setPhase] = useState<ConnectPhase>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  const busy = phase === 'checking' || phase === 'saving';
  const checkingProviderState = plugins.loading && !plugins.loaded;
  const stateLoadFailed = Boolean(plugins.error) && !plugins.loaded;
  const savedButDisabled = plugins.providers.find((provider) => provider.hasKey && !provider.enabled);

  useEffect(() => {
    if (!checkingProviderState && !stateLoadFailed) {
      inputRef.current?.focus();
    }
  }, [checkingProviderState, stateLoadFailed]);

  useEffect(() => {
    if (busy) statusRef.current?.focus();
  }, [busy]);

  useEffect(() => {
    if (phase === 'rejected') {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [phase]);

  const handleQuickConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = apiKey.trim();
    if (!key || busy) {
      setPhase('rejected');
      setErrorMessage('Enter your OpenRouter key first.');
      inputRef.current?.focus();
      return;
    }

    setPhase('checking');
    setErrorMessage(null);
    setStatusMessage('Checking this key with OpenRouter…');

    const validation = await plugins.validateKey('openrouter', key);
    if (validation.status === 'invalid_revoked') {
      setPhase('rejected');
      setStatusMessage(null);
      setErrorMessage(
        validation.message || 'OpenRouter rejected this key. Check it and try again.',
      );
      return;
    }

    const verified = validation.status === 'enabled';
    setPhase('saving');
    setStatusMessage(
      verified
        ? 'Verified. Saving the key…'
        : 'Provider metadata is unavailable. Saving the key without verification…',
    );

    const saved = await plugins.setKey('openrouter', key);
    if (!saved) {
      setPhase('idle');
      setStatusMessage(null);
      setErrorMessage(
        'The key could not be saved. Try again, or open Provider Settings to inspect the connection.',
      );
      inputRef.current?.focus();
      return;
    }

    setApiKey('');
    plugins.recordVerification('openrouter', {
      state: verified ? 'verified' : 'unverified',
      message: verified
        ? validation.message || 'OpenRouter key verified'
        : validation.message ||
          'The metadata check was unavailable, so this saved key is not verified.',
    });
    plugins.reportSetupOutcome({
      provider: 'openrouter',
      state: verified ? 'verified' : 'saved_unverified',
      message: verified
        ? 'OpenRouter key verified. You are ready to chat.'
        : 'OpenRouter key saved, but not verified. The metadata check was unavailable; run Test in Provider Settings when it is reachable.',
    });
    setStatusMessage(verified ? 'Verified. Opening the chat composer…' : 'Key saved without verification.');
  };

  if (checkingProviderState) {
    return (
      <div className='first-run-card first-run-card--compact' role='region' aria-label='AI Provider Setup Guide'>
        <div className='first-run-badge'>First-Run Setup</div>
        <h2 className='first-run-title'>Checking provider setup…</h2>
        <div className='first-run-status checking' role='status' aria-live='polite'>
          <span className='first-run-spinner' aria-hidden='true' />
          Reading your saved provider state.
        </div>
      </div>
    );
  }

  if (stateLoadFailed) {
    return (
      <div className='first-run-card first-run-card--compact' role='region' aria-label='AI Provider Setup Guide'>
        <div className='first-run-badge'>First-Run Setup</div>
        <h2 className='first-run-title'>Could not check provider setup</h2>
        <div className='first-run-status error' role='alert' title={plugins.error ?? undefined}>
          {describeProviderSettingsError(plugins.error)}
        </div>
        <div className='first-run-actions'>
          <button type='button' className='first-run-submit' onClick={() => void plugins.refresh()}>
            Retry setup check
          </button>
          <a href='/demo' className='first-run-demo-link'>Try the demo →</a>
        </div>
      </div>
    );
  }

  if (savedButDisabled) {
    return (
      <div className='first-run-card first-run-card--compact' role='region' aria-label='AI Provider Setup Guide'>
        <div className='first-run-badge'>Provider setup</div>
        <h2 className='first-run-title'>{savedButDisabled.label} is saved but turned off</h2>
        <p className='first-run-desc'>
          A key is stored for {savedButDisabled.label}, but the provider is disabled. Turn it on in
          Provider Settings to start chatting.
        </p>
        <div className='first-run-actions'>
          <button type='button' className='first-run-submit' onClick={onOpenSettings}>
            Open Provider Settings
          </button>
          <a href='/demo' className='first-run-demo-link'>Try the scripted demo →</a>
        </div>
      </div>
    );
  }

  return (
    <div className='first-run-card' role='region' aria-label='AI Provider Setup Guide'>
      <div className='first-run-badge'>First-Run Setup</div>
      <h2 className='first-run-title'>Connect a provider to start chatting</h2>
      <p className='first-run-desc'>
        Use your own API key. It is encrypted at rest and never shared.
      </p>

      {plugins.error && (
        <div className='first-run-status error' role='alert' title={plugins.error}>
          {describeProviderSettingsError(plugins.error)}
          <button type='button' className='first-run-inline-retry' onClick={() => void plugins.refresh()}>
            Retry
          </button>
        </div>
      )}

      {errorMessage && (
        <div className='first-run-status error' role='alert'>
          {errorMessage}
        </div>
      )}

      {statusMessage && !errorMessage && (
        <div
          ref={statusRef}
          className={`first-run-status ${busy ? 'checking' : 'success'}`}
          role='status'
          aria-live='polite'
          tabIndex={-1}
        >
          {busy && <span className='first-run-spinner' aria-hidden='true' />}
          {statusMessage}
        </div>
      )}

      <form className='first-run-form' onSubmit={handleQuickConnect} aria-busy={busy}>
        <div className='first-run-input-group'>
          <label htmlFor='first-run-openrouter-key' className='first-run-label'>
            OpenRouter API key (recommended)
          </label>
          <div className='first-run-input-row'>
            <input
              ref={inputRef}
              id='first-run-openrouter-key'
              type='password'
              className='first-run-input'
              placeholder='Paste your OpenRouter key'
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={busy}
              autoComplete='off'
              spellCheck={false}
              aria-invalid={phase === 'rejected' || undefined}
              aria-describedby='first-run-key-hint'
            />
            <button
              type='submit'
              className='first-run-submit'
              disabled={busy || apiKey.trim().length === 0}
            >
              {phase === 'checking' ? 'Checking…' : phase === 'saving' ? 'Saving…' : 'Connect'}
            </button>
          </div>
          <span id='first-run-key-hint' className='first-run-hint'>
            Get a key at{' '}
            <a
              href='https://openrouter.ai/keys'
              target='_blank'
              rel='noopener noreferrer'
              className='first-run-link'
            >
              openrouter.ai/keys
            </a>
            . We check it before saving; if the check is unreachable, the key is saved and labeled not verified.
          </span>
        </div>
      </form>

      <details className='first-run-details'>
        <summary>How keys are handled</summary>
        <p>
          Prismatix is bring-your-own-key (BYOK). Keys are encrypted with AES-256-GCM and
          never returned to the browser. A saved key is not proof that the provider accepts it.
        </p>
      </details>

      <div className='first-run-actions'>
        <button
          type='button'
          className='first-run-secondary-btn'
          onClick={onOpenSettings}
        >
          Configure other providers (Anthropic, OpenAI, Google) →
        </button>
        <a href='/demo' className='first-run-demo-link'>
          Try the scripted demo →
        </a>
      </div>
    </div>
  );
};
