// @vitest-environment node
// BYOK encryption contract: plaintext keys are never stored, decryption is
// authenticated, and a missing/malformed server key fails closed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ByokConfigError,
  ByokDecryptError,
  decryptKey,
  encryptKey,
  isByokConfigured,
} from '../../supabase/functions/_shared/byok_crypto.ts';

const VALID_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

function setDenoEnv(env: Record<string, string | undefined>): void {
  (globalThis as unknown as Record<string, unknown>).Deno = {
    env: { get: (key: string): string | undefined => env[key] },
  };
}

describe('byok_crypto', () => {
  beforeEach(() => setDenoEnv({ BYOK_ENCRYPTION_KEY: VALID_KEY }));
  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).Deno;
  });

  it('round-trips a key and exposes only the last 4 characters', async () => {
    const encrypted = await encryptKey('sk-test-secret-1234');
    expect(encrypted.last4).toBe('1234');
    expect(encrypted.ciphertext).not.toContain('sk-test-secret');
    expect(encrypted.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    await expect(decryptKey(encrypted.ciphertext)).resolves.toBe('sk-test-secret-1234');
  });

  it('uses a fresh IV so identical keys produce different ciphertexts', async () => {
    const a = await encryptKey('same-key');
    const b = await encryptKey('same-key');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('rejects a tampered ciphertext', async () => {
    const encrypted = await encryptKey('tamper-me');
    const tampered = `${encrypted.ciphertext.slice(0, -4)}AAAA`;
    await expect(decryptKey(tampered)).rejects.toBeInstanceOf(ByokDecryptError);
  });

  it('fails closed when no encryption key is configured', async () => {
    setDenoEnv({});
    expect(isByokConfigured()).toBe(false);
    await expect(encryptKey('x')).rejects.toBeInstanceOf(ByokConfigError);
  });

  it('rejects a key that is not 32 bytes', async () => {
    setDenoEnv({ BYOK_ENCRYPTION_KEY: Buffer.from('short').toString('base64') });
    await expect(encryptKey('x')).rejects.toBeInstanceOf(ByokConfigError);
  });
});
