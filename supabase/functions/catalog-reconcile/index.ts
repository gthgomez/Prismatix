import { createClient } from 'npm:@supabase/supabase-js@2';
import { loadModelsDevMetadata } from '../_shared/models_dev_metadata.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRole) return Response.json({ error: 'catalog_unavailable' }, { status: 503 });
  if (req.headers.get('Authorization') !== `Bearer ${serviceRole}`) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  const store = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  await loadModelsDevMetadata('openai', store);
  const { data, error } = await store.rpc('get_provider_catalog_snapshot');
  const fetchedAt = typeof data?.fetched_at === 'string' ? data.fetched_at : undefined;
  if (error || !fetchedAt || Date.now() - Date.parse(fetchedAt) >= 6 * 60 * 60 * 1000) {
    return Response.json({ error: 'catalog_refresh_unavailable', lastSuccessfulRefresh: fetchedAt ?? null }, { status: 503 });
  }
  return Response.json({ version: data.version, lastSuccessfulRefresh: fetchedAt });
});
