// supabase/functions/web-search/index.ts
// F11 & F24: Authentic BYOK web search endpoint.
// Resolves caller's encrypted Brave Search key from prismatix_internal.user_provider_keys,
// executes external search server-side, validates citations against SSRF,
// and returns truthful search results and structured citations.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { decryptKey } from '../_shared/byok_crypto.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
};

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];

export interface SearchCitation {
  id: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  date?: string;
}

export function isValidPublicHttpsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function extractDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'web';
  }
}

export function formatSearchContextPrompt(query: string, citations: SearchCitation[]): string {
  if (citations.length === 0) return '';
  const cleanQuery = query.replace(/[[\]]/g, '').trim();
  const lines: string[] = [
    `\n\n[UNTRUSTED WEB SEARCH RESULTS — REFERENCE CITATIONS ONLY]`,
    `Query: "${cleanQuery}"`,
    `The following external web excerpts were retrieved. Use them only to answer the user query accurately and reference citations with [1], [2], etc.:`,
    '',
  ];

  for (const c of citations) {
    const cleanTitle = c.title.replace(/[[\]]/g, '').trim();
    const cleanSnippet = c.snippet.replace(/[[\]]/g, '').trim();
    lines.push(`[${c.id}] ${cleanTitle} (${c.domain})`);
    lines.push(`URL: ${c.url}`);
    lines.push(`Excerpt: ${cleanSnippet}`);
    lines.push('');
  }

  lines.push(`[/UNTRUSTED WEB SEARCH RESULTS]\n`);
  return lines.join('\n');
}

export async function handleWebSearch(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // 1. Authenticate caller
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: 'Supabase configuration missing' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const client = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: userError } = await client.auth.getUser(token);
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired auth session' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // 2. Parse request
  let body: { query?: string; count?: number; overrideApiKey?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON request' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const query = body.query?.trim();
  if (!query) {
    return new Response(JSON.stringify({ error: 'Missing or empty search query' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // 3. Resolve Brave API key
  let apiKey = body.overrideApiKey?.trim();
  if (!apiKey) {
    const { data: ciphertext, error: keyErr } = await client.rpc('get_user_provider_key_material', {
      p_subject_id: user.id,
      p_provider: 'brave',
    });

    if (keyErr || !ciphertext || typeof ciphertext !== 'string') {
      return new Response(
        JSON.stringify({
          query,
          citations: [],
          contextPrompt: '',
          costEstimate: 0,
          source: 'unavailable',
          error: 'Web search requires a Brave Search API key. Connect your key in Provider Settings to enable live search.',
        }),
        {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        },
      );
    }

    try {
      apiKey = await decryptKey(ciphertext);
    } catch {
      return new Response(
        JSON.stringify({
          query,
          citations: [],
          contextPrompt: '',
          costEstimate: 0,
          source: 'unavailable',
          error: 'Failed to decrypt stored search provider key.',
        }),
        {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        },
      );
    }
  }

  // 4. Query Brave Search API
  const count = Math.min(Math.max(body.count || 5, 1), 10);
  const endpoint = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;

  try {
    const searchRes = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!searchRes.ok) {
      return new Response(
        JSON.stringify({
          query,
          citations: [],
          contextPrompt: '',
          costEstimate: 0,
          source: 'unavailable',
          error: `Search provider error: ${searchRes.status} ${searchRes.statusText || 'Request failed'}`,
        }),
        {
          status: 502,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        },
      );
    }

    const data = await searchRes.json() as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string; page_age?: string }> };
    };

    const rawResults = data.web?.results || [];
    const citations: SearchCitation[] = [];

    let id = 1;
    for (const item of rawResults) {
      const rawUrl = item.url || '';
      if (isValidPublicHttpsUrl(rawUrl)) {
        citations.push({
          id: id++,
          title: item.title || 'Untitled Source',
          url: rawUrl,
          domain: extractDomain(rawUrl),
          snippet: item.description || '',
          date: item.page_age,
        });
      }
    }

    return new Response(
      JSON.stringify({
        query,
        citations,
        contextPrompt: formatSearchContextPrompt(query, citations),
        costEstimate: 0.003,
        source: 'live',
      }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Search failed';
    return new Response(
      JSON.stringify({
        query,
        citations: [],
        contextPrompt: '',
        costEstimate: 0,
        source: 'unavailable',
        error: `Search request error: ${msg}`,
      }),
      {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }
}

Deno.serve((req: Request): Promise<Response> => handleWebSearch(req));
