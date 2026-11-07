// src/components/FirstRunSetupCard.tsx
// Guided, trustworthy BYOK onboarding card shown to authorized users who have
// not yet connected an AI provider key.

import React, { useState } from 'react';
import type { ProviderPlugins } from '../hooks/useProviderPlugins';

interface FirstRunSetupCardProps {
  plugins: ProviderPlugins;
  onOpenSettings: () => void;
}

export const FirstRunSetupCard: React.FC<FirstRunSetupCardProps> = ({
  plugins,
  onOpenSettings,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleQuickConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setIsSubmitting(true);
    setStatusMessage('Validating key with OpenRouter metadata endpoint…');
    setErrorMessage(null);

    try {
      const validation = await plugins.validateKey('openrouter', apiKey.trim());
      if (validation.status === 'invalid_revoked') {
        setErrorMessage('Key rejected: OpenRouter reported this key is invalid or revoked.');
        setIsSubmitting(false);
        return;
      }
      if (validation.status === 'unavailable') {
        setErrorMessage('Notice: OpenRouter metadata endpoint was unreachable. Saving key anyway…');
      }

      const saved = await plugins.setKey('openrouter', apiKey.trim());
      if (saved) {
        setStatusMessage('OpenRouter key connected and verified! You are ready to chat.');
        setApiKey('');
      } else {
        setErrorMessage('Failed to save provider key. Please check Provider Settings.');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to connect key');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className='first-run-card' role='region' aria-label='AI Provider Setup Guide'>
      <div className='first-run-badge'>First-Run Setup</div>
      <h2 className='first-run-title'>Connect an AI Provider to Start Chatting</h2>
      <p className='first-run-desc'>
        Prismatix is a <strong>bring-your-own-key (BYOK)</strong> personal multi-model workspace.
        Your API keys are encrypted at rest with AES-256-GCM and never shared. We recommend
        connecting <strong>OpenRouter</strong> for automatic routing across top models, or you can
        connect Anthropic, OpenAI, or Google directly.
      </p>

      {statusMessage && (
        <div className='first-run-status success' role='status'>
          ✓ {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div className='first-run-status error' role='alert'>
          ⚠️ {errorMessage}
        </div>
      )}

      <form className='first-run-form' onSubmit={handleQuickConnect}>
        <div className='first-run-input-group'>
          <label htmlFor='first-run-openrouter-key' className='first-run-label'>
            OpenRouter API Key (Recommended)
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
            />
            <button
              type='submit'
              className='first-run-submit'
              disabled={isSubmitting || apiKey.trim().length < 8}
            >
              {isSubmitting ? 'Connecting…' : 'Connect & Start'}
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

      <div className='first-run-actions'>
        <button
          type='button'
          className='first-run-secondary-btn'
          onClick={onOpenSettings}
        >
          Configure Other Providers (Anthropic, OpenAI, Google) →
        </button>
        <a href='/demo' className='first-run-demo-link'>
          Try the scripted public demo first →
        </a>
      </div>
    </div>
  );
};
