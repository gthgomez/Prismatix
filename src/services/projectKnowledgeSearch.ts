// src/services/projectKnowledgeSearch.ts
// F22: Grounded project knowledge search.
// Performs relevance-ranked retrieval across project document chunks and formats
// citation-grounded context boundaries for router prompt construction.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface KnowledgeSearchResult {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
  chunkIndex: number;
  score: number;
  tokenCount: number;
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

  try {
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
        });
      }
    }

    // Sort descending by relevance score
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

    sections.push(
      `\n[Source ${i + 1}: ${res.documentName} (Section ${res.chunkIndex + 1})]\n${res.content}`,
    );
    currentTokens += res.tokenCount;
  }

  sections.push('\n=== END PROJECT KNOWLEDGE ===\n');

  return sections.join('\n');
}
