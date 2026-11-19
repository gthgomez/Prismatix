// config.ts - Configuration and environment variables
import { MODEL_CATALOG } from './modelCatalog';

import { ENV_ROUTER_ENDPOINT, SUPABASE_URL, SUPABASE_ANON_KEY, hostOf } from './backendConfig';

const ENABLE_VIDEO_PIPELINE = (() => {
  const raw = String(import.meta.env.VITE_ENABLE_VIDEO_PIPELINE || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
})();

// PX01: signup UI is gated behind VITE_ALLOW_SIGNUP and defaults to OFF.
// The committed local Supabase config enables beta signup, so production
// signup/confirmation policy must be verified separately; this flag controls
// only the client UI and is not a server authorization boundary.
const ALLOW_SIGNUP = (() => {
  const raw = String(import.meta.env.VITE_ALLOW_SIGNUP || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
})();

function functionEndpoint(name: string): string {
  if (!SUPABASE_URL) return '';
  return `${String(SUPABASE_URL).replace(/\/$/, '')}/functions/v1/${name}`;
}

const ROUTER_ENDPOINT = (() => {
  if (ENV_ROUTER_ENDPOINT && hostOf(ENV_ROUTER_ENDPOINT) === hostOf(SUPABASE_URL)) {
    return ENV_ROUTER_ENDPOINT;
  }
  if (SUPABASE_URL) {
    return `${String(SUPABASE_URL).replace(/\/$/, '')}/functions/v1/router`;
  }
  return '';
})();

export const CONFIG = {
  // Supabase Configuration
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  
  // Router Endpoint (modern format: https://[PROJECT_ID].supabase.co/functions/v1/[function-name])
  ROUTER_ENDPOINT,
  VIDEO_INTAKE_ENDPOINT: functionEndpoint('video-intake'),
  VIDEO_STATUS_ENDPOINT: functionEndpoint('video-status'),
  PROVIDER_SETTINGS_ENDPOINT: functionEndpoint('provider-settings'),
  MEMORY_ENDPOINT: functionEndpoint('memory'),
  
  // Platform Detection
  PLATFORM: (() => {
    const ua = navigator.userAgent;
    if (/Android|iPhone|iPad|iPod/i.test(ua)) return 'mobile';
    if (/Electron/i.test(ua)) return 'desktop';
    return 'web';
  })() as 'web' | 'mobile' | 'desktop',
  
  // Model Configuration
  MODELS: MODEL_CATALOG,
  ENABLE_VIDEO_PIPELINE,
  ALLOW_SIGNUP,
} as const;

// Validate required config
if (!CONFIG.SUPABASE_URL) {
  console.warn('⚠️ Supabase URL not configured. Authenticated routes are unavailable.');
}
if (!CONFIG.SUPABASE_ANON_KEY) {
  console.warn('⚠️ VITE_SUPABASE_ANON_KEY not set. Authenticated routes are unavailable.');
}
if (!CONFIG.ROUTER_ENDPOINT) {
  console.warn('⚠️ VITE_ROUTER_ENDPOINT not set. Router requests will fail.');
}
if (ENV_ROUTER_ENDPOINT && hostOf(ENV_ROUTER_ENDPOINT) !== hostOf(CONFIG.SUPABASE_URL)) {
  console.warn('⚠️ VITE_ROUTER_ENDPOINT host does not match VITE_SUPABASE_URL. Using SUPABASE_URL for router.');
}
