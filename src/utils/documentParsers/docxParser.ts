// src/utils/documentParsers/docxParser.ts
// Safe Word (.docx) text, heading, and table extraction (F07).
// Rejects legacy .doc binary files and isolates XML content without macro execution.

import { ZipArchive } from './zipReader';

export interface DocxParseResult {
  text: string;
  preview: string;
  headingCount: number;
  tableCount: number;
}

const MAX_DOCX_CHARS = 100000;

export async function parseDocx(fileData: ArrayBuffer | Uint8Array): Promise<DocxParseResult> {
  const bytes = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData);

  // Check legacy OLE2 binary header (D0 CF 11 E0 A1 B1 1A E1)
  if (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  ) {
    throw new Error(
      'Legacy binary .doc format is not supported. Please save the document as modern .docx format before uploading.'
    );
  }

  // Check standard zip PK header
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('Invalid Word document: File is corrupt or not a valid .docx container.');
  }

  const zip = new ZipArchive(bytes);

  // Ensure word/document.xml exists
  if (!zip.hasFile('word/document.xml')) {
    throw new Error('Invalid Word document: missing word/document.xml');
  }

  const documentXml = await zip.readText('word/document.xml');
  if (!documentXml) {
    return {
      text: 'Empty Word document.',
      preview: 'Empty Word document.',
      headingCount: 0,
      tableCount: 0,
    };
  }

  return extractDocxContent(documentXml);
}

/**
 * Extracts headings, paragraphs, and tables from word/document.xml
 */
export function extractDocxContent(xml: string): DocxParseResult {
  let headingCount = 0;
  let tableCount = 0;
  const sections: string[] = [];

  // 1. Process tables (<w:tbl>...</w:tbl>)
  // We can replace tables with placeholders or parse them sequentially.
  // Sequential parsing by scanning paragraphs and tables:
  const blockRegex = /<(w:p|w:tbl)\b[\s\S]*?<\/\1>/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(xml)) !== null) {
    const blockTag = match[1];
    const blockContent = match[0];

    if (blockTag === 'w:p') {
      const paragraph = parseParagraph(blockContent);
      if (paragraph) {
        if (paragraph.isHeading) headingCount++;
        sections.push(paragraph.formatted);
      }
    } else if (blockTag === 'w:tbl') {
      tableCount++;
      const tableMd = parseTable(blockContent);
      if (tableMd) {
        sections.push(tableMd);
      }
    }
  }

  const combined = sections.join('\n\n').slice(0, MAX_DOCX_CHARS);
  const text = combined.trim() || 'No text found in Word document.';
  const preview = text.slice(0, 240) + (text.length > 240 ? '…' : '');

  return {
    text,
    preview,
    headingCount,
    tableCount,
  };
}

interface ParsedParagraph {
  formatted: string;
  isHeading: boolean;
}

function parseParagraph(pXml: string): ParsedParagraph | null {
  // Check heading style
  const styleMatch = /<w:pStyle\s+[^>]*w:val="([^"]+)"/i.exec(pXml);
  const styleVal = styleMatch && styleMatch[1] ? styleMatch[1].toLowerCase() : '';

  let headingPrefix = '';
  let isHeading = false;
  if (styleVal.includes('heading1') || styleVal === '1') {
    headingPrefix = '# ';
    isHeading = true;
  } else if (styleVal.includes('heading2') || styleVal === '2') {
    headingPrefix = '## ';
    isHeading = true;
  } else if (styleVal.includes('heading3') || styleVal === '3') {
    headingPrefix = '### ';
    isHeading = true;
  } else if (styleVal.includes('title')) {
    headingPrefix = '# ';
    isHeading = true;
  }

  // Check bullet / numbered list item
  const isList = /<w:numPr>/i.test(pXml);
  const listPrefix = isList ? '- ' : '';

  // Extract all text runs (<w:t>...</w:t>)
  const tRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let tMatch: RegExpExecArray | null;
  const runTexts: string[] = [];

  while ((tMatch = tRegex.exec(pXml)) !== null) {
    if (tMatch[1]) {
      runTexts.push(decodeXmlEntities(tMatch[1]));
    }
  }

  const rawText = runTexts.join('').trim();
  if (!rawText) return null;

  return {
    formatted: `${headingPrefix}${listPrefix}${rawText}`,
    isHeading,
  };
}

export function parseTable(tblXml: string): string {
  const rows: string[][] = [];
  const trMatches = tblXml.match(/<(?:w:)?tr[\s>][\s\S]*?<\/(?:w:)?tr>/g) || [];

  for (const rowXml of trMatches) {
    const cells: string[] = [];
    const tcMatches = rowXml.match(/<(?:w:)?tc[\s>][\s\S]*?<\/(?:w:)?tc>/g) || [];

    for (const cellXml of tcMatches) {
      const tMatches = cellXml.match(/<(?:w:)?t(?:\s+[^>]*)?>([\s\S]*?)<\/(?:w:)?t>/g) || [];
      const textPieces: string[] = [];

      for (const tTag of tMatches) {
        const innerMatch = /<(?:w:)?t(?:\s+[^>]*)?>([\s\S]*?)<\/(?:w:)?t>/.exec(tTag);
        if (innerMatch && innerMatch[1]) {
          textPieces.push(decodeXmlEntities(innerMatch[1]));
        }
      }

      const cleanCell = textPieces.join(' ').replace(/\|/g, '\\|').trim() || ' ';
      cells.push(cleanCell);
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map((r) => r.length));
  const normalizedRows = rows.map((r) => {
    const copy = [...r];
    while (copy.length < colCount) copy.push(' ');
    return copy;
  });

  const firstRow = normalizedRows[0] || [];
  const header = `| ${firstRow.join(' | ')} |`;
  const separator = `| ${firstRow.map(() => '---').join(' | ')} |`;
  const body = normalizedRows
    .slice(1)
    .map((r) => `| ${r.join(' | ')} |`)
    .join('\n');

  return body ? `${header}\n${separator}\n${body}` : `${header}\n${separator}`;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));
}
