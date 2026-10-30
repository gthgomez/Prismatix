// Non-secret fixtures: this test key encrypts only fake provider credentials.
export const TEST_BYOK_ENCRYPTION_KEY = Buffer.from(
  '0123456789abcdef0123456789abcdef',
).toString('base64');

export const FAKE_BYOK_PROVIDER_KEY = 'fake-byok-provider-key';
export const FAKE_BYOK_CIPHERTEXT =
  'BwcHBwcHBwcHBwcH0uOcYiLwPUwm4V3k2QUnCdr7wF6z6dQVvnbDMeeBV2H6hw4RWXE=';

export function installTestByokEnv(): () => void {
  const root = globalThis as unknown as Record<string, unknown>;
  const previous = root.Deno;
  root.Deno = {
    env: { get: (name: string): string | undefined => name === 'BYOK_ENCRYPTION_KEY' ? TEST_BYOK_ENCRYPTION_KEY : undefined },
  };
  return () => {
    if (previous === undefined) delete root.Deno;
    else root.Deno = previous;
  };
}
