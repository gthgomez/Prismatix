const ENV_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim() || '';
export const ENV_ROUTER_ENDPOINT = import.meta.env.VITE_ROUTER_ENDPOINT?.trim() || '';
const DERIVED_SUPABASE_URL = ENV_ROUTER_ENDPOINT
  ? String(ENV_ROUTER_ENDPOINT).replace(/\/functions\/v1\/router$/, '')
  : '';

export function hostOf(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}

// The public demo is scripted and does not call Supabase. Keep a synthetic
// client configuration only on that explicitly labelled route so importing
// shared UI cannot accidentally make a real route look configured.
const IS_SYNTHETIC_DEMO = typeof window !== 'undefined' && window.location.pathname === '/demo';
const configuredUrl = ENV_SUPABASE_URL || DERIVED_SUPABASE_URL;
export const SUPABASE_URL = /^https?:\/\//i.test(configuredUrl) && hostOf(configuredUrl)
  ? configuredUrl
  : (IS_SYNTHETIC_DEMO ? 'https://mock.supabase.co' : '');
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || (IS_SYNTHETIC_DEMO ? 'synthetic-demo-anon-key' : '');
