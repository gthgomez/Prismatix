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
    resetPassword,
    signInWithProvider,
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
          <div className="loading-logo">🤖</div>
          <div className="loading-spinner-large" />
          <p>Initializing Prismatix...</p>
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
        />
      </div>
    );
  }

  return (
    <div className="app app--chat">
      <ChatInterface user={user} onSignOut={signOut} />
    </div>
  );
}
