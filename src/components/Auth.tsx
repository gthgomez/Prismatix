// src/components/Auth.tsx
// Authentication UI component with L3 Safety Gates

import React, { useState } from 'react';
import { CONFIG } from '../config';
import '../styles/Auth.css';

// PX01: signup UI is gated behind VITE_ALLOW_SIGNUP (default off). Server-side
// signup is disabled independently; this only hides the client path.
const ALLOW_SIGNUP = CONFIG.ALLOW_SIGNUP;

interface AuthProps {
  onSignIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  onSignUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  onSignInWithProvider?: (provider: 'google' | 'github') => Promise<{ error: Error | null }>;
  onResetPassword?: (email: string) => Promise<{ error: Error | null }>;
}

type AuthMode = 'signin' | 'signup';

export const Auth: React.FC<AuthProps> = ({ 
  onSignIn, 
  onSignUp, 
  onSignInWithProvider,
  onResetPassword
}) => {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    // PX01 gate: never submit a signup while signups are disabled.
    if (mode === 'signup' && !ALLOW_SIGNUP) {
      setError('Signups are currently disabled');
      setMode('signin');
      return;
    }

    // L3 Gate: Validate inputs
    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    if (!password) {
      setError('Password is required');
      return;
    }

    if (mode === 'signup') {
      if (password.length < 6) {
        setError('Password must be at least 6 characters');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
    }

    setIsLoading(true);

    try {
      const result = mode === 'signin' 
        ? await onSignIn(email, password)
        : await onSignUp(email, password);

      if (result.error) {
        setError(result.error.message);
      } else if (mode === 'signup') {
        setSuccessMessage('Check your email to confirm your account!');
        setMode('signin');
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleProviderSignIn = async (provider: 'google' | 'github') => {
    if (!onSignInWithProvider) return;
    
    setError(null);
    setIsLoading(true);

    try {
      const result = await onSignInWithProvider(provider);
      if (result.error) {
        setError(result.error.message);
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    if (!ALLOW_SIGNUP) {
      setMode('signin');
      return;
    }
    setMode(mode === 'signin' ? 'signup' : 'signin');
    setError(null);
    setSuccessMessage(null);
    setConfirmPassword('');
  };

  const handleForgotPassword = async () => {
    if (!onResetPassword) return;

    setError(null);
    setSuccessMessage(null);

    if (!email.trim()) {
      setError('Enter your email above first, then click "Forgot password?"');
      return;
    }

    setIsLoading(true);
    try {
      const result = await onResetPassword(email);
      if (result.error) {
        setError(result.error.message);
      } else {
        setSuccessMessage('Password reset email sent — check your inbox.');
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        {/* Header */}
        <div className="auth-header">
          <div className="auth-logo">🤖</div>
          <h1>Prismatix</h1>
          <p>Adaptive Model Selection</p>
        </div>

        {/* Tab Switcher — hidden entirely when signup is disabled (PX01):
            a single-tab pill is a dead control and reads as a rendering bug */}
        {ALLOW_SIGNUP && (
          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button 
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              className={`auth-tab ${mode === 'signin' ? 'active' : ''}`}
              onClick={() => setMode('signin')}
            >
              Sign In
            </button>
            <button 
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
              onClick={() => setMode('signup')}
            >
              Sign Up
            </button>
          </div>
        )}

        {/* Messages */}
        {error && (
          <div className="auth-message error" role="alert">
            <span>⚠️</span> {error}
          </div>
        )}
        {successMessage && (
          <div className="auth-message success">
            <span>✓</span> {successMessage}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={isLoading}
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="password-wrap">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={isLoading}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {mode === 'signup' && (
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                disabled={isLoading}
                autoComplete="new-password"
              />
            </div>
          )}

          <button 
            type="submit" 
            className="auth-submit"
            disabled={isLoading}
            aria-label={mode === 'signin' ? 'Sign in to Prismatix' : 'Create Prismatix account'}
          >
            {isLoading ? (
              <div className="loading-spinner" />
            ) : (
              mode === 'signin' ? 'Sign In' : 'Create Account'
            )}
          </button>

          {mode === 'signin' && onResetPassword && (
            <button type="button" className="auth-link forgot-link" onClick={handleForgotPassword}>
              Forgot password?
            </button>
          )}
        </form>

        {/* OAuth Providers */}
        {onSignInWithProvider && (
          <>
            <div className="auth-divider">
              <span>or continue with</span>
            </div>

            <div className="auth-providers">
              <button 
                type="button"
                className="provider-button google"
                onClick={() => handleProviderSignIn('google')}
                disabled={isLoading}
              >
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Google
              </button>

              <button 
                type="button"
                className="provider-button github"
                onClick={() => handleProviderSignIn('github')}
                disabled={isLoading}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                GitHub
              </button>
            </div>
          </>
        )}

        {/* Footer */}
        {ALLOW_SIGNUP && (
          <div className="auth-footer">
            <p>
              {mode === 'signin' ? "Don't have an account? " : "Already have an account? "}
              <button type="button" onClick={toggleMode} className="auth-link">
                {mode === 'signin' ? 'Sign Up' : 'Sign In'}
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
