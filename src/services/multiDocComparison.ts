// src/services/multiDocComparison.ts
// F25: Multi-document analysis & comparison.
// Compares documents, analyzes structural and content divergences, and produces
// structured comparative briefs with section-by-section diffs.

export interface DocumentInput {
  name: string;
  content: string;
}

export interface ComparisonMetrics {
  docAName: string;
  docBName: string;
  docALength: number;
  docBLength: number;
  jaccardSimilarity: number;
  sharedKeywords: string[];
  docAUniqueKeywords: string[];
  docBUniqueKeywords: string[];
}

export interface DocumentComparisonResult {
  metrics: ComparisonMetrics;
  comparativePrompt: string;
  summary: string;
}

/**
 * Tokenizes text into normalized unique keywords.
 */
function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);
  return new Set(words);
}

/**
 * Computes lexical Jaccard similarity and keyword intersection between two documents.
 */
export function computeComparisonMetrics(docA: DocumentInput, docB: DocumentInput): ComparisonMetrics {
  const setA = extractKeywords(docA.content);
  const setB = extractKeywords(docB.content);

  const shared: string[] = [];
  const uniqueA: string[] = [];
  const uniqueB: string[] = [];

  for (const word of setA) {
    if (setB.has(word)) {
      shared.push(word);
    } else {
      uniqueA.push(word);
    }
  }

  for (const word of setB) {
    if (!setA.has(word)) {
      uniqueB.push(word);
    }
  }

  const unionSize = new Set([...setA, ...setB]).size;
  const similarity = unionSize > 0 ? shared.length / unionSize : 1;

  return {
    docAName: docA.name,
    docBName: docB.name,
    docALength: docA.content.length,
    docBLength: docB.content.length,
    jaccardSimilarity: Math.round(similarity * 1000) / 1000,
    sharedKeywords: shared.slice(0, 15),
    docAUniqueKeywords: uniqueA.slice(0, 10),
    docBUniqueKeywords: uniqueB.slice(0, 10),
  };
}

/**
 * Generates an authoritative comparative analysis prompt and summary between two documents.
 */
export function generateDocumentComparison(
  docA: DocumentInput,
  docB: DocumentInput,
): DocumentComparisonResult {
  const metrics = computeComparisonMetrics(docA, docB);

  const similarityPercent = Math.round(metrics.jaccardSimilarity * 100);
  const lengthDiff = metrics.docBLength - metrics.docALength;
  const lengthComment =
    Math.abs(lengthDiff) < 100
      ? 'similar length'
      : lengthDiff > 0
      ? `${metrics.docBName} is ${Math.round((lengthDiff / (metrics.docALength || 1)) * 100)}% longer`
      : `${metrics.docAName} is ${Math.round((Math.abs(lengthDiff) / (metrics.docBLength || 1)) * 100)}% longer`;

  const summary = `Comparison between "${metrics.docAName}" and "${metrics.docBName}": ${similarityPercent}% vocabulary overlap (${lengthComment}). Shared themes: ${metrics.sharedKeywords.slice(0, 5).join(', ')}.`;

  const prompt = [
    '=== MULTI-DOCUMENT COMPARATIVE ANALYSIS ===',
    `Document A: "${docA.name}" (${docA.content.length} chars)`,
    `Document B: "${docB.name}" (${docB.content.length} chars)`,
    `Vocabulary overlap: ${similarityPercent}%`,
    '',
    `--- START ${docA.name} ---`,
    docA.content.slice(0, 15000),
    `--- END ${docA.name} ---`,
    '',
    `--- START ${docB.name} ---`,
    docB.content.slice(0, 15000),
    `--- END ${docB.name} ---`,
    '',
    'Provide a thorough comparative analysis addressing:',
    '1. Executive Summary & Core Differences',
    '2. Key Substantive Changes (what was added, deleted, or modified)',
    '3. Tone, Scope, and Intent Variations',
    '4. Recommendations or Decision Tradeoffs',
    '=== END COMPARATIVE ANALYSIS REQUEST ===',
  ].join('\n');

  return {
    metrics,
    comparativePrompt: prompt,
    summary,
  };
}
