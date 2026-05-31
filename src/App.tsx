// App.tsx - Root route switch for public resume pages and auth-gated app

import React, { Suspense } from 'react';
import { ResumeDemo } from './components/ResumeDemo';
import { useViewportHeight } from './hooks/useViewportHeight';

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
  );
}

export default App;
