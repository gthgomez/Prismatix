import React, { Suspense, lazy, useLayoutEffect, useState } from 'react';
import { Auth } from './Auth';
import { ResetPassword } from './ResetPassword';
import { useAuth } from '../hooks/useAuth';

const ChatInterface = lazy(() => import('./ChatInterface').then((module) => ({ default: module.ChatInterface })));

function isRecoveryFlow(): boolean {
  const { pathname, search, hash } = window.location;
  if (pathname === '/reset-password') return true;

  const searchParams = new URLSearchParams(search);
  if (searchParams.get('type') === 'recovery') return true;

  const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  if (hashParams.get('type') === 'recovery') return true;

  return false;
}

export function AuthenticatedApp() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('prismatix-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#03070b' : '#f7faff');
    try {
      localStorage.setItem('prismatix-theme', theme);
    } catch {
      // Theme changes still apply for the current session.
    }
  }, [theme]);

  const {
    isAuthenticated,
    isLoading,
    user,
    signIn,
    signUp,
    signOut,
    resetPassword,
    signInWithProvider,
    sessionCheckError,
    retrySessionCheck,
  } = useAuth();

  if (isRecoveryFlow()) {
    return (
      <div className="app app--scroll">
        <ResetPassword />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="app app--chat loading-screen">
        <div className="loading-content">
          <img className="loading-logo loading-logo-mark" src="/prismatix-arctic-mark.svg" alt="" />
          <div className="loading-spinner-large" />
          <p role="status" aria-live="polite">Checking your saved session. This can take a little while on a slow connection.</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="app app--scroll">
        <Auth
          onSignIn={signIn}
          onSignUp={signUp}
          onSignInWithProvider={signInWithProvider}
          onResetPassword={resetPassword}
          sessionCheckError={sessionCheckError}
          onRetrySessionCheck={retrySessionCheck}
        />
      </div>
    );
  }

  return (
    <div className="app app--chat">
      <Suspense fallback={(
        <div className="loading-content" role="status" aria-live="polite">
          <img className="loading-logo loading-logo-mark" src="/prismatix-arctic-mark.svg" alt="" />
          <div className="loading-spinner-large" />
          <p>Loading your workspace...</p>
        </div>
      )}>
        <ChatInterface
          key={user?.id ?? 'no-user'}
          user={user}
          onSignOut={signOut}
          theme={theme}
          onToggleTheme={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
        />
      </Suspense>
    </div>
  );
}
