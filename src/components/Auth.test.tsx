import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from './Auth';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Auth component', () => {
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container) {
      document.body.removeChild(container);
      container = null;
    }
  });

  it('renders sign-in form with private beta notice and demo link when signup is disabled', async () => {
    const onSignIn = vi.fn().mockResolvedValue({ error: null });
    const onSignUp = vi.fn().mockResolvedValue({ error: null });

    const root = createRoot(container!);
    await act(async () => {
      root.render(<Auth onSignIn={onSignIn} onSignUp={onSignUp} />);
    });

    // Check heading
    expect(container?.textContent).toContain('Prismatix');
    expect(container?.textContent).toContain('Sign in to your AI workspace.');

    // Tab switcher should not be rendered when signup is disabled
    expect(container?.querySelector('.auth-tabs')).toBeNull();

    // Beta notice should be displayed with demo link
    const betaNotice = container?.querySelector('.auth-beta-notice');
    expect(betaNotice).not.toBeNull();
    expect(betaNotice?.textContent).toContain('Public registration is currently unavailable');
    const demoLink = betaNotice?.querySelector('a[href="/demo"]');
    expect(demoLink).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('validates required email and password fields on submit', async () => {
    const onSignIn = vi.fn().mockResolvedValue({ error: null });
    const onSignUp = vi.fn().mockResolvedValue({ error: null });

    const root = createRoot(container!);
    await act(async () => {
      root.render(<Auth onSignIn={onSignIn} onSignUp={onSignUp} />);
    });

    const submitBtn = container?.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    expect(submitBtn).not.toBeNull();

    await act(async () => {
      submitBtn?.click();
    });

    expect(container?.textContent).toContain('Email is required');
    expect(onSignIn).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('prevents password reset from overlapping a pending sign-in', async () => {
    let finishSignIn!: (result: { error: Error | null }) => void;
    const onSignIn = vi.fn(() => new Promise<{ error: Error | null }>((resolve) => { finishSignIn = resolve; }));
    const onSignUp = vi.fn().mockResolvedValue({ error: null });
    const onResetPassword = vi.fn().mockResolvedValue({ error: null });
    const onRetrySessionCheck = vi.fn();

    const root = createRoot(container!);
    await act(async () => {
      root.render(<Auth onSignIn={onSignIn} onSignUp={onSignUp} onResetPassword={onResetPassword}
        sessionCheckError='Could not restore your session.' onRetrySessionCheck={onRetrySessionCheck} />);
    });
    await act(async () => {
      const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      const email = container?.querySelector('#email') as HTMLInputElement;
      setInputValue.call(email, 'user@example.com');
      email.dispatchEvent(new Event('input', { bubbles: true }));
      const password = container?.querySelector('#password') as HTMLInputElement;
      setInputValue.call(password, 'password');
      password.dispatchEvent(new Event('input', { bubbles: true }));
      container?.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    const forgot = container?.querySelector('.forgot-link') as HTMLButtonElement;
    const retry = container?.querySelector('.auth-session-retry') as HTMLButtonElement;
    expect(forgot.disabled).toBe(true);
    expect(retry.disabled).toBe(true);
    await act(async () => { forgot.click(); retry.click(); });
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onResetPassword).not.toHaveBeenCalled();
    expect(onRetrySessionCheck).not.toHaveBeenCalled();

    await act(async () => { finishSignIn({ error: null }); });
    expect(forgot.disabled).toBe(false);
    await act(async () => { root.unmount(); });
  });

  it('shows a recoverable saved-session check failure', async () => {
    const onRetrySessionCheck = vi.fn();
    const root = createRoot(container!);
    await act(async () => {
      root.render(
        <Auth
          onSignIn={vi.fn().mockResolvedValue({ error: null })}
          onSignUp={vi.fn().mockResolvedValue({ error: null })}
          sessionCheckError="Prismatix could not verify your saved session. Check your connection and retry, or sign in again."
          onRetrySessionCheck={onRetrySessionCheck}
        />
      );
    });
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain('could not verify your saved session');
    const retry = container?.querySelector('.auth-session-retry') as HTMLButtonElement;
    expect(retry.textContent).toBe('Retry session check');
    await act(async () => { retry.click(); });
    expect(onRetrySessionCheck).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
  });
});
