// src/services/projectKnowledgeSearch.ts
// F22: Grounded project knowledge search.
// Performs relevance-ranked retrieval across the complete corpus of project document chunks
// via PostgreSQL full-text search indexing and formats citation-grounded context boundaries.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface KnowledgeSearchResult {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
  chunkIndex: number;
  score: number;
  tokenCount: number;
  metadata?: Record<string, unknown>;
}

/**
 * Calculates a lexical relevance score between a query and document text.
 * Rewards keyword coverage, exact sub-phrases, and term frequency.
 */
export function scoreLexicalRelevance(query: string, content: string): number {
  const normQuery = query.toLowerCase().trim();
  const normContent = content.toLowerCase();

  if (!normQuery || !normContent) return 0;

  let score = 0;

  // Exact phrase match bonus
  if (normContent.includes(normQuery)) {
    score += 50;
  }

  // Tokenize query words (excluding stopwords/trivial tokens)
  const tokens = normQuery
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9_-]/g, ''))
    .filter((t) => t.length > 2);

  if (tokens.length === 0) return score;

  let matchedTokens = 0;
  for (const token of tokens) {
    const regex = new RegExp(`\\b${token}\\b`, 'g');
    const matches = normContent.match(regex);
    if (matches && matches.length > 0) {
      matchedTokens++;
      score += 10 + Math.min(matches.length * 3, 15);
    }
  }

  // Completeness multiplier (fraction of query terms matched)
  const coverageRatio = matchedTokens / tokens.length;
  score *= (0.5 + coverageRatio * 0.5);

  return Math.round(score * 10) / 10;
}

/**
 * Searches chunks belonging to a project, ranked by relevance.
 * Queries PostgreSQL full-text search index (`px22_search_project_knowledge`)
 * across the entire corpus, with local lexical scoring fallback.
 */
export async function searchProjectKnowledge(
  client: SupabaseClient,
  options: {
    projectId: string;
    query: string;
    limit?: number;
    minScore?: number;
  },
): Promise<KnowledgeSearchResult[]> {
  const limit = options.limit || 5;
  const minScore = options.minScore || 5;

  if (!options.query || !options.query.trim()) {
    return [];
  }

  try {
    // 1. First attempt authoritative PostgreSQL Full-Text Search RPC if available
    if (typeof client?.rpc === 'function') {
      try {
        const { data: rpcData, error: rpcErr } = await client.rpc('px22_search_project_knowledge', {
          p_project_id: options.projectId,
          p_query: options.query.trim(),
          p_limit: limit,
        });

        if (!rpcErr && Array.isArray(rpcData) && rpcData.length > 0) {
          return (rpcData as Array<Record<string, unknown>>)
            .filter((r) => Number(r.score || 0) >= minScore)
            .map((r) => ({
              chunkId: String(r.chunk_id),
              documentId: String(r.document_id),
              documentName: String(r.document_name || 'Project Document'),
              content: String(r.content || ''),
              chunkIndex: Number(r.chunk_index || 0),
              score: Number(r.score || 0),
              tokenCount: Number(r.token_count || Math.ceil(String(r.content || '').length / 4)),
              metadata: (r.metadata as Record<string, unknown>) || {},
            }));
        }
      } catch (rpcEx) {
        console.warn('[projectKnowledgeSearch] rpc fallback to table scan:', rpcEx);
      }
    }

    // 2. Fallback: Direct table query with client lexical scoring (e.g. mock test environment)
    const { data, error } = await client
      .from('project_document_chunks')
      .select('id, document_id, chunk_index, content, token_count, metadata')
      .eq('project_id', options.projectId)
      .limit(100);

    if (error || !data || data.length === 0) {
      return [];
    }

    const scored: KnowledgeSearchResult[] = [];

    for (const row of data as Array<Record<string, unknown>>) {
      const content = String(row.content || '');
      const score = scoreLexicalRelevance(options.query, content);

      if (score >= minScore) {
        const meta = (row.metadata as Record<string, unknown>) || {};
        scored.push({
          chunkId: String(row.id),
          documentId: String(row.document_id),
          documentName: String(meta.docName || 'Project Document'),
          content,
          chunkIndex: Number(row.chunk_index || 0),
          score,
          tokenCount: Number(row.token_count || Math.ceil(content.length / 4)),
          metadata: meta,
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  } catch (err) {
    console.warn('[projectKnowledgeSearch] search exception:', err);
    return [];
  }
}

/**
 * Formats retrieved knowledge results into an authoritative grounding block
 * for LLM context injection with explicit attribution anchors.
 */
export function formatKnowledgeGroundingBlock(
  results: KnowledgeSearchResult[],
  maxTokens = 2000,
): string {
  if (results.length === 0) return '';

  let currentTokens = 0;
  const sections: string[] = [];

  sections.push('=== GROUNDED PROJECT KNOWLEDGE ===');
  sections.push('Use the following retrieved project context to inform your answer. Attribute facts to the source documents.');

  for (const [i, res] of results.entries()) {
    if (currentTokens + res.tokenCount > maxTokens && i > 0) {
      break;
    }

    const pageLabel = res.metadata?.pageNumber
      ? `Page ${res.metadata.pageNumber}, Section ${res.chunkIndex + 1}`
      : (res.metadata?.section ? String(res.metadata.section) : `Section ${res.chunkIndex + 1}`);

    sections.push(
      `\n[Source ${i + 1}: ${res.documentName} (${pageLabel})]\n${res.content}`,
    );
    currentTokens += res.tokenCount;
  }

  sections.push('\n=== END PROJECT KNOWLEDGE ===\n');

  return sections.join('\n');
}
