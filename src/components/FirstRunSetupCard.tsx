// src/components/FirstRunSetupCard.tsx
// Guided, trustworthy BYOK onboarding card shown to authorized users who have
// not yet connected an AI provider key.

import '../styles/FirstRunSetup.css';
import React, { useState } from 'react';
import type { ProviderPlugins } from '../hooks/useProviderPlugins';

interface FirstRunSetupCardProps {
  plugins: ProviderPlugins;
  onOpenSettings: () => void;
  onSaved?: (message: string, verified: boolean) => void;
}

export const FirstRunSetupCard: React.FC<FirstRunSetupCardProps> = ({
  plugins,
  onOpenSettings,
  onSaved,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'success' | 'pending' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const savedButDisabled = plugins.providers.find((provider) => provider.hasKey && !provider.enabled);

  const handleQuickConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setIsSubmitting(true);
    setStatusMessage('Checking your OpenRouter key…');
    setStatusTone('pending');
    setErrorMessage(null);

    try {
      const validation = await plugins.validateKey('openrouter', apiKey.trim());
      if (validation.stale) {
        setStatusMessage(null);
        setStatusTone(null);
        setErrorMessage('The signed-in account changed while this key was being checked. The key was not saved; retry the check for the current account.');
        return;
      }
      if (validation.status === 'invalid_revoked') {
        setStatusMessage(null);
        setStatusTone(null);
        setErrorMessage('Key rejected: OpenRouter reported this key is invalid or revoked.');
        setIsSubmitting(false);
        return;
      }
      const saveResult = await plugins.setKey('openrouter', apiKey.trim(), validation);
      if (saveResult.saved) {
        const message = saveResult.verified
          ? 'Key saved and verified. You are ready to chat.'
          : 'Key saved, but could not be verified. Chat is paused until you verify this key or update it in Provider Settings.';
        setStatusMessage(message);
        setStatusTone(saveResult.verified ? 'success' : 'pending');
        onSaved?.(message, saveResult.verified);
        setApiKey('');
      } else {
        setStatusMessage(null);
        setStatusTone(null);
        setErrorMessage('Failed to save provider key. Please check Provider Settings.');
      }
    } catch {
      setStatusMessage(null);
      setStatusTone(null);
      setErrorMessage('Could not connect to OpenRouter. Try again or choose another provider.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (savedButDisabled) {
    return (
      <section className='first-run-card first-run-card--compact' role='region' aria-label='AI Provider Setup Guide'>
        <p className='first-run-welcome'>Provider setup</p>
        <h2 className='first-run-title'>{savedButDisabled.label} is saved but turned off</h2>
        <p className='first-run-desc'>
          A key is already stored for {savedButDisabled.label}, but that provider is disabled.
          Open Provider Settings to turn it on or choose another provider.
        </p>
        <div className='first-run-actions'>
          <button type='button' className='first-run-submit' onClick={onOpenSettings}>
            Open Provider Settings
          </button>
          <a href='/demo' className='first-run-demo-link'>Try the public demo</a>
        </div>
      </section>
    );
  }

  return (
    <section className='first-run-card' aria-labelledby='first-run-heading'>
      <p className='first-run-welcome'>Welcome to Prismatix</p>
      <h2 id='first-run-heading' className='first-run-title'>Connect your AI provider</h2>
      <p className='first-run-desc'>Connect OpenRouter to use multiple AI models with your own API key.</p>
      {statusMessage && (
        <div className={`first-run-status ${statusTone ?? 'pending'}`} role='status'>
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div id='first-run-error' className='first-run-status error' role='alert'>
          {errorMessage}
        </div>
      )}

      <form className='first-run-form' onSubmit={handleQuickConnect}>
        <div className='first-run-input-group'>
          <label htmlFor='first-run-openrouter-key' className='first-run-label'>
            OpenRouter API key
          </label>
          <div className='first-run-input-row'>
            <input
              id='first-run-openrouter-key'
              type='password'
              className='first-run-input'
              placeholder='sk-or-v1-••••••••••••••••'
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={isSubmitting}
              autoComplete='off'
              aria-invalid={!!errorMessage}
              aria-describedby={errorMessage ? 'first-run-error' : undefined}
            />
            <button
              type='submit'
              className='first-run-submit'
              disabled={isSubmitting || apiKey.trim().length < 8}
            >
              {isSubmitting ? 'Checking…' : 'Connect provider'}
            </button>
          </div>
          <span className='first-run-hint'>
            Need a key? Get one at{' '}
            <a
              href='https://openrouter.ai/keys'
              target='_blank'
              rel='noopener noreferrer'
              className='first-run-link'
            >
              openrouter.ai/keys
            </a>
          </span>
        </div>
      </form>

      <p className='first-run-desc'>Your key is encrypted when saved and is used to send requests to your provider.</p>

      <div className='first-run-actions'>
        <button
          type='button'
          className='first-run-secondary-btn'
          onClick={onOpenSettings}
        >
          Use another provider
        </button>
        <a href='/demo' className='first-run-demo-link'>
          Try the public demo
        </a>
      </div>
    </section>
  );
};
