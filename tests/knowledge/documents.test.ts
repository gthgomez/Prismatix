// tests/knowledge/documents.test.ts
import { describe, it, expect } from 'vitest';
import { parsePdf } from '../../src/utils/documentParsers/pdfParser';
import { extractDocxContent, parseDocx, parseTable } from '../../src/utils/documentParsers/docxParser';
import { parseXlsx } from '../../src/utils/documentParsers/xlsxParser';

describe('Document Parsers (F06, F07, F08)', () => {
  describe('F06: PDF Parsing', () => {
    it('rejects invalid non-PDF file headers', async () => {
      const invalidData = new TextEncoder().encode('Not a pdf file');
      await expect(parsePdf(invalidData)).rejects.toThrow(/invalid pdf file/i);
    });

    it('extracts text and assigns page numbers from uncompressed streams', async () => {
      const mockPdf = `%PDF-1.4
1 0 obj
<< /Type /Page >>
endobj
2 0 obj
stream
BT
/F1 12 Tf
(Quarterly Financial Report) Tj
ET
endstream
endobj
trailer
<< /Root 1 0 R >>
%%EOF`;
      const data = new TextEncoder().encode(mockPdf);
      const res = await parsePdf(data);
      expect(res.pageCount).toBeGreaterThanOrEqual(1);
      expect(res.extractedText).toContain('[Page 1]');
      expect(res.extractedText).toContain('Quarterly Financial Report');
      expect(res.isScannedOrEmpty).toBe(false);
    });

    it('truthfully reports when no extractable text is present (e.g. scanned image)', async () => {
      const scannedPdf = `%PDF-1.4
1 0 obj
<< /Type /Page >>
endobj
2 0 obj
stream
/Im1 Do
endstream
endobj
trailer
<< /Root 1 0 R >>
%%EOF`;
      const data = new TextEncoder().encode(scannedPdf);
      const res = await parsePdf(data);
      expect(res.isScannedOrEmpty).toBe(true);
      expect(res.extractedText).toContain('No extractable text found (OCR is not supported in this version)');
    });
  });

  describe('F07: Word (.docx) Parsing', () => {
    it('rejects legacy binary .doc with clear guidance to use .docx', async () => {
      // OLE2 magic header
      const ole2Header = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
      await expect(parseDocx(ole2Header)).rejects.toThrow(/legacy binary \.doc format is not supported/i);
    });

    it('parses table directly', () => {
      const sample = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></tc></w:tr></w:tbl>';
      const out = parseTable(sample);
      expect(out).toContain('| A |');
    });

    it('extracts headings, paragraphs, bullet lists, and tables as markdown', () => {
      const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Heading1"/>
      </w:pPr>
      <w:r><w:t>Project Architecture</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Prismatix personal multi-model AI workspace.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:numPr><w:ilvl w:val="0"/></w:numPr>
      </w:pPr>
      <w:r><w:t>Bring your own provider keys</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Model</w:t></w:r></w:p></tc>
        <w:tc><w:p><w:r><w:t>Provider</w:t></w:r></w:p></tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Claude 3.7</w:t></w:r></w:p></tc>
        <w:tc><w:p><w:r><w:t>Anthropic</w:t></w:r></w:p></tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

      const res = extractDocxContent(mockXml);
      expect(res.headingCount).toBe(1);
      expect(res.tableCount).toBe(1);
      expect(res.text).toContain('# Project Architecture');
      expect(res.text).toContain('Prismatix personal multi-model AI workspace.');
      expect(res.text).toContain('- Bring your own provider keys');
      expect(res.text).toContain('| Model | Provider |');
      expect(res.text).toContain('| Claude 3.7 | Anthropic |');
    });
  });

  describe('F08: Spreadsheet (.xlsx) Parsing', () => {
    it('rejects legacy binary .xls files', async () => {
      const ole2Header = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
      await expect(parseXlsx(ole2Header)).rejects.toThrow(/legacy binary \.xls format is not supported/i);
    });
  });
});
