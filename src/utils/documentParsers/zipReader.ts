// src/utils/documentParsers/zipReader.ts
// Pure TypeScript safe zip reader supporting Central Directory and Local Header records (F07/F08).
// Enforces aggregate cumulative decompression bounds across the entire archive (zip-bomb defense).

export interface ZipEntry {
  filename: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number; // 0 = stored, 8 = deflated
  dataOffset: number;
}

const MAX_TOTAL_DECOMPRESSED_BYTES = 30 * 1024 * 1024; // 30MB safety limit across entire archive

export class ZipArchive {
  private buffer: Uint8Array;
  private view: DataView;
  private entries: Map<string, ZipEntry> = new Map();
  private cumulativeDecompressedBytes = 0;

  constructor(buffer: Uint8Array) {
    this.buffer = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // Try reading Central Directory first (standard, handles data descriptors)
    const cdSuccess = this.parseCentralDirectory();
    if (!cdSuccess || this.entries.size === 0) {
      // Fallback to local headers scan
      this.parseLocalHeaders();
    }
  }

  /**
   * Locates and parses the End of Central Directory Record (EOCD) and Central Directory headers.
   */
  private parseCentralDirectory(): boolean {
    const len = this.buffer.length;
    if (len < 22) return false;

    // Search backwards for EOCD signature: 0x06054b50 (PK\x05\x06)
    let eocdOffset = -1;
    const maxSearch = Math.min(len - 22, 65535 + 22);

    for (let i = len - 22; i >= len - maxSearch; i--) {
      if (
        this.buffer[i] === 0x50 &&
        this.buffer[i + 1] === 0x4b &&
        this.buffer[i + 2] === 0x05 &&
        this.buffer[i + 3] === 0x06
      ) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset === -1) return false;

    const totalEntries = this.view.getUint16(eocdOffset + 10, true);
    const cdSize = this.view.getUint32(eocdOffset + 12, true);
    const cdOffset = this.view.getUint32(eocdOffset + 16, true);

    if (cdOffset + cdSize > len) return false;

    let offset = cdOffset;
    for (let i = 0; i < totalEntries && offset + 46 <= len; i++) {
      const sig = this.view.getUint32(offset, true);
      // Central Directory File Header: 0x02014b50 (PK\x01\x02)
      if (sig !== 0x02014b50) break;

      const compressionMethod = this.view.getUint16(offset + 10, true);
      const compressedSize = this.view.getUint32(offset + 20, true);
      const uncompressedSize = this.view.getUint32(offset + 24, true);
      const filenameLength = this.view.getUint16(offset + 28, true);
      const extraLength = this.view.getUint16(offset + 30, true);
      const commentLength = this.view.getUint16(offset + 32, true);
      const localHeaderOffset = this.view.getUint32(offset + 42, true);

      if (offset + 46 + filenameLength > len) break;
      const filenameBytes = this.buffer.subarray(offset + 46, offset + 46 + filenameLength);
      const filename = new TextDecoder('utf-8').decode(filenameBytes);

      // Resolve data offset from local header
      if (localHeaderOffset + 30 <= len) {
        const localSig = this.view.getUint32(localHeaderOffset, true);
        if (localSig === 0x04034b50) {
          const localFnLen = this.view.getUint16(localHeaderOffset + 26, true);
          const localExLen = this.view.getUint16(localHeaderOffset + 28, true);
          const dataOffset = localHeaderOffset + 30 + localFnLen + localExLen;

          this.entries.set(filename, {
            filename,
            compressedSize,
            uncompressedSize,
            compressionMethod,
            dataOffset,
          });
        }
      }

      offset += 46 + filenameLength + extraLength + commentLength;
    }

    return this.entries.size > 0;
  }

  /**
   * Sequential scan of local file headers (0x04034b50).
   */
  private parseLocalHeaders(): void {
    let offset = 0;
    const len = this.buffer.length;

    while (offset + 30 <= len) {
      const sig = this.view.getUint32(offset, true);
      if (sig !== 0x04034b50) break;

      const flags = this.view.getUint16(offset + 6, true);
      const compressionMethod = this.view.getUint16(offset + 8, true);
      let compressedSize = this.view.getUint32(offset + 18, true);
      const uncompressedSize = this.view.getUint32(offset + 22, true);
      const filenameLength = this.view.getUint16(offset + 26, true);
      const extraLength = this.view.getUint16(offset + 28, true);

      if (offset + 30 + filenameLength > len) break;
      const filenameBytes = this.buffer.subarray(offset + 30, offset + 30 + filenameLength);
      const filename = new TextDecoder('utf-8').decode(filenameBytes);

      const dataOffset = offset + 30 + filenameLength + extraLength;

      // Check if data descriptor is used (bit 3 of flags)
      const hasDataDescriptor = (flags & 0x0008) !== 0;
      if (hasDataDescriptor && compressedSize === 0) {
        // Find next header signature to determine compressedSize
        let nextOffset = dataOffset;
        while (nextOffset + 4 <= len) {
          const nextSig = this.view.getUint32(nextOffset, true);
          if (nextSig === 0x04034b50 || nextSig === 0x02014b50 || nextSig === 0x08074b50) {
            break;
          }
          nextOffset++;
        }
        compressedSize = nextOffset - dataOffset;
      }

      this.entries.set(filename, {
        filename,
        compressedSize,
        uncompressedSize,
        compressionMethod,
        dataOffset,
      });

      offset = dataOffset + compressedSize;
      // Skip data descriptor if present (signature 0x08074b50 + 12 bytes or 12 bytes without sig)
      if (hasDataDescriptor && offset + 4 <= len) {
        if (this.view.getUint32(offset, true) === 0x08074b50) {
          offset += 16;
        } else {
          offset += 12;
        }
      }
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

    if (entry.dataOffset + entry.compressedSize > this.buffer.length) {
      throw new Error(`Corrupt zip entry: ${filename} data offset out of bounds`);
    }

    const rawData = this.buffer.subarray(
      entry.dataOffset,
      entry.dataOffset + entry.compressedSize,
    );

    let resultBytes: Uint8Array;
    if (entry.compressionMethod === 0) {
      // Stored (no compression)
      resultBytes = rawData;
    } else if (entry.compressionMethod === 8) {
      // Deflated: decompress with DecompressionStream
      resultBytes = await decompressRawDeflate(rawData, entry.uncompressedSize);
    } else {
      throw new Error(`Unsupported zip compression method: ${entry.compressionMethod}`);
    }

    // Enforce cumulative aggregate bound across entire archive
    this.cumulativeDecompressedBytes += resultBytes.length;
    if (this.cumulativeDecompressedBytes > MAX_TOTAL_DECOMPRESSED_BYTES) {
      throw new Error('Total decompressed data exceeded aggregate 30MB safety limit (potential zip bomb)');
    }

    return resultBytes;
  }
}

async function decompressRawDeflate(compressed: Uint8Array, _expectedSize?: number): Promise<Uint8Array> {
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
            throw new Error('Decompressed entry exceeded safe 30MB limit (potential zip bomb)');
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
      if (err instanceof Error && err.message.includes('zip bomb')) {
        throw err;
      }
    }
  }

  throw new Error('DecompressionStream is not supported or stream was corrupted');
}
