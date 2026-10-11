import { ChatInterface } from './ChatInterface';
import { Auth } from './Auth';
import { ResetPassword } from './ResetPassword';
import { useAuth } from '../hooks/useAuth';

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
  const {
    isAuthenticated,
    isLoading,
    user,
    signIn,
    signUp,
    signOut,
    signInWithProvider,
  } = useAuth();

  if (isRecoveryFlow()) {
    return (
      <div className="app">
        <ResetPassword />

        <style>{`
          html, body, #root {
            margin: 0;
            padding: 0;
            height: 100%;
            overflow: auto;
          }

          .app {
            height: 100%;
            width: 100%;
          }

        `}</style>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="app loading-screen">
        <div className="loading-content">
          <div className="loading-logo">🤖</div>
          <div className="loading-spinner-large" />
          <p>Initializing Prismatix...</p>
        </div>

        <style>{`
          .loading-screen {
            height: calc(var(--app-vh, 1vh) * 100);
            min-height: 100dvh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--color-bg);
            font-family: var(--font-sans);
          }

          .loading-content {
            text-align: center;
            color: var(--color-text-dim);
          }

          .loading-logo {
            font-size: 4rem;
            margin-bottom: 1.5rem;
            animation: float 3s ease-in-out infinite;
          }

          .loading-spinner-large {
            width: 40px;
            height: 40px;
            margin: 0 auto 1rem;
            border: 3px solid rgba(78, 205, 196, 0.2);
            border-top-color: var(--color-primary);
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }

          .loading-content p {
            font-size: 0.9rem;
            color: var(--color-text-muted);
          }

          @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
          }

          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="app">
        <Auth
          onSignIn={signIn}
          onSignUp={signUp}
          onSignInWithProvider={signInWithProvider}
        />

        <style>{`
          html, body, #root {
            margin: 0;
            padding: 0;
            height: 100%;
            overflow: auto;
          }

          .app {
            height: 100%;
            width: 100%;
          }

        `}</style>
      </div>
    );
  }

  return (
    <div className="app">
      <ChatInterface user={user} onSignOut={signOut} />

      <style>{`
        html, body, #root {
          margin: 0;
          padding: 0;
          height: 100%;
          overflow: hidden;
        }

        .app {
          height: 100%;
          width: 100%;
        }

      `}</style>
    </div>
  );
}
