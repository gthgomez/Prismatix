// supabase/functions/page-reader/index.ts
// F23: Server-side secure webpage ingestion with strict SSRF defense.
// Authenticates requests, enforces per-user rate limits, blocks loopback, private RFC 1918,
// cloud metadata IMDS (169.254.169.254), resolves and validates DNS addresses to prevent DNS rebinding,
// validates each redirect hop (max 3), enforces a 2MB streaming byte cap,
// 10-second timeout, and extracts clean, safe text content.

import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
};

const MAX_BYTES = 2 * 1024 * 1024; // 2MB streaming limit
const TIMEOUT_MS = 10000; // 10 seconds
const MAX_REDIRECTS = 3;

// Rate limiting: 15 requests per minute per authenticated user
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 15;
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  entry.count++;
  return true;
}

export interface SsrfCheckResult {
  valid: boolean;
  reason?: string;
}

export function isPrivateIp(ip: string): { isPrivate: boolean; reason?: string } {
  const clean = ip.replace(/^\[|\]$/g, '').trim().toLowerCase();

  // IPv4 check
  if (clean.includes('.')) {
    const parts = clean.split('.');
    if (parts.length === 4) {
      const b0 = parseInt(parts[0] ?? '0', 10);
      const b1 = parseInt(parts[1] ?? '0', 10);

      if (b0 === 127) return { isPrivate: true, reason: 'Loopback 127.0.0.0/8 is prohibited' };
      if (b0 === 0) return { isPrivate: true, reason: 'Current/broadcast network 0.0.0.0/8 is prohibited' };
      if (b0 === 10) return { isPrivate: true, reason: 'Private Class A 10.0.0.0/8 is prohibited' };
      if (b0 === 172 && b1 >= 16 && b1 <= 31) return { isPrivate: true, reason: 'Private Class B 172.16.0.0/12 is prohibited' };
      if (b0 === 192 && b1 === 168) return { isPrivate: true, reason: 'Private Class C 192.168.0.0/16 is prohibited' };
      if (b0 === 169 && b1 === 254) return { isPrivate: true, reason: 'Cloud IMDS / link-local 169.254.0.0/16 is prohibited' };
      if (b0 === 100 && b1 >= 64 && b1 <= 127) return { isPrivate: true, reason: 'Carrier-grade NAT 100.64.0.0/10 is prohibited' };
      if (b0 >= 224) return { isPrivate: true, reason: 'Multicast or reserved IP space is prohibited' };
    }
  }

  // IPv6 check
  if (
    clean === '::1' ||
    clean.startsWith('fe80:') ||
    clean.startsWith('fc00:') ||
    clean.startsWith('fd00:') ||
    clean.startsWith('::ffff:127.') ||
    clean.startsWith('::ffff:10.') ||
    clean.startsWith('::ffff:172.') ||
    clean.startsWith('::ffff:192.168.') ||
    clean.startsWith('::ffff:169.254.')
  ) {
    return { isPrivate: true, reason: 'Private or loopback IPv6 address is prohibited' };
  }

  return { isPrivate: false };
}

export function validateUrlForSsrf(rawUrl: string): SsrfCheckResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: 'Invalid URL syntax' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `Disallowed protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted.` };
  }

  const hostname = parsed.hostname.toLowerCase().trim();

  // Local/Internal domain suffixes
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'local' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.corp') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.home') ||
    hostname.endsWith('.arpa')
  ) {
    return { valid: false, reason: 'Targeting local/internal network domains is prohibited.' };
  }

  // Direct IP checks
  const ipCheck = isPrivateIp(hostname);
  if (ipCheck.isPrivate) {
    return { valid: false, reason: ipCheck.reason };
  }

  return { valid: true };
}

export async function validateHostDns(hostname: string): Promise<SsrfCheckResult> {
  const cleanHost = hostname.replace(/^\[|\]$/g, '').trim().toLowerCase();

  // If already directly an IP, validate directly
  const directIpCheck = isPrivateIp(cleanHost);
  if (directIpCheck.isPrivate) {
    return { valid: false, reason: directIpCheck.reason };
  }

  // Perform DNS resolution in Deno runtime
  if (typeof Deno !== 'undefined' && typeof Deno.resolveDns === 'function') {
    try {
      const aRecords = await Deno.resolveDns(cleanHost, 'A').catch(() => []);
      const aaaaRecords = await Deno.resolveDns(cleanHost, 'AAAA').catch(() => []);
      const allIps = [...aRecords, ...aaaaRecords];

      if (allIps.length === 0) {
        return { valid: false, reason: `DNS resolution failed: no IP address resolved for host "${cleanHost}"` };
      }

      for (const resolvedIp of allIps) {
        const check = isPrivateIp(resolvedIp);
        if (check.isPrivate) {
          return { valid: false, reason: `DNS resolves host "${cleanHost}" to prohibited private IP ${resolvedIp} (${check.reason})` };
        }
      }
    } catch (dnsErr) {
      return { valid: false, reason: `DNS resolution error for "${cleanHost}": ${dnsErr instanceof Error ? dnsErr.message : String(dnsErr)}` };
    }
  }

  return { valid: true };
}

