// byok_crypto.ts — AES-256-GCM encryption for user-supplied provider keys.
//
// Plaintext keys must never be persisted or logged. The edge function encrypts
// on write and the router decrypts on use; the database only ever holds
// `base64(iv || ciphertext)`. The symmetric key comes from the edge-function
// secret BYOK_ENCRYPTION_KEY (base64, 32 bytes); a missing/malformed key makes
// every operation throw so callers fail closed.
//
// No Deno-specific APIs: works under Deno and Node (globalThis.crypto.subtle)
// so the same module is unit-testable in vitest.

const ALGORITHM = 'AES-GCM';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ENV_KEY = 'BYOK_ENCRYPTION_KEY';

export class ByokConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ByokConfigError';
  }
}

export class ByokDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ByokDecryptError';
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** Accepts standard or URL-safe base64, with or without padding. */
function decodeBase64(value: string): Uint8Array {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return base64ToBytes(padded);
}

function readEnvKey(): string | undefined {
  const env = (globalThis as { Deno?: { env?: { get(name: string): string | undefined } } }).Deno?.env;
  return env?.get(ENV_KEY);
}

export function isByokConfigured(): boolean {
  const raw = readEnvKey();
  return typeof raw === 'string' && raw.trim().length > 0;
}

async function importEncryptionKey(): Promise<CryptoKey> {
  const raw = readEnvKey();
  if (!raw || raw.trim() === '') {
    throw new ByokConfigError('BYOK encryption key is not configured');
  }
  let keyBytes: Uint8Array;
  try {
    keyBytes = decodeBase64(raw);
  } catch {
    throw new ByokConfigError('BYOK encryption key is not valid base64');
  }
  if (keyBytes.length !== KEY_BYTES) {
    throw new ByokConfigError(`BYOK encryption key must decode to ${KEY_BYTES} bytes`);
  }
  // Copy into a fresh ArrayBuffer so the JSDOM/Node BufferSource typing is exact.
  const keyMaterial = keyBytes.slice().buffer;
  return crypto.subtle.importKey('raw', keyMaterial, { name: ALGORITHM }, false, [
    'encrypt',
    'decrypt',
  ]);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface EncryptedKey {
  ciphertext: string;
  last4: string;
  fingerprint: string;
}

/** Encrypts a plaintext provider key for storage. */
export async function encryptKey(plaintext: string): Promise<EncryptedKey> {
  const trimmed = plaintext.trim();
  if (trimmed === '') {
    throw new ByokConfigError('Cannot encrypt an empty key');
  }
  const key = await importEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(trimmed);
  const cipher = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded);

  const combined = new Uint8Array(IV_BYTES + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), IV_BYTES);

  return {
    ciphertext: bytesToBase64(combined),
    last4: trimmed.slice(-4),
    fingerprint: await sha256Hex(trimmed),
  };
}

/** Decrypts a stored `base64(iv || ciphertext)` blob back to the plaintext key. */
export async function decryptKey(ciphertext: string): Promise<string> {
  if (!ciphertext) {
    throw new ByokDecryptError('No ciphertext to decrypt');
  }
  const key = await importEncryptionKey();

  let combined: Uint8Array;
  try {
    combined = decodeBase64(ciphertext);
  } catch {
    throw new ByokDecryptError('Stored key material is not valid base64');
  }
  if (combined.length <= IV_BYTES) {
    throw new ByokDecryptError('Stored key material is truncated');
  }

  const iv = combined.slice(0, IV_BYTES);
  const body = combined.slice(IV_BYTES);
  try {
    const plain = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, body.slice().buffer);
    return new TextDecoder().decode(plain);
  } catch {
    throw new ByokDecryptError('Stored key material failed to decrypt');
  }
}
