// src/utils/documentParsers/pdfParser.ts
// Bounded, safe PDF text extraction with page numbers, budgeting, and honest fallback (F06).

export interface PdfParseResult {
  pageCount: number;
  extractedText: string;
  preview: string;
  isScannedOrEmpty: boolean;
}

const MAX_PDF_PAGES = 50;
const MAX_PDF_CHARS = 100000;

export async function parsePdf(fileData: ArrayBuffer | Uint8Array): Promise<PdfParseResult> {
  const bytes = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData);
  const rawString = new TextDecoder('latin1').decode(bytes);

  // Validate PDF header
  if (!rawString.startsWith('%PDF-')) {
    throw new Error('Invalid PDF file: Missing %PDF- signature');
  }

  // 1. Locate pages
  // Match `/Type /Page` occurrences (avoiding `/Pages`)
  const pageMatches = rawString.match(/\/Type\s*\/Page\b/g);
  let detectedPageCount = pageMatches ? pageMatches.length : 1;
  if (detectedPageCount === 0) detectedPageCount = 1;

  // 2. Extract streams
  const pagesText: string[] = [];
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;

  // Track stream texts
  const extractedChunks: string[] = [];

  while ((match = streamRegex.exec(rawString)) !== null) {
    const streamStart = match.index + match[0].indexOf('\n') + 1;
    const streamEnd = match.index + match[0].lastIndexOf('endstream');
    const rawStreamBytes = bytes.subarray(streamStart, streamEnd);

    // Look at the dictionary immediately preceding the stream
    const dictSlice = rawString.slice(Math.max(0, match.index - 500), match.index);
    let decompressed: Uint8Array | null = null;

    if (dictSlice.includes('/FlateDecode')) {
      try {
        decompressed = await decompressZlib(rawStreamBytes);
      } catch {
        // Stream decompression failed or stream was not standard deflate
      }
    } else {
      decompressed = rawStreamBytes;
    }

    if (decompressed) {
      const streamText = new TextDecoder('latin1').decode(decompressed);
      const extracted = extractTextFromPdfStream(streamText);
      if (extracted.trim()) {
        extractedChunks.push(extracted.trim());
      }
    }
  }

  // Distribute chunks across detected pages
  if (extractedChunks.length > 0) {
    const chunksPerPage = Math.max(1, Math.ceil(extractedChunks.length / detectedPageCount));
    for (let p = 0; p < Math.min(detectedPageCount, MAX_PDF_PAGES); p++) {
      const pageSlice = extractedChunks.slice(p * chunksPerPage, (p + 1) * chunksPerPage);
      if (pageSlice.length > 0) {
        pagesText.push(`[Page ${p + 1}]\n${pageSlice.join('\n')}`);
      }
    }
  }

  const combined = pagesText.join('\n\n');
  const truncated = combined.slice(0, MAX_PDF_CHARS);

  const isScannedOrEmpty = truncated.trim().length === 0;
  const honestText = isScannedOrEmpty
    ? 'No extractable text found (OCR is not supported in this version).'
    : truncated;

  const preview = honestText.slice(0, 240) + (honestText.length > 240 ? '…' : '');

  return {
    pageCount: detectedPageCount,
    extractedText: honestText,
    preview,
    isScannedOrEmpty,
  };
}

/**
 * Extracts human-readable text from PDF BT ... ET operators (Tj, TJ, hex strings)
 */
function extractTextFromPdfStream(streamContent: string): string {
  const textPieces: string[] = [];
  const btRegex = /BT[\s\S]*?ET/g;
  let btMatch: RegExpExecArray | null;

  while ((btMatch = btRegex.exec(streamContent)) !== null) {
    const block = btMatch[0];

    // 1. Literal strings: (Hello world) Tj
    const tjRegex = /\(([\s\S]*?)\)\s*Tj/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      if (tjMatch[1]) {
        textPieces.push(unescapePdfString(tjMatch[1]));
      }
    }

    // 2. Text array: [ (Hello) -20 (world) ] TJ
    const arrayTjRegex = /\[([\s\S]*?)\]\s*TJ/g;
    let arrMatch: RegExpExecArray | null;
    while ((arrMatch = arrayTjRegex.exec(block)) !== null) {
      const inner = arrMatch[1] || '';
      const partRegex = /\(([\s\S]*?)\)/g;
      let partMatch: RegExpExecArray | null;
      let line = '';
      while ((partMatch = partRegex.exec(inner)) !== null) {
        if (partMatch[1]) {
          line += unescapePdfString(partMatch[1]);
        }
      }
      if (line) textPieces.push(line);
    }

    // 3. Hex strings: <48656c6c6f> Tj
    const hexRegex = /<([0-9a-fA-F]+)>\s*Tj/g;
    let hexMatch: RegExpExecArray | null;
    while ((hexMatch = hexRegex.exec(block)) !== null) {
      if (hexMatch[1]) {
        textPieces.push(decodePdfHexString(hexMatch[1]));
      }
    }
  }

  return textPieces.join(' ').replace(/\s+/g, ' ');
}

function unescapePdfString(str: string): string {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function decodePdfHexString(hex: string): string {
  let result = '';
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (!isNaN(code) && code >= 32 && code < 127) {
      result += String.fromCharCode(code);
    }
  }
  return result;
}

async function decompressZlib(bytes: Uint8Array): Promise<Uint8Array> {
  // Check if standard zlib header is present (78 01, 78 9c, 78 da)
  if (bytes.length >= 2 && bytes[0] === 0x78) {
    // Strip 2-byte zlib header to pass raw deflate to DecompressionStream('deflate-raw')
    const rawDeflate = bytes.subarray(2, bytes.length - 4);
    if (typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(rawDeflate as unknown as BufferSource);
      void writer.close();

      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.length;
        }
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      return out;
    }
  }

  // Direct deflate stream attempt
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(bytes as unknown as BufferSource);
    void writer.close();

    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }

  return bytes;
}
