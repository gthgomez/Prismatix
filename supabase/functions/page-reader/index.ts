// supabase/functions/page-reader/index.ts
// F23: Server-side secure webpage ingestion with strict SSRF defense.
// Blocks loopback, private RFC 1918, cloud metadata IMDS (169.254.169.254),
// validates each redirect hop (max 3), enforces a 2MB streaming byte cap,
// 10-second timeout, and extracts clean, safe text content.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
};

const MAX_BYTES = 2 * 1024 * 1024; // 2MB streaming limit
const TIMEOUT_MS = 10000; // 10 seconds
const MAX_REDIRECTS = 3;

export interface SsrfCheckResult {
  valid: boolean;
  reason?: string;
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

  // IPv6 loopback & private / link-local
  if (
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.startsWith('fe80:') ||
    hostname.startsWith('[fe80:') ||
    hostname.startsWith('fc00:') ||
    hostname.startsWith('[fc00:') ||
    hostname.startsWith('fd00:') ||
    hostname.startsWith('[fd00:')
  ) {
    return { valid: false, reason: 'Targeting private or loopback IPv6 addresses is prohibited.' };
  }

  const cleanHost = hostname.replace(/^\[|\]$/g, '');
  const isNumericIp = /^(\d+|0x[0-9a-fA-F]+)(\.(\d+|0x[0-9a-fA-F]+)){0,3}$/.test(cleanHost);

  if (isNumericIp) {
    const parts = cleanHost.split('.');
    if (parts.length === 4) {
      const b0 = parseInt(parts[0] ?? '0', 10);
      const b1 = parseInt(parts[1] ?? '0', 10);

      // Loopback 127.0.0.0/8
      if (b0 === 127) return { valid: false, reason: 'Loopback address (127.0.0.0/8) is prohibited.' };
      // Broadcast / Current network 0.0.0.0/8
      if (b0 === 0) return { valid: false, reason: 'Broadcast network (0.0.0.0/8) is prohibited.' };
      // Private Class A 10.0.0.0/8
      if (b0 === 10) return { valid: false, reason: 'Private network (10.0.0.0/8) is prohibited.' };
      // Private Class B 172.16.0.0/12
      if (b0 === 172 && b1 >= 16 && b1 <= 31) return { valid: false, reason: 'Private network (172.16.0.0/12) is prohibited.' };
      // Private Class C 192.168.0.0/16
      if (b0 === 192 && b1 === 168) return { valid: false, reason: 'Private network (192.168.0.0/16) is prohibited.' };
      // Link Local & Cloud IMDS (169.254.0.0/16)
      if (b0 === 169 && b1 === 254) return { valid: false, reason: 'Cloud instance metadata and link-local address (169.254.0.0/16) is prohibited.' };
      // Carrier-Grade NAT (100.64.0.0/10)
      if (b0 === 100 && b1 >= 64 && b1 <= 127) return { valid: false, reason: 'Carrier-grade NAT space is prohibited.' };
      // Multicast / Reserved (224.0.0.0/4 and above)
      if (b0 >= 224) return { valid: false, reason: 'Multicast or reserved IP space is prohibited.' };
    } else {
      try {
        const num = parseInt(cleanHost, 10);
        const b0 = (num >> 24) & 255;
        if (b0 === 127 || b0 === 10 || b0 === 169 || b0 === 192 || b0 === 172) {
          return { valid: false, reason: 'Numeric internal IP representation is prohibited.' };
        }
      } catch {
        return { valid: false, reason: 'Invalid numeric IP representation.' };
      }
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