export function extractCleanText(html: string): { title: string; description?: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : 'Web Page';

  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
  const description = descMatch && descMatch[1] ? descMatch[1].trim() : undefined;

  let cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');

  cleaned = cleaned.replace(/<(?:p|div|h[1-6]|li|br|hr|tr)[^>]*>/gi, '\n');
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');

  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const lines = cleaned
    .split('\n')
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter((l) => l.length > 0);

  const text = lines.join('\n\n').slice(0, 40000);

  return { title, description, text };
}

export async function fetchWithSsrfProtection(
  targetUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; text: string; finalUrl: string; error?: string }> {
  let currentUrl = targetUrl;
  let hops = 0;

  while (hops <= MAX_REDIRECTS) {
    const ssrfCheck = validateUrlForSsrf(currentUrl);
    if (!ssrfCheck.valid) {
      return { ok: false, status: 400, text: '', finalUrl: currentUrl, error: `SSRF Violation: ${ssrfCheck.reason}` };
    }

    const parsed = new URL(currentUrl);
    const dnsCheck = await validateHostDns(parsed.hostname);
    if (!dnsCheck.valid) {
      return { ok: false, status: 400, text: '', finalUrl: currentUrl, error: `SSRF Violation: ${dnsCheck.reason}` };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetchFn(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PrismatixPageReader/1.0',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
        },
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : 'Fetch failed';
      return { ok: false, status: 502, text: '', finalUrl: currentUrl, error: `Connection failed: ${msg}` };
    } finally {
      clearTimeout(timeout);
    }

    // Check for redirects (301, 302, 303, 307, 308)
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) {
        return { ok: false, status: res.status, text: '', finalUrl: currentUrl, error: 'Redirect missing Location header' };
      }
      // Resolve relative redirects
      const nextUrl = new URL(location, currentUrl).toString();
      hops++;
      if (hops > MAX_REDIRECTS) {
        return { ok: false, status: 310, text: '', finalUrl: currentUrl, error: 'Too many redirects (max 3)' };
      }
      currentUrl = nextUrl;
      continue;
    }

    if (!res.ok) {
      return { ok: false, status: res.status, text: '', finalUrl: currentUrl, error: `HTTP ${res.status} ${res.statusText}` };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return { ok: false, status: 415, text: '', finalUrl: currentUrl, error: `Unsupported content-type "${contentType}"` };
    }

    // Streaming read with byte cap (2MB)
    if (!res.body) {
      return { ok: true, status: res.status, text: '', finalUrl: currentUrl };
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          receivedBytes += value.byteLength;
          if (receivedBytes > MAX_BYTES) {
            reader.cancel();
            return { ok: false, status: 413, text: '', finalUrl: currentUrl, error: 'Response body exceeds 2MB limit' };
          }
          chunks.push(value);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Read error';
      return { ok: false, status: 502, text: '', finalUrl: currentUrl, error: `Body read error: ${msg}` };
    }

    const total = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const c of chunks) {
      total.set(c, offset);
      offset += c.byteLength;
    }
    const decodedText = new TextDecoder('utf-8', { fatal: false }).decode(total);

    return { ok: true, status: res.status, text: decodedText, finalUrl: currentUrl };
  }

  return { ok: false, status: 310, text: '', finalUrl: currentUrl, error: 'Redirect loop exceeded' };
}

export async function handlePageReader(req: Request): Promise<Response> {
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
    return new Response(JSON.stringify({ error: 'Authentication required to ingest URLs' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  let userId = 'authenticated_user';

  if (supabaseUrl && supabaseServiceKey) {
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired authentication session' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    userId = user.id;
  }

  // 2. Enforce user-level rate limiting
  if (!checkRateLimit(userId)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded: Please wait before requesting another URL' }), {
      status: 429,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const rawUrl = body.url?.trim();
  if (!rawUrl) {
    return new Response(JSON.stringify({ error: 'Missing "url" parameter' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const result = await fetchWithSsrfProtection(rawUrl);
  if (!result.ok) {
    return new Response(
      JSON.stringify({ success: false, error: result.error, status: result.status }),
      {
        status: result.status >= 400 && result.status < 600 ? result.status : 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }

  const extracted = extractCleanText(result.text);

  return new Response(
    JSON.stringify({
      success: true,
      data: {
        url: result.finalUrl,
        title: extracted.title,
        description: extracted.description,
        textContent: extracted.text,
        charCount: extracted.text.length,
        estimatedTokens: Math.ceil(extracted.text.length / 4),
      },
    }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    },
  );
}

Deno.serve((req: Request): Promise<Response> => handlePageReader(req));
