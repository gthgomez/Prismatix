// tests/routing/web_search.test.ts
// Unit tests for F11: citation-backed web search with SSRF defense and untrusted context isolation.

import { describe, expect, it, vi } from 'vitest';
import {
  executeWebSearch,
  extractDomain,
  formatSearchContextPrompt,
  isValidPublicHttpsUrl,
} from '../../src/services/webSearchService';

describe('F11: Web Search SSRF Defense & URL Validation', () => {
  it('accepts valid public https URLs', () => {
    expect(isValidPublicHttpsUrl('https://example.com')).toBe(true);
    expect(isValidPublicHttpsUrl('https://en.wikipedia.org/wiki/Artificial_intelligence')).toBe(true);
    expect(isValidPublicHttpsUrl('https://github.com/gthgomez/Prismatix')).toBe(true);
  });

  it('rejects insecure http URLs', () => {
    expect(isValidPublicHttpsUrl('http://example.com')).toBe(false);
    expect(isValidPublicHttpsUrl('http://insecure.site/test')).toBe(false);
  });

  it('rejects localhost and loopback addresses (SSRF defense)', () => {
    expect(isValidPublicHttpsUrl('https://localhost:8080')).toBe(false);
    expect(isValidPublicHttpsUrl('https://127.0.0.1/admin')).toBe(false);
    expect(isValidPublicHttpsUrl('https://127.0.0.53')).toBe(false);
  });

  it('rejects private RFC 1918 IPv4 ranges', () => {
    expect(isValidPublicHttpsUrl('https://10.0.0.1')).toBe(false);
    expect(isValidPublicHttpsUrl('https://10.255.255.255')).toBe(false);
    expect(isValidPublicHttpsUrl('https://172.16.0.1')).toBe(false);
    expect(isValidPublicHttpsUrl('https://172.31.255.255')).toBe(false);
    expect(isValidPublicHttpsUrl('https://192.168.1.1')).toBe(false);
    expect(isValidPublicHttpsUrl('https://192.168.0.254')).toBe(false);
  });

  it('rejects cloud metadata link-local address (169.254.169.254)', () => {
    expect(isValidPublicHttpsUrl('https://169.254.169.254/latest/meta-data/')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isValidPublicHttpsUrl('')).toBe(false);
    expect(isValidPublicHttpsUrl('not-a-url')).toBe(false);
    expect(isValidPublicHttpsUrl('file:///etc/passwd')).toBe(false);
  });
});

describe('F11: Domain Extraction & Formatting', () => {
  it('extracts clean domain without www prefix', () => {
    expect(extractDomain('https://www.nature.com/articles/s41586')).toBe('nature.com');
    expect(extractDomain('https://docs.prismatix.ai/overview')).toBe('docs.prismatix.ai');
    expect(extractDomain('invalid')).toBe('web');
  });

  it('formats untrusted search results into safe delimited prompt context', () => {
    const citations = [
      {
        id: 1,
        title: 'Quantum Computing Breakthrough',
        url: 'https://nature.com/articles/1234',
        domain: 'nature.com',
        snippet: 'Scientists demonstrate quantum advantage with 100 qubits.',
      },
    ];

    const promptContext = formatSearchContextPrompt('Quantum computing news', citations);
    expect(promptContext).toContain('[UNTRUSTED WEB SEARCH RESULTS — REFERENCE CITATIONS ONLY]');
    expect(promptContext).toContain('[/UNTRUSTED WEB SEARCH RESULTS]');
    expect(promptContext).toContain('[1] Quantum Computing Breakthrough (nature.com)');
    expect(promptContext).toContain('https://nature.com/articles/1234');
  });

  it('returns empty string when citations list is empty', () => {
    expect(formatSearchContextPrompt('test', [])).toBe('');
  });
});

describe('F11: Web Search Execution', () => {
  it('returns deterministic mock citations when API key is omitted (zero paid calls)', async () => {
    const result = await executeWebSearch('Distributed Consensus Raft');
    expect(result.source).toBe('mock');
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations[0]?.id).toBe(1);
    expect(result.citations[0]?.url).toContain('https://');
    expect(result.contextPrompt).toContain('[UNTRUSTED WEB SEARCH RESULTS');
    expect(result.costEstimate).toBeGreaterThan(0);
  });

  it('executes live search when API key provided with mock fetchFn', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        web: {
          results: [
            {
              title: 'TypeScript 5.8 Release Notes',
              url: 'https://devblogs.microsoft.com/typescript/announcing-typescript-5-8/',
              description: 'Major speed improvements and new syntax features in TS 5.8.',
              page_age: '2026-03-01',
            },
            {
              title: 'Internal SSRF Attempt',
              url: 'https://127.0.0.1/private',
              description: 'Should be filtered out by validation.',
            },
          ],
        },
      }),
    }) as unknown as typeof fetch;

    const result = await executeWebSearch('TypeScript 5.8', 'test-brave-key', mockFetch);
    expect(result.source).toBe('live');
    expect(result.citations.length).toBe(1); // The SSRF 127.0.0.1 result was filtered out
    expect(result.citations[0]?.title).toBe('TypeScript 5.8 Release Notes');
    expect(result.citations[0]?.domain).toBe('devblogs.microsoft.com');
  });

  it('falls back to mock if fetch fails or network errors', async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch;
    const result = await executeWebSearch('Resilient search test', 'key', failingFetch);
    expect(result.source).toBe('mock');
    expect(result.citations.length).toBeGreaterThan(0);
  });
});
