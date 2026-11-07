// tests/knowledge/knowledge_wave2.test.ts
// Unit tests for Wave 2 PR 5: F21–F25 Knowledge & Grounded Research features.

import { describe, it, expect, vi } from 'vitest';
import {
  chunkDocumentText,
  listProjectDocuments,
  addProjectDocument,
  deleteProjectDocument,
} from '../../src/services/projectDocumentLibrary';
import {
  scoreLexicalRelevance,
  searchProjectKnowledge,
  formatKnowledgeGroundingBlock,
} from '../../src/services/projectKnowledgeSearch';
import {
  validateUrlForSsrf,
  extractCleanTextFromHtml,
  fetchAndParseUrl,
} from '../../src/services/urlPageReader';
import {
  executeResearchWorkflow,
  validateResearchCitations,
} from '../../src/services/researchWorkflow';
import {
  computeComparisonMetrics,
  generateDocumentComparison,
} from '../../src/services/multiDocComparison';

describe('F21: Persistent Project File Library', () => {
  it('chunks text into bounded windows with overlap', () => {
    const text = 'Paragraph 1 with important details.\n\nParagraph 2 with more architectural requirements.\n\nParagraph 3 with deployment guidelines.';
    const chunks = chunkDocumentText(text, { chunkSize: 50, overlap: 10 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain('Paragraph 1');
  });

  it('adds and lists project documents with generated chunks', async () => {
    let insertedDoc: any = null;
    const insertedChunks: any[] = [];

    const mockClient: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-eng' } } }),
      },
      from: (table: string) => {
        if (table === 'project_documents') {
          return {
            insert: vi.fn((data) => {
              insertedDoc = data;
              return Promise.resolve({ error: null });
            }),
            select: () => ({
              eq: () => ({
                order: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: 'doc-1',
                        project_id: 'proj-1',
                        user_id: 'u-eng',
                        name: 'API Spec.md',
                        file_type: 'text/markdown',
                        size_bytes: 1200,
                        metadata: { chunkCount: 3 },
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                      },
                    ],
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === 'project_document_chunks') {
          return {
            insert: vi.fn((data) => {
              insertedChunks.push(...data);
              return Promise.resolve({ error: null });
            }),
          };
        }
        return {};
      },
    };

    const addRes = await addProjectDocument(mockClient, {
      projectId: 'proj-1',
      name: 'Architecture.md',
      extractedText: 'System overview\n\nHigh throughput ingestion layer with backpressure handling.',
    });

    expect(addRes.success).toBe(true);
    expect(insertedDoc.name).toBe('Architecture.md');
    expect(insertedChunks.length).toBeGreaterThan(0);

    const list = await listProjectDocuments(mockClient, 'proj-1');
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('API Spec.md');
  });

  it('deletes project document via ID', async () => {
    let deletedId: string | null = null;
    const mockClient: any = {
      from: () => ({
        delete: () => ({
          eq: (_col: string, val: string) => {
            deletedId = val;
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };

    const ok = await deleteProjectDocument(mockClient, 'doc-to-del');
    expect(ok).toBe(true);
    expect(deletedId).toBe('doc-to-del');
  });
});

describe('F22: Grounded Project Knowledge Search', () => {
  it('scores lexical relevance higher for exact matches and multiple keywords', () => {
    const textA = 'The system architecture uses PostgreSQL with Row Level Security for data isolation.';
    const textB = 'Casual chat about weather and sports.';

    const scoreMatch = scoreLexicalRelevance('PostgreSQL Row Level Security', textA);
    const scoreMismatch = scoreLexicalRelevance('PostgreSQL Row Level Security', textB);

    expect(scoreMatch).toBeGreaterThan(scoreMismatch);
    expect(scoreMismatch).toBe(0);
  });

  it('searches project chunks and formats grounding context with source attributions', async () => {
    const mockClient: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: () =>
              Promise.resolve({
                data: [
                  {
                    id: 'chunk-1',
                    document_id: 'doc-1',
                    chunk_index: 0,
                    content: 'Prismatix enforces user-controlled BYOK provider credentials.',
                    token_count: 15,
                    metadata: { docName: 'Security Architecture.md' },
                  },
                ],
                error: null,
              }),
          }),
        }),
      }),
    };

    const results = await searchProjectKnowledge(mockClient, {
      projectId: 'proj-1',
      query: 'BYOK provider credentials',
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.documentName).toBe('Security Architecture.md');

    const groundingBlock = formatKnowledgeGroundingBlock(results);
    expect(groundingBlock).toContain('=== GROUNDED PROJECT KNOWLEDGE ===');
    expect(groundingBlock).toContain('[Source 1: Security Architecture.md (Section 1)]');
    expect(groundingBlock).toContain('Prismatix enforces user-controlled BYOK provider credentials.');
  });
});

describe('F23: Secure URL Ingestion & Strict SSRF Defense', () => {
  it('blocks loopback IP addresses (127.0.0.1, ::1, localhost)', () => {
    expect(validateUrlForSsrf('http://127.0.0.1/admin').valid).toBe(false);
    expect(validateUrlForSsrf('http://127.0.0.2:8080/').valid).toBe(false);
    expect(validateUrlForSsrf('http://localhost:3000/api').valid).toBe(false);
    expect(validateUrlForSsrf('http://my.localhost/').valid).toBe(false);
    expect(validateUrlForSsrf('http://[::1]/').valid).toBe(false);
  });

  it('blocks private RFC 1918 CIDR ranges', () => {
    expect(validateUrlForSsrf('http://10.0.0.1/secret').valid).toBe(false);
    expect(validateUrlForSsrf('http://172.16.0.5/internal').valid).toBe(false);
    expect(validateUrlForSsrf('http://192.168.1.1/router').valid).toBe(false);
  });

  it('blocks cloud metadata IMDS endpoint (169.254.169.254)', () => {
    const awsMetadata = validateUrlForSsrf('http://169.254.169.254/latest/meta-data/');
    expect(awsMetadata.valid).toBe(false);
    expect(awsMetadata.reason).toMatch(/Cloud instance metadata/i);
  });

  it('blocks disallowed protocols (file:, ftp:, gopher:, javascript:)', () => {
    expect(validateUrlForSsrf('file:///etc/passwd').valid).toBe(false);
    expect(validateUrlForSsrf('ftp://ftp.example.com/file').valid).toBe(false);
    expect(validateUrlForSsrf('javascript:alert(1)').valid).toBe(false);
  });

  it('permits valid public HTTP and HTTPS URLs', () => {
    expect(validateUrlForSsrf('https://example.com/blog/article').valid).toBe(true);
    expect(validateUrlForSsrf('https://docs.prismatix.test/guide').valid).toBe(true);
  });

  it('extracts clean readable text from HTML stripping script and style tags', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Page Title</title>
          <meta name="description" content="A comprehensive guide to distributed systems">
          <style>body { background: red; }</style>
          <script>console.log("malicious");</script>
        </head>
        <body>
          <nav><a href="/">Home</a></nav>
          <h1>Main Article Heading</h1>
          <p>Distributed consensus requires quorum agreement among nodes.</p>
          <footer>Copyright 2026</footer>
        </body>
      </html>
    `;

    const extracted = extractCleanTextFromHtml(html);
    expect(extracted.title).toBe('Test Page Title');
    expect(extracted.description).toBe('A comprehensive guide to distributed systems');
    expect(extracted.text).toContain('Distributed consensus requires quorum agreement among nodes.');
    expect(extracted.text).not.toContain('console.log');
    expect(extracted.text).not.toContain('background: red');
  });

  it('fetches and parses URL securely with custom fetch function', async () => {
    const mockFetch: any = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/html; charset=utf-8' : null),
      },
      text: () => Promise.resolve('<html><head><title>Mocked Doc</title></head><body><p>Safe content</p></body></html>'),
    });

    const res = await fetchAndParseUrl('https://valid-domain.com/doc', mockFetch);
    expect(res.success).toBe(true);
    expect(res.data?.title).toBe('Mocked Doc');
    expect(res.data?.textContent).toContain('Safe content');
  });
});

describe('F24: Bounded Multi-Source Research Workflow', () => {
  it('combines project documents and web search results into bounded research context', async () => {
    const mockClient: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: () =>
              Promise.resolve({
                data: [
                  {
                    id: 'chunk-p1',
                    document_id: 'doc-p1',
                    chunk_index: 0,
                    content: 'Project internal notes on database indexing.',
                    token_count: 10,
                    metadata: { docName: 'DatabaseNotes.txt' },
                  },
                ],
                error: null,
              }),
          }),
        }),
      }),
    };

    const researchCtx = await executeResearchWorkflow(mockClient, 'database indexing', {
      projectId: 'proj-123',
      includeWebSearch: false,
      tokenBudget: 1000,
    });

    expect(researchCtx.totalSources).toBe(1);
    expect(researchCtx.sources[0]?.title).toContain('DatabaseNotes.txt');
    expect(researchCtx.groundingPrompt).toContain('=== MULTI-SOURCE RESEARCH CONTEXT ===');
    expect(researchCtx.groundingPrompt).toContain('[Source 1: PROJECT_DOC]');
  });

  it('validates research citations against source count', () => {
    const responseWithCitations = 'According to the spec [1], throughput is 10k ops/sec, but benchmarks [2] show 8k ops/sec.';
    const validation = validateResearchCitations(responseWithCitations, 2);

    expect(validation.valid).toBe(true);
    expect(validation.citedIndices).toEqual([1, 2]);
    expect(validation.uncitedSources).toEqual([]);

    const incomplete = 'According to [1], we are fast.';
    const partialVal = validateResearchCitations(incomplete, 3);
    expect(partialVal.citedIndices).toEqual([1]);
    expect(partialVal.uncitedSources).toEqual([2, 3]);
  });
});

describe('F25: Multi-Document Analysis & Comparison', () => {
  it('computes comparison metrics, Jaccard similarity, and unique keywords', () => {
    const docA = {
      name: 'V1 Proposal.md',
      content: 'This proposal details the payment architecture with Stripe and credit card support.',
    };
    const docB = {
      name: 'V2 Proposal.md',
      content: 'This proposal details the payment architecture with cryptocurrency and wire transfer support.',
    };

    const metrics = computeComparisonMetrics(docA, docB);
    expect(metrics.docAName).toBe('V1 Proposal.md');
    expect(metrics.docBName).toBe('V2 Proposal.md');
    expect(metrics.jaccardSimilarity).toBeGreaterThan(0);
    expect(metrics.jaccardSimilarity).toBeLessThan(1);
    expect(metrics.sharedKeywords).toContain('payment');
    expect(metrics.sharedKeywords).toContain('architecture');
  });

  it('generates a structured comparative analysis prompt', () => {
    const docA = { name: 'Doc A', content: 'Features: user auth, database storage.' };
    const docB = { name: 'Doc B', content: 'Features: user auth, database storage, audit logs.' };

    const comp = generateDocumentComparison(docA, docB);
    expect(comp.comparativePrompt).toContain('=== MULTI-DOCUMENT COMPARATIVE ANALYSIS ===');
    expect(comp.comparativePrompt).toContain('Document A: "Doc A"');
    expect(comp.comparativePrompt).toContain('Document B: "Doc B"');
    expect(comp.comparativePrompt).toContain('Key Substantive Changes');
    expect(comp.summary).toContain('Doc A');
    expect(comp.summary).toContain('Doc B');
  });
});

describe('Wave 2 Hardening: Rollback, SSRF Fail-Closed, Authoritative FTS, Deduplicated Research', () => {
  it('Defect 11: addProjectDocument rolls back storage file and document row on chunk insertion error', async () => {
    const deletedDocs: string[] = [];
    const removedStoragePaths: string[] = [];

    const mockClient: any = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-eng' } } }),
      },
      storage: {
        from: (bucket: string) => ({
          upload: vi.fn().mockResolvedValue({ error: null }),
          remove: vi.fn((paths: string[]) => {
            removedStoragePaths.push(...paths);
            return Promise.resolve({ error: null });
          }),
        }),
      },
      from: (table: string) => {
        if (table === 'project_documents') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
            delete: () => ({
              eq: (col: string, val: string) => {
                deletedDocs.push(val);
                return Promise.resolve({ error: null });
              },
            }),
          };
        }
        if (table === 'project_document_chunks') {
          return {
            insert: vi.fn().mockResolvedValue({ error: { message: 'Chunk table constraint violation' } }),
          };
        }
        return {};
      },
    };

    const res = await addProjectDocument(mockClient, {
      projectId: 'proj-atomic',
      name: 'FailedIndex.md',
      extractedText: 'Some content that fails indexing step.',
      fileBytes: new Uint8Array([1, 2, 3]),
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Document chunk indexing failed');
    // Storage file cleaned up
    expect(removedStoragePaths.length).toBeGreaterThan(0);
    // Document row deleted
    expect(deletedDocs.length).toBeGreaterThan(0);
  });

  it('Defect 12: fetchAndParseUrl fails closed when edge function invoke fails or errors', async () => {
    const mockClient: any = {
      functions: {
        invoke: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Edge Function SSRF blocked request' },
        }),
      },
    };

    const res = await fetchAndParseUrl('https://example.com/blocked', fetch, mockClient);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Edge Function SSRF blocked request');
  });

  it('Defect 14: searchProjectKnowledge returns empty array without scanning table when RPC returns []', async () => {
    let tableScanAttempted = false;

    const mockClient: any = {
      rpc: vi.fn().mockResolvedValue({
        data: [], // Authoritative zero hits
        error: null,
      }),
      from: () => {
        tableScanAttempted = true;
        return {
          select: () => ({
            eq: () => ({
              limit: () => Promise.resolve({ data: [{ id: 'fake-chunk', content: 'unwanted' }], error: null }),
            }),
          }),
        };
      },
    };

    const hits = await searchProjectKnowledge(mockClient, {
      projectId: 'proj-empty',
      query: 'query with zero matches',
    });

    expect(hits).toEqual([]);
    expect(tableScanAttempted).toBe(false);
  });

  it('Defect 13: executeResearchWorkflow consumes existingCitations without redundant searches', async () => {
    const existingCitations = [
      {
        id: 1,
        title: 'Prismatix Docs',
        url: 'https://docs.prismatix.ai',
        domain: 'docs.prismatix.ai',
        snippet: 'Authoritative Prismatix manual.',
      },
    ];

    const mockClient: any = {
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    const res = await executeResearchWorkflow(mockClient, 'docs query', {
      includeWebSearch: false,
      existingCitations,
    });

    expect(res.totalSources).toBe(1);
    expect(res.citations).toHaveLength(1);
    expect(res.citations[0]?.title).toBe('Prismatix Docs');
    expect(res.groundingPrompt).toContain('Authoritative Prismatix manual');
  });
});
