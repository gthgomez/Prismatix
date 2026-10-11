// ResetPassword.tsx - Password recovery UI for Supabase email links

import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Status = 'idle' | 'loading' | 'success' | 'error' | 'invalid';

export const ResetPassword: React.FC = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;

    const initSession = async () => {
      try {
        const url = new URL(window.location.href);
        const searchParams = new URLSearchParams(url.search);
        const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);

        const type = searchParams.get('type') || hashParams.get('type');
        const code = searchParams.get('code');
        const tokenHash = searchParams.get('token_hash') || searchParams.get('token');

        if (type === 'recovery' && code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error && mounted) {
            setStatus('error');
            setMessage(error.message);
          }
          window.history.replaceState({}, document.title, '/reset-password');
        } else if (type === 'recovery' && tokenHash) {
          const { error } = await supabase.auth.verifyOtp({
            type: 'recovery',
            token_hash: tokenHash,
          });
          if (error && mounted) {
            setStatus('error');
            setMessage(error.message);
          }
          window.history.replaceState({}, document.title, '/reset-password');
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;

        if (!session) {
          setStatus('invalid');
        }
      } catch (err) {
        if (!mounted) return;
        setStatus('error');
        setMessage('Unable to validate reset link. Please request a new one.');
      } finally {
        if (mounted) setChecking(false);
      }
    };

    initSession();
    return () => { mounted = false; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!password || password.length < 6) {
      setStatus('error');
      setMessage('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setStatus('error');
      setMessage('Passwords do not match.');
      return;
    }

    setStatus('loading');
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setStatus('error');
      setMessage(error.message);
      return;
    }

    setStatus('success');
    setMessage('Password updated. You can sign in now.');
    await supabase.auth.signOut();
  };

  const goToSignin = () => {
    window.location.href = '/';
  };

  return (
    <div className="reset-container">
      <div className="reset-card">
        <div className="reset-header">
          <div className="reset-logo">LOCK</div>
          <h1>Reset Password</h1>
          <p>Set a new password for your account</p>
        </div>

        {checking && (
          <div className="reset-message info">
            <span>...</span> Validating reset link...
          </div>
        )}

        {!checking && status === 'invalid' && (
          <div className="reset-message error">
            <span>!</span> Reset link is invalid or expired. Please request a new one.
          </div>
        )}

        {!checking && message && status !== 'invalid' && (
          <div className={`reset-message ${status === 'success' ? 'success' : 'error'}`}>
            <span>{status === 'success' ? 'OK' : '!'}</span> {message}
          </div>
        )}

        {!checking && status !== 'invalid' && (
          <form onSubmit={handleSubmit} className="reset-form">
            <div className="form-group">
              <label htmlFor="newPassword">New Password</label>
              <input
                id="newPassword"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="********"
                disabled={status === 'loading'}
                autoComplete="new-password"
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="********"
                disabled={status === 'loading'}
                autoComplete="new-password"
              />
            </div>

            <button type="submit" className="reset-submit" disabled={status === 'loading'}>
              {status === 'loading' ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        )}

        <div className="reset-footer">
          <button type="button" onClick={goToSignin} className="reset-link">
            Back to sign in
          </button>
        </div>
      </div>

      <style>{`
        .reset-container {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: var(--color-bg);
          padding: 2rem;
          font-family: var(--font-sans);
          overflow-y: auto;
        }

        .reset-card {
          margin: auto 0;
          width: 100%;
          max-width: 420px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 1rem;
          padding: 2rem;
          backdrop-filter: none;
          animation: fadeIn 0.5s ease;
        }

        .reset-header {
          text-align: center;
          margin-bottom: 1.5rem;
        }

        .reset-logo {
          font-size: 2.5rem;
          margin-bottom: 0.75rem;
        }

        .reset-header h1 {
          font-size: 1.6rem;
          font-weight: 700;
          color: var(--color-text);
          margin: 0 0 0.25rem;
        }

        .reset-header p {
          color: var(--color-text-dim);
          margin: 0;
          font-size: 0.9rem;
        }

        .reset-message {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          border-radius: 0.6rem;
          margin-bottom: 1rem;
          font-size: 0.9rem;
        }

        .reset-message.error {
          background: var(--color-surface-error);
          color: var(--color-content-on-error);
          border: 1px solid var(--color-danger);
        }

        .reset-message.success {
          background: var(--color-surface-success);
          color: var(--color-content-on-success);
          border: 1px solid var(--color-success);
        }

        .reset-message.info {
          background: var(--color-surface-elevated);
          color: var(--color-text-dim);
          border: 1px solid var(--color-border);
        }

        .reset-form .form-group {
          margin-bottom: 1rem;
        }

        .reset-form label {
          display: block;
          color: var(--color-text-dim);
          margin-bottom: 0.4rem;
          font-size: 0.85rem;
        }

        .reset-form input {
          width: 100%;
          padding: 0.75rem 0.9rem;
          border-radius: 0.6rem;
          border: 1px solid var(--color-border);
          background: var(--color-bg);
          color: var(--color-text);
          outline: none;
        }

        .reset-submit {
          width: 100%;
          margin-top: 0.5rem;
          padding: 0.8rem;
          border: none;
          border-radius: 0.6rem;
          background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
          color: var(--color-content-on-primary);
          font-weight: 700;
          cursor: pointer;
        }

        .reset-footer {
          margin-top: 1rem;
          text-align: center;
        }

        .reset-link {
          background: none;
          border: none;
          color: var(--color-text-dim);
          cursor: pointer;
          text-decoration: underline;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};
