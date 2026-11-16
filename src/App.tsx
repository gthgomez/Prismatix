// App.tsx - Root route switch for public resume pages and auth-gated app

import React, { Suspense } from 'react';
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

function App() {
  useViewportHeight();

  if (isPublicResumeRoute()) {
    return <ResumeDemo />;
  }

  return (
    <StartupErrorBoundary>
      <Suspense
        fallback={
          <div className="loading">
            <div className="loading-spinner" />
            <div>Loading Prismatix...</div>
          </div>
        }
      >
        <AuthenticatedApp />
      </Suspense>
    </StartupErrorBoundary>
  );
}

export default App;
