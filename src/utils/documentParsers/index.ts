// src/utils/documentParsers/index.ts
// Unified document parsing entrypoint for PDF, Word (.docx), and Spreadsheet (.xlsx) (F06, F07, F08).

import { parsePdf, type PdfParseResult } from './pdfParser';
import { parseDocx, type DocxParseResult } from './docxParser';
import { parseXlsx, type XlsxParseResult } from './xlsxParser';

export * from './pdfParser';
export * from './docxParser';
export * from './xlsxParser';

export interface DocumentParseOutput {
  text: string;
  preview: string;
  documentType: 'pdf' | 'docx' | 'xlsx';
  metadata: {
    pageCount?: number;
    headingCount?: number;
    tableCount?: number;
    sheetCount?: number;
    sheetNames?: string[];
  };
}

export async function parseDocumentFile(file: File): Promise<DocumentParseOutput> {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  const buffer = await file.arrayBuffer();

  if (extension === '.pdf' || file.type === 'application/pdf') {
    const res: PdfParseResult = await parsePdf(buffer);
    return {
      text: res.extractedText,
      preview: res.preview,
      documentType: 'pdf',
      metadata: {
        pageCount: res.pageCount,
      },
    };
  }

  if (
    extension === '.docx' ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const res: DocxParseResult = await parseDocx(buffer);
    return {
      text: res.text,
      preview: res.preview,
      documentType: 'docx',
      metadata: {
        headingCount: res.headingCount,
        tableCount: res.tableCount,
      },
    };
  }

  if (
    extension === '.xlsx' ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    const res: XlsxParseResult = await parseXlsx(buffer);
    return {
      text: res.text,
      preview: res.preview,
      documentType: 'xlsx',
      metadata: {
        sheetCount: res.sheetCount,
        sheetNames: res.sheetNames,
      },
    };
  }

  throw new Error(`Unsupported document extension "${extension}"`);
}
