// App.tsx - Root route switch for public resume pages and auth-gated app

import React, { Suspense, useEffect, useState } from 'react';
import { ResumeDemo } from './components/ResumeDemo';
import { useViewportHeight } from './hooks/useViewportHeight';

type StartupRecoveryWindow = Window & {
  __prismatixStartupFailure?: () => void;
  __prismatixStartupUpdate?: () => void;
  __prismatixStartupRetry?: () => void;
};

interface StartupBoundaryState {
  hasError: boolean;
}

class StartupErrorBoundary extends React.Component<React.PropsWithChildren, StartupBoundaryState> {
  state: StartupBoundaryState = { hasError: false };

  static getDerivedStateFromError(): StartupBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(): void {
    (window as StartupRecoveryWindow).__prismatixStartupUpdate?.();
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="startup-recovery" role="alert">
          <h1>Prismatix could not finish loading</h1>
          <p>The app files may have changed. Prismatix checked for an update. Reload to try again.</p>
          <button
            type="button"
            onClick={() => {
              const retry = (window as StartupRecoveryWindow).__prismatixStartupRetry;
              if (retry) retry();
              else window.location.reload();
            }}
          >
            Reload Prismatix
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

const AuthenticatedApp = React.lazy(() =>
  import('./components/AuthenticatedApp').then((module) => ({
    default: module.AuthenticatedApp,
  })),
);

function isPublicResumeRoute(): boolean {
  return window.location.pathname === '/demo' || window.location.pathname === '/about';
}

function StartupLoadingFallback() {
  const [isTakingLonger, setIsTakingLonger] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsTakingLonger(true), 10000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="loading" role={isTakingLonger ? 'status' : undefined}>
      <div className="loading-spinner" />
      <div>Loading Prismatix...</div>
      {isTakingLonger && (
        <div className="loading-recovery">
          <p>Sign-in is taking longer than expected. It may still finish loading.</p>
          <button
            type="button"
            onClick={() => {
              const retry = (window as StartupRecoveryWindow).__prismatixStartupRetry;
              if (retry) retry();
              else window.location.reload();
            }}
          >
            Retry loading Prismatix
          </button>
        </div>
      )}
    </div>
  );
}

function App() {
  useViewportHeight();

  if (isPublicResumeRoute()) {
    return <ResumeDemo />;
  }

  return (
    <StartupErrorBoundary>
      <Suspense
        fallback={<StartupLoadingFallback />}
      >
        <AuthenticatedApp />
      </Suspense>
    </StartupErrorBoundary>
  );
}

export default App;
