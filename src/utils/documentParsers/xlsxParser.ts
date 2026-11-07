// src/utils/documentParsers/xlsxParser.ts
// Safe Spreadsheet (.xlsx) sheet & table intelligence (F08).
// Extracts cached values, formats Markdown tables per sheet, caps budgets, and executes zero formulas.

import { ZipArchive } from './zipReader';

export interface XlsxParseResult {
  sheetCount: number;
  sheetNames: string[];
  text: string;
  preview: string;
}

const MAX_SHEETS = 10;
const MAX_ROWS_PER_SHEET = 500;
const MAX_COLS_PER_SHEET = 30;
const MAX_CELLS_PER_WORKBOOK = 10000;
const MAX_TOTAL_CHARS = 100000;

export async function parseXlsx(fileData: ArrayBuffer | Uint8Array): Promise<XlsxParseResult> {
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
      'Legacy binary .xls format is not supported. Please save the workbook as modern .xlsx format before uploading.'
    );
  }

  // Check standard zip PK header
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('Invalid Excel workbook: File is corrupt or not a valid .xlsx container.');
  }

  const zip = new ZipArchive(bytes);

  // 1. Read workbook.xml to get sheet names
  const workbookXml = await zip.readText('xl/workbook.xml');
  if (!workbookXml) {
    throw new Error('Invalid Excel workbook: missing xl/workbook.xml');
  }

  const sheets = extractSheetMetadata(workbookXml);
  if (sheets.length === 0) {
    return {
      sheetCount: 0,
      sheetNames: [],
      text: 'Empty Excel workbook.',
      preview: 'Empty Excel workbook.',
    };
  }

  // 2. Read shared strings if available
  const sharedStringsXml = await zip.readText('xl/sharedStrings.xml');
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];

  // 3. Read sheet worksheets
  const sheetTexts: string[] = [];
  const parsedSheetNames: string[] = [];
  const cellCounter = { count: 0 };

  for (let i = 0; i < Math.min(sheets.length, MAX_SHEETS); i++) {
    const sheetMeta = sheets[i];
    if (!sheetMeta) continue;
    parsedSheetNames.push(sheetMeta.name);

    // Try canonical path or r:id path
    const candidatePaths = [
      `xl/worksheets/sheet${i + 1}.xml`,
      `xl/worksheets/${sheetMeta.name}.xml`,
      `xl/worksheets/Sheet${i + 1}.xml`,
    ];

    let sheetXml: string | null = null;
    for (const path of candidatePaths) {
      if (zip.hasFile(path)) {
        sheetXml = await zip.readText(path);
        break;
      }
    }

    if (sheetXml) {
      const tableMd = parseSheetXml(sheetXml, sharedStrings, cellCounter);
      sheetTexts.push(`### Sheet: ${sheetMeta.name}\n\n${tableMd}`);
      if (cellCounter.count >= MAX_CELLS_PER_WORKBOOK) break;
    }
  }

  const combined = sheetTexts.join('\n\n---\n\n').slice(0, MAX_TOTAL_CHARS);
  const text = combined.trim() || 'No data found in workbook sheets.';
  const preview = text.slice(0, 240) + (text.length > 240 ? '…' : '');

  return {
    sheetCount: parsedSheetNames.length,
    sheetNames: parsedSheetNames,
    text,
    preview,
  };
}

interface SheetMeta {
  name: string;
  sheetId: string;
}

