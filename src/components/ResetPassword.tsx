// ResetPassword.tsx - Password recovery UI for Supabase email links

import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/Auth.css';

type Status = 'idle' | 'loading' | 'success' | 'error' | 'invalid';
type ResetField = 'newPassword' | 'confirmPassword';

const RESET_ERROR_ID = 'reset-field-error';

export const ResetPassword: React.FC = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<ResetField | null>(null);
  const [checking, setChecking] = useState(true);

  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);

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

  const focusField = (field: ResetField | null) => {
    queueMicrotask(() => {
      if (field === 'newPassword') {
        passwordRef.current?.focus();
        return;
      }
      if (field === 'confirmPassword') {
        confirmPasswordRef.current?.focus();
        return;
      }
      formErrorRef.current?.focus();
    });
  };

  const reportError = (text: string, field: ResetField | null = null) => {
    setStatus('error');
    setMessage(text);
    setErrorField(field);
    focusField(field);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setErrorField(null);

    if (!password || password.length < 6) {
      reportError('Password must be at least 6 characters.', 'newPassword');
      return;
    }
    if (password !== confirmPassword) {
      reportError('Passwords do not match.', 'confirmPassword');
      return;
    }

    setStatus('loading');
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      reportError(error.message, 'newPassword');
      return;
    }

    setStatus('success');
    setMessage('Password updated. You can sign in now.');
    setErrorField(null);
    await supabase.auth.signOut();
  };

  const goToSignin = () => {
    window.location.href = '/';
  };

  return (
    <div className="reset-container">
      <div className="reset-card">
        <div className="reset-header">
          <img className="reset-logo" src="/prismatix-icon-draft.svg" alt="" />
          <h1>Reset Password</h1>
          <p>Set a new password for your account</p>
        </div>

        {checking && (
          <div className="reset-message info" role="status">
            <span className="reset-message-icon" aria-hidden="true">…</span>
            <span>Validating reset link...</span>
          </div>
        )}

        {!checking && status === 'invalid' && (
          <div className="reset-message error" role="alert">
            <span className="reset-message-icon" aria-hidden="true">!</span>
            <span>Reset link is invalid or expired. Please request a new one.</span>
          </div>
        )}

        {!checking && message && status !== 'invalid' && (
          <div
            id={status === 'error' ? RESET_ERROR_ID : undefined}
            ref={status === 'error' ? formErrorRef : undefined}
            className={`reset-message ${status === 'success' ? 'success' : 'error'}`}
            role={status === 'success' ? 'status' : 'alert'}
            tabIndex={status === 'error' ? -1 : undefined}
          >
            <span className="reset-message-icon" aria-hidden="true">{status === 'success' ? 'OK' : '!'}</span>
            <span>{message}</span>
          </div>
        )}

        {!checking && status !== 'invalid' && (
          <form onSubmit={handleSubmit} className="reset-form" noValidate>
            <div className="form-group">
              <label htmlFor="newPassword">New Password</label>
              <input
                id="newPassword"
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="********"
                disabled={status === 'loading'}
                autoComplete="new-password"
                aria-invalid={errorField === 'newPassword' ? true : undefined}
                aria-describedby={errorField === 'newPassword' ? RESET_ERROR_ID : undefined}
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                ref={confirmPasswordRef}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="********"
                disabled={status === 'loading'}
                autoComplete="new-password"
                aria-invalid={errorField === 'confirmPassword' ? true : undefined}
                aria-describedby={errorField === 'confirmPassword' ? RESET_ERROR_ID : undefined}
              />
            </div>

            <button type="submit" className="reset-submit" disabled={status === 'loading'} aria-label="Update password">
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
    </div>
  );
};
