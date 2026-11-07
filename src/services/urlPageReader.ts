// src/services/urlPageReader.ts
// F23: Secure URL ingestion & page reading with strict SSRF defense.
// Validates URLs against internal/loopback/cloud metadata ranges, strips scripts/styles,
// and extracts clean readable markdown text for ingestion.

export interface ParsedUrlContent {
  url: string;
  title: string;
  description?: string;
  textContent: string;
  charCount: number;
  estimatedTokens: number;
}

export interface SsrfValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates a target URL against SSRF attacks (RFC 1918, loopback, cloud metadata IMDS).
 */
export function validateUrlForSsrf(rawUrl: string): SsrfValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: 'Invalid URL syntax' };
  }

  // 1. Only HTTP and HTTPS are permitted
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `Disallowed protocol "${parsed.protocol}". Only HTTP and HTTPS are allowed.` };
  }

  const hostname = parsed.hostname.toLowerCase().trim();

  // 2. Reject localhost or local domain names
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'local' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.corp') ||
    hostname.endsWith('.lan')
  ) {
    return { valid: false, reason: 'Targeting local/internal network domains is prohibited.' };
  }

  // 3. Reject IPv6 loopback and private/link-local ranges
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

  // 4. Check IPv4 dot-decimal and integer representations
  // Strip brackets if present
  const cleanHost = hostname.replace(/^\[|\]$/g, '');

  // Detect numeric IP (decimal, hex, octal, or integer)
  const isNumericIp = /^(\d+|0x[0-9a-fA-F]+)(\.(\d+|0x[0-9a-fA-F]+)){0,3}$/.test(cleanHost);

  if (isNumericIp) {
    const parts = cleanHost.split('.');
    let num = 0;

    if (parts.length === 4) {
      const b0 = parseInt(parts[0] ?? '0', 10);
      const b1 = parseInt(parts[1] ?? '0', 10);
      const _b2 = parseInt(parts[2] ?? '0', 10);
      const _b3 = parseInt(parts[3] ?? '0', 10);

      // Check standard ranges
      // 127.0.0.0/8 (Loopback)
      if (b0 === 127) {
        return { valid: false, reason: 'Loopback address access (127.0.0.0/8) is prohibited.' };
      }
      // 0.0.0.0/8
      if (b0 === 0) {
        return { valid: false, reason: 'Broadcast/current network (0.0.0.0/8) is prohibited.' };
      }
      // 10.0.0.0/8 (Private Class A)
      if (b0 === 10) {
        return { valid: false, reason: 'Private network (10.0.0.0/8) is prohibited.' };
      }
      // 172.16.0.0/12 (Private Class B: 172.16 - 172.31)
      if (b0 === 172 && b1 >= 16 && b1 <= 31) {
        return { valid: false, reason: 'Private network (172.16.0.0/12) is prohibited.' };
      }
      // 192.168.0.0/16 (Private Class C)
      if (b0 === 192 && b1 === 168) {
        return { valid: false, reason: 'Private network (192.168.0.0/16) is prohibited.' };
      }
      // 169.254.0.0/16 (Link Local & Cloud IMDS metadata 169.254.169.254)
      if (b0 === 169 && b1 === 254) {
        return { valid: false, reason: 'Cloud instance metadata and link-local address (169.254.0.0/16) is prohibited.' };
      }
      // 100.64.0.0/10 (Carrier-Grade NAT)
      if (b0 === 100 && b1 >= 64 && b1 <= 127) {
        return { valid: false, reason: 'Carrier-grade NAT space is prohibited.' };
      }
      // 224.0.0.0/4 (Multicast) or 240.0.0.0/4 (Reserved)
      if (b0 >= 224) {
        return { valid: false, reason: 'Multicast or reserved IP space is prohibited.' };
      }
    } else {
      // Shorthand or integer IP (e.g. 2130706433 = 127.0.0.1)
      try {
        num = parseInt(cleanHost, 10);
        const b0 = (num >> 24) & 255;
        if (b0 === 127 || b0 === 10 || b0 === 169) {
          return { valid: false, reason: 'Numeric internal IP representation is prohibited.' };
        }
      } catch {
        return { valid: false, reason: 'Invalid numeric IP representation.' };
      }
    }
  }

  return { valid: true };
}

/**
 * Strips script tags, styles, navigation chrome, and comments from raw HTML.
 */
export function extractCleanTextFromHtml(html: string): { title: string; description?: string; text: string } {
  // Title extraction
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : 'Web Page';

  // Description meta tag
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
  const description = descMatch && descMatch[1] ? descMatch[1].trim() : undefined;

  // Clean HTML
  let cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '') // comments
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // scripts
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // styles
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '') // noscript
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '') // header
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '') // footer
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '') // nav
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ''); // svg

  // Replace block tags with newlines
  cleaned = cleaned.replace(/<(?:p|div|h[1-6]|li|br|hr|tr)[^>]*>/gi, '\n');

  // Strip remaining tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Normalize multiple spaces and blank lines
  const lines = cleaned
    .split('\n')
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter((l) => l.length > 0);

  const text = lines.join('\n\n');

  // Cap at 40,000 characters to keep reasonable context bounds
  const cappedText = text.slice(0, 40000);

  return {
    title,
    description,
    text: cappedText,
  };
}

/**
 * Ingests and parses a web page securely.
 */
export async function fetchAndParseUrl(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ success: boolean; data?: ParsedUrlContent; error?: string }> {
  const check = validateUrlForSsrf(url);
  if (!check.valid) {
    return { success: false, error: `SSRF Security Violation: ${check.reason}` };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const resp = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PrismatixResearch/1.0',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
      },
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      return { success: false, error: `HTTP ${resp.status} ${resp.statusText}` };
    }

    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return { success: false, error: `Unsupported content type "${contentType}". Only text/html is supported.` };
    }

    const raw = await resp.text();
    const extracted = extractCleanTextFromHtml(raw);

    return {
      success: true,
      data: {
        url,
        title: extracted.title,
        description: extracted.description,
        textContent: extracted.text,
        charCount: extracted.text.length,
        estimatedTokens: Math.ceil(extracted.text.length / 4),
      },
    };
  } catch (err: any) {
    return { success: false, error: `Failed to fetch URL: ${err.message || 'network error'}` };
  }
}
