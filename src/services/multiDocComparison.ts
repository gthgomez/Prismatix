// src/services/multiDocComparison.ts
// F25: Multi-document analysis & comparison.
// Grounded comparative analysis that identifies substantive structural differences,
// clause alterations, numerical/term divergences, and supporting source quotes.

export interface DocumentInput {
  name: string;
  content: string;
}

export interface ClauseDifference {
  topic: string;
  differenceType: 'added' | 'removed' | 'modified';
  docAPassage?: { text: string; location: string };
  docBPassage?: { text: string; location: string };
  significance: 'critical' | 'moderate' | 'minor';
  summary: string;
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
  materialDifferences: ClauseDifference[];
  addedSections: string[];
  removedSections: string[];
  isTruncated: boolean;
}

export interface DocumentComparisonResult {
  metrics: ComparisonMetrics;
  comparativePrompt: string;
  summary: string;
}

interface ParsedSection {
  heading: string;
  content: string;
  location: string;
}

/**
 * Splits document content into identifiable sections based on headings or paragraphs.
 */
function extractSections(text: string): ParsedSection[] {
  const lines = text.split('\n');
  const sections: ParsedSection[] = [];
  let currentHeading = 'Preamble / Introduction';
  let currentLines: string[] = [];
  let sectionIndex = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // Match headings: # Heading, Section X, Clause X, or ALL CAPS line
    const isHeading =
      /^#{1,4}\s+(.+)$/.test(trimmed) ||
      /^(?:Section|Clause|Article|Term)\s+([0-9A-Za-z.]+[:\s-]*.+)$/i.test(trimmed) ||
      (/^[A-Z0-9\s_-]{4,40}:?$/.test(trimmed) && trimmed.length > 4);

    if (isHeading && currentLines.length > 0) {
      sections.push({
        heading: currentHeading,
        content: currentLines.join('\n').trim(),
        location: `Section ${sectionIndex} (${currentHeading})`,
      });
      sectionIndex++;
      currentHeading = trimmed.replace(/^#+\s*/, '');
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push({
      heading: currentHeading,
      content: currentLines.join('\n').trim(),
      location: `Section ${sectionIndex} (${currentHeading})`,
    });
  }

  return sections;
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

  // Extract structured sections
  const sectionsA = extractSections(docA.content);
  const sectionsB = extractSections(docB.content);

  const materialDifferences: ClauseDifference[] = [];
  const addedSections: string[] = [];
  const removedSections: string[] = [];

  // Match and compare sections
  const matchedB = new Set<number>();

  for (const secA of sectionsA) {
    let bestMatchIdx = -1;
    let highestOverlap = 0;

    const tokensA = extractKeywords(secA.heading + ' ' + secA.content);

    for (let j = 0; j < sectionsB.length; j++) {
      if (matchedB.has(j)) continue;
      const secB = sectionsB[j]!;
      const tokensB = extractKeywords(secB.heading + ' ' + secB.content);
      const overlap = [...tokensA].filter((t) => tokensB.has(t)).length;

      if (overlap > highestOverlap) {
        highestOverlap = overlap;
        bestMatchIdx = j;
      }
    }

    if (bestMatchIdx !== -1 && highestOverlap >= 3) {
      matchedB.add(bestMatchIdx);
      const secB = sectionsB[bestMatchIdx]!;

      // Compare text content differences
      if (secA.content.trim() !== secB.content.trim()) {
        // Detect numeric, monetary, or timeline shifts
        const numbersA = secA.content.match(/\b\d+(?:\.\d+)?%?|\$\d+(?:,\d+)*(?:\.\d+)?/g) || [];
        const numbersB = secB.content.match(/\b\d+(?:\.\d+)?%?|\$\d+(?:,\d+)*(?:\.\d+)?/g) || [];
        const isNumericShift = JSON.stringify(numbersA) !== JSON.stringify(numbersB);

        materialDifferences.push({
          topic: secA.heading,
          differenceType: 'modified',
          significance: isNumericShift ? 'critical' : 'moderate',
          docAPassage: {
            text: secA.content.slice(0, 300),
            location: secA.location,
          },
          docBPassage: {
            text: secB.content.slice(0, 300),
            location: secB.location,
          },
          summary: isNumericShift
            ? `Numerical or term divergence in ${secA.heading} (e.g. ${numbersA.join(', ') || 'none'} vs ${numbersB.join(', ') || 'none'})`
            : `Substantive language variation in ${secA.heading}`,
        });
      }
    } else {
      removedSections.push(secA.heading);
      materialDifferences.push({
        topic: secA.heading,
        differenceType: 'removed',
        significance: 'moderate',
        docAPassage: {
          text: secA.content.slice(0, 300),
          location: secA.location,
        },
        summary: `Section "${secA.heading}" present in ${docA.name} but absent in ${docB.name}`,
      });
    }
  }

  for (let j = 0; j < sectionsB.length; j++) {
    if (!matchedB.has(j)) {
      const secB = sectionsB[j]!;
      addedSections.push(secB.heading);
      materialDifferences.push({
        topic: secB.heading,
        differenceType: 'added',
        significance: 'moderate',
        docBPassage: {
          text: secB.content.slice(0, 300),
          location: secB.location,
        },
        summary: `New section "${secB.heading}" added in ${docB.name}`,
      });
    }
  }

  const MAX_CHAR_BOUND = 25000;
  const isTruncated = docA.content.length > MAX_CHAR_BOUND || docB.content.length > MAX_CHAR_BOUND;

  return {
    docAName: docA.name,
    docBName: docB.name,
    docALength: docA.content.length,
    docBLength: docB.content.length,
    jaccardSimilarity: Math.round(similarity * 1000) / 1000,
    sharedKeywords: shared.slice(0, 15),
    docAUniqueKeywords: uniqueA.slice(0, 10),
    docBUniqueKeywords: uniqueB.slice(0, 10),
    materialDifferences,
    addedSections,
    removedSections,
    isTruncated,
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

  const diffCount = metrics.materialDifferences.length;
  const summary = `Comparison between "${metrics.docAName}" and "${metrics.docBName}": ${similarityPercent}% vocabulary overlap (${lengthComment}). Found ${diffCount} material difference(s)${metrics.addedSections.length > 0 ? `, ${metrics.addedSections.length} addition(s)` : ''}${metrics.removedSections.length > 0 ? `, ${metrics.removedSections.length} removal(s)` : ''}.${metrics.isTruncated ? ' (Content bounded for context limits)' : ''}`;

  const promptSections = [
    '=== MULTI-DOCUMENT COMPARATIVE ANALYSIS ===',
    `Document A: "${docA.name}" (${docA.content.length} chars)`,
    `Document B: "${docB.name}" (${docB.content.length} chars)`,
    `Lexical Overlap: ${similarityPercent}%`,
    metrics.isTruncated ? '⚠️ Note: One or both documents were bounded to fit context limits.' : '',
    '',
    '=== IDENTIFIED MATERIAL DIFFERENCES & SUPPORTING PASSAGES ===',
  ];

  for (const diff of metrics.materialDifferences) {
    promptSections.push(`\n[${diff.differenceType.toUpperCase()}] ${diff.topic}: ${diff.summary}`);
    if (diff.docAPassage) {
      promptSections.push(`  Source A (${diff.docAPassage.location}): "${diff.docAPassage.text}"`);
    }
    if (diff.docBPassage) {
      promptSections.push(`  Source B (${diff.docBPassage.location}): "${diff.docBPassage.text}"`);
    }
  }

  promptSections.push(
    '',
    `--- DOCUMENT A FULL TEXT: "${docA.name}" ---`,
    docA.content.slice(0, 20000),
    `--- END DOCUMENT A ---`,
    '',
    `--- DOCUMENT B FULL TEXT: "${docB.name}" ---`,
    docB.content.slice(0, 20000),
    `--- END DOCUMENT B ---`,
    '',
    'Please perform an exhaustive comparative analysis covering:',
    '1. Executive Summary & Core Differences',
    '2. Key Substantive Changes & Clause-by-Clause Divergences (cite exact sections and quoted passages)',
    '3. Substantive Additions & Deletions',
    '4. Operational, Legal, and Strategic Tradeoffs',
    '=== END COMPARATIVE ANALYSIS REQUEST ===',
  );

  return {
    metrics,
    comparativePrompt: promptSections.filter(Boolean).join('\n'),
    summary,
  };
}
