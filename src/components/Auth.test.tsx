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
    expect(container?.textContent).toContain('Adaptive Model Selection');

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
});
