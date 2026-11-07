// src/utils/documentParsers/zipReader.ts
// Pure TypeScript safe zip reader using standard DecompressionStream.
// Zero third-party dependencies, safe against prototype pollution and zip-bomb attacks.

export interface ZipEntry {
  filename: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number; // 0 = stored, 8 = deflated
  dataOffset: number;
}

const MAX_TOTAL_DECOMPRESSED_BYTES = 30 * 1024 * 1024; // 30MB safety limit

export class ZipArchive {
  private buffer: Uint8Array;
  private view: DataView;
  private entries: Map<string, ZipEntry> = new Map();

  constructor(buffer: Uint8Array) {
    this.buffer = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.parseLocalHeaders();
  }

  private parseLocalHeaders(): void {
    let offset = 0;
    const len = this.buffer.length;

    while (offset + 30 <= len) {
      const sig = this.view.getUint32(offset, true);
      // Local file header signature 0x04034b50 (PK\x03\x04)
      if (sig !== 0x04034b50) {
        break;
      }

      const compressionMethod = this.view.getUint16(offset + 8, true);
      const compressedSize = this.view.getUint32(offset + 18, true);
      const uncompressedSize = this.view.getUint32(offset + 22, true);
      const filenameLength = this.view.getUint16(offset + 26, true);
      const extraLength = this.view.getUint16(offset + 28, true);

      const filenameBytes = this.buffer.subarray(offset + 30, offset + 30 + filenameLength);
      const filename = new TextDecoder('utf-8').decode(filenameBytes);

      const dataOffset = offset + 30 + filenameLength + extraLength;

      this.entries.set(filename, {
        filename,
        compressedSize,
        uncompressedSize,
        compressionMethod,
        dataOffset,
      });

      offset = dataOffset + compressedSize;
    }
  }

  public getFilenames(): string[] {
    return Array.from(this.entries.keys());
  }

  public hasFile(filename: string): boolean {
    return this.entries.has(filename);
  }

  public async readText(filename: string): Promise<string | null> {
    const bytes = await this.readFile(filename);
    if (!bytes) return null;
    return new TextDecoder('utf-8').decode(bytes);
  }

  public async readFile(filename: string): Promise<Uint8Array | null> {
    const entry = this.entries.get(filename);
    if (!entry) return null;

    if (entry.uncompressedSize > MAX_TOTAL_DECOMPRESSED_BYTES) {
      throw new Error(`File ${filename} exceeds safe decompression limit (${entry.uncompressedSize} bytes)`);
    }

    const rawData = this.buffer.subarray(
      entry.dataOffset,
      entry.dataOffset + entry.compressedSize,
    );

    if (entry.compressionMethod === 0) {
      // Stored (no compression)
      return rawData;
    } else if (entry.compressionMethod === 8) {
      // Deflated: decompress with DecompressionStream
      return await decompressRawDeflate(rawData, entry.uncompressedSize);
    } else {
      throw new Error(`Unsupported zip compression method: ${entry.compressionMethod}`);
    }
  }
}

async function decompressRawDeflate(compressed: Uint8Array, _expectedSize?: number): Promise<Uint8Array> {
  // Use web standard DecompressionStream('deflate-raw')
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(compressed as unknown as BufferSource);
      void writer.close();

      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          totalLength += value.length;
          if (totalLength > MAX_TOTAL_DECOMPRESSED_BYTES) {
            throw new Error('Decompressed data exceeded safe limits (potential zip bomb)');
          }
        }
      }

      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    } catch (err) {
      // Fallback below if stream decompression throws
    }
  }

  throw new Error('DecompressionStream is not supported in this runtime environment');
}
