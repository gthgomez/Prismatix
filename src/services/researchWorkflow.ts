// src/services/researchWorkflow.ts
// F24: Bounded multi-source research workflow.
// Orchestrates multi-source grounding (web search + project files + user attachments)
// into bounded, structured research context with strict citation mapping and cost guardrails.

import type { SupabaseClient } from '@supabase/supabase-js';
import { searchProjectKnowledge, type KnowledgeSearchResult } from './projectKnowledgeSearch';
import { executeWebSearch, type SearchCitation } from './webSearchService';

export interface ResearchSource {
  id: string;
  type: 'web' | 'project_doc' | 'url_ingestion' | 'attachment';
  title: string;
  url?: string;
  snippet: string;
  score?: number;
}

export interface ResearchContext {
  query: string;
  sources: ResearchSource[];
  totalSources: number;
  groundingPrompt: string;
  estimatedTokens: number;
  citations: SearchCitation[];
}

export interface ResearchWorkflowOptions {
  projectId?: string | null;
  includeWebSearch?: boolean;
  maxWebResults?: number;
  maxProjectChunks?: number;
  tokenBudget?: number;
  existingCitations?: SearchCitation[];
}

/**
 * Builds a bounded research context by querying multiple authoritative sources.
 */
export async function executeResearchWorkflow(
  client: SupabaseClient,
  query: string,
  options: ResearchWorkflowOptions = {},
): Promise<ResearchContext> {
  const tokenBudget = options.tokenBudget || 3500;
  const sources: ResearchSource[] = [];
  const collectedCitations: SearchCitation[] = [];

  // 1. Gather Project Document chunks if a project workspace is active
  if (options.projectId) {
    try {
      const projectHits: KnowledgeSearchResult[] = await searchProjectKnowledge(client, {
        projectId: options.projectId,
        query,
        limit: options.maxProjectChunks || 3,
      });

      for (const hit of projectHits) {
        sources.push({
          id: `proj-${hit.chunkId.slice(0, 8)}`,
          type: 'project_doc',
          title: `${hit.documentName} (Section ${hit.chunkIndex + 1})`,
          snippet: hit.content,
          score: hit.score,
        });
      }
    } catch (err) {
      console.warn('[researchWorkflow] Project knowledge retrieval error:', err);
    }
  }

  // 2. Gather Web Search results if explicitly enabled or pre-fetched
  if (options.existingCitations && options.existingCitations.length > 0) {
    for (const hit of options.existingCitations) {
      collectedCitations.push(hit);
      sources.push({
        id: `web-${hit.id}`,
        type: 'web',
        title: hit.title,
        url: hit.url,
        snippet: hit.snippet || hit.title,
      });
    }
  } else if (options.includeWebSearch) {
    try {
      const searchRes = await executeWebSearch(query);
      for (const hit of searchRes.citations) {
        collectedCitations.push(hit);
        sources.push({
          id: `web-${hit.id}`,
          type: 'web',
          title: hit.title,
          url: hit.url,
          snippet: hit.snippet || hit.title,
        });
      }
    } catch (err) {
      console.warn('[researchWorkflow] Web search retrieval error:', err);
    }
  }

  // 3. Construct bounded grounding prompt with explicit citation numbering
  const promptLines: string[] = [];
  promptLines.push('=== MULTI-SOURCE RESEARCH CONTEXT ===');
  promptLines.push(
    'Synthesize the findings across all provided sources. Support all factual assertions with explicit citation markers matching the source index, e.g. [1], [2]. Do not invent unsourced claims.',
  );
  promptLines.push('');

  let accumulatedChars = 0;
  const maxChars = tokenBudget * 4;

  for (const [i, s] of sources.entries()) {
    const sourceHeader = `[Source ${i + 1}: ${s.type.toUpperCase()}] "${s.title}"${s.url ? ` (${s.url})` : ''}`;
    const entry = `${sourceHeader}\n${s.snippet}\n`;

    if (accumulatedChars + entry.length > maxChars && i > 0) {
      break;
    }

    promptLines.push(entry);
    accumulatedChars += entry.length;
  }

  promptLines.push('=== END RESEARCH CONTEXT ===\n');

  const groundingPrompt = promptLines.join('\n');

  return {
    query,
    sources,
    totalSources: sources.length,
    groundingPrompt,
    estimatedTokens: Math.ceil(groundingPrompt.length / 4),
    citations: collectedCitations,
  };
}

/**
 * Validates whether generated research output contains valid citation markers.
 */
export function validateResearchCitations(
  responseContent: string,
  sourceCount: number,
): { valid: boolean; citedIndices: number[]; uncitedSources: number[] } {
  const matches = responseContent.matchAll(/\[(\d+)\]/g);
  const cited = new Set<number>();

  for (const match of matches) {
    if (match[1]) {
      const num = parseInt(match[1], 10);
      if (num >= 1 && num <= sourceCount) {
        cited.add(num);
      }
    }
  }

  const citedIndices = Array.from(cited).sort((a, b) => a - b);
  const uncitedSources: number[] = [];

  for (let i = 1; i <= sourceCount; i++) {
    if (!cited.has(i)) {
      uncitedSources.push(i);
    }
  }

  return {
    valid: citedIndices.length > 0,
    citedIndices,
    uncitedSources,
  };
}
