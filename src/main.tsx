// main.tsx - Application entry point

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CONFIG } from './config';
import './styles/Theme.css';
import './styles/mobile.css';
import { registerServiceWorker } from './services/pwaService';

type StartupRecoveryWindow = Window & { __prismatixStartupReady?: () => void };

// This module only evaluates once its entry dependencies have loaded. Remove
// any pre-React stalled-entry affordance now that startup has made progress.
(window as StartupRecoveryWindow).__prismatixStartupReady?.();

try {
  // Clear the bounded recovery marker only after this release's entry bundle
  // has loaded successfully.
  window.sessionStorage.removeItem('prismatix-startup-update-attempted');
} catch {
  // Storage may be unavailable in private browsing; startup remains usable.
}

registerServiceWorker();

function isPublicResumeRoute(): boolean {
  return window.location.pathname === '/demo' || window.location.pathname === '/about';
}

const missingVars = isPublicResumeRoute()
  ? []
  : [
      ...(!CONFIG.SUPABASE_URL ? ['VITE_SUPABASE_URL (or VITE_ROUTER_ENDPOINT)'] : []),
      ...(!CONFIG.SUPABASE_ANON_KEY ? ['VITE_SUPABASE_ANON_KEY'] : []),
    ];

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (missingVars.length > 0) {
  console.error('Missing required environment variables:', missingVars.join(', '));
  root.render(
    <main className="startup-recovery" role="alert">
      <h1>Prismatix is not configured</h1>
      <p>Sign-in and chat need a Supabase project URL and public anon key.</p>
      <p>Missing configuration: {missingVars.join(', ')}</p>
      <p>Set these in the deployment environment, then reload. The scripted demo remains available at /demo.</p>
    </main>,
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