function extractSheetMetadata(workbookXml: string): SheetMeta[] {
  const sheets: SheetMeta[] = [];
  const sheetRegex = /<sheet\s+[^>]*name="([^"]+)"[^>]*sheetId="([^"]+)"/g;
  let match: RegExpExecArray | null;

  while ((match = sheetRegex.exec(workbookXml)) !== null) {
    if (match[1] && match[2]) {
      sheets.push({
        name: decodeXmlEntities(match[1]),
        sheetId: match[2],
      });
    }
  }

  if (sheets.length === 0) {
    // Alternate attribute order
    const altRegex = /<sheet\s+[^>]*sheetId="([^"]+)"[^>]*name="([^"]+)"/g;
    while ((match = altRegex.exec(workbookXml)) !== null) {
      if (match[1] && match[2]) {
        sheets.push({
          name: decodeXmlEntities(match[2]),
          sheetId: match[1],
        });
      }
    }
  }

  return sheets;
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siRegex = /<si\b[\s\S]*?<\/si>/g;
  let match: RegExpExecArray | null;

  while ((match = siRegex.exec(xml)) !== null) {
    const siContent = match[0];
    const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g;
    let tMatch: RegExpExecArray | null;
    let text = '';

    while ((tMatch = tRegex.exec(siContent)) !== null) {
      if (tMatch[1]) {
        text += tMatch[1];
      }
    }
    strings.push(decodeXmlEntities(text));
  }

  return strings;
}

function parseSheetXml(xml: string, sharedStrings: string[], cellCounter: { count: number }): string {
  const rowRegex = /<row\s+[^>]*r="(\d+)"[\s\S]*?<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  const grid: Map<number, Map<number, string>> = new Map();
  let maxColIndex = 0;
  let rowCount = 0;

  while ((rowMatch = rowRegex.exec(xml)) !== null && rowCount < MAX_ROWS_PER_SHEET) {
    if (cellCounter.count >= MAX_CELLS_PER_WORKBOOK) break;
    const rawRIdx = rowMatch[1];
    if (!rawRIdx) continue;
    const rIdx = parseInt(rawRIdx, 10);
    const rowContent = rowMatch[0];
    const cellMap = new Map<number, string>();

    const cellRegex = /<c\s+[^>]*r="([A-Z]+)(\d+)"(?:\s+[^>]*t="([^"]+)")?[^>]*>([\s\S]*?)<\/c>/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      if (cellCounter.count >= MAX_CELLS_PER_WORKBOOK) break;
      const colLetters = cellMatch[1] || '';
      const colIdx = columnLetterToIndex(colLetters);
      if (colIdx >= MAX_COLS_PER_SHEET) continue;
      if (colIdx > maxColIndex) maxColIndex = colIdx;

      const cellType = cellMatch[3] || '';
      const cellInner = cellMatch[4] || '';

      let value = '';
      if (cellType === 'inlineStr') {
        const tMatch = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/.exec(cellInner);
        value = tMatch && tMatch[1] ? decodeXmlEntities(tMatch[1]) : '';
      } else {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cellInner);
        if (vMatch && vMatch[1]) {
          const rawV = vMatch[1].trim();
          if (cellType === 's') {
            const strIdx = parseInt(rawV, 10);
            value = sharedStrings[strIdx] || rawV;
          } else if (cellType === 'b') {
            value = rawV === '1' ? 'TRUE' : 'FALSE';
          } else {
            value = rawV;
          }
        }
      }

      const cleanVal = value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
      cellMap.set(colIdx, cleanVal);
      cellCounter.count++;
    }

    if (cellMap.size > 0) {
      grid.set(rIdx, cellMap);
      rowCount++;
    }
  }

  if (grid.size === 0) return '*(No table data found on this sheet)*';

  // Format markdown table
  const sortedRowIndices = Array.from(grid.keys()).sort((a, b) => a - b);
  const totalCols = Math.min(maxColIndex + 1, MAX_COLS_PER_SHEET);

  const formattedRows: string[] = [];

  for (let r = 0; r < sortedRowIndices.length; r++) {
    const rowNum = sortedRowIndices[r];
    if (rowNum === undefined) continue;
    const cells = grid.get(rowNum);
    if (!cells) continue;
    const rowCells: string[] = [];

    for (let c = 0; c < totalCols; c++) {
      rowCells.push(cells.get(c) || '');
    }

    formattedRows.push(`| ${rowCells.join(' | ')} |`);

    // Insert markdown header separator after first row
    if (r === 0) {
      const sep = `| ${rowCells.map(() => '---').join(' | ')} |`;
      formattedRows.push(sep);
    }
  }

  return formattedRows.join('\n');
}

function columnLetterToIndex(colLetters: string): number {
  let index = 0;
  for (let i = 0; i < colLetters.length; i++) {
    index = index * 26 + (colLetters.charCodeAt(i) - 64);
  }
  return index - 1;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));
}
