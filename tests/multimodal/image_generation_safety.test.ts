// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: fixture.getUser }, rpc: fixture.rpc }),
}));

const IMAGE_ENTRY = ['../../supabase/functions/image-generation/index.ts'].join('');

describe('image generation spending containment', () => {
  beforeEach(() => {
    fixture.getUser.mockResolvedValue({ data: { user: { id: 'test-user' } }, error: null });
    fixture.rpc.mockResolvedValue({ data: null, error: null });
    vi.stubGlobal('Deno', {
      env: { get: (name: string) => name === 'SUPABASE_URL' ? 'https://fixture.invalid' : 'test-service-key' },
      serve: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function request(mockMode: boolean): Promise<Response> {
    const { handleImageGeneration } = await import(/* @vite-ignore */ IMAGE_ENTRY);
    return handleImageGeneration(new Request('https://fixture.invalid/functions/v1/image-generation', {
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'A mountain', modelId: 'dall-e-3', mockMode }),
    }));
  }

  it('refuses live execution before key access, budget mutation or provider dispatch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await request(false);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      success: false,
      error: expect.stringMatching(/live image generation.*unavailable/i),
    });
    expect(fixture.getUser).toHaveBeenCalledOnce();
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('still returns an explicitly unmetered, free preview', async () => {
    const response = await request(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, isMock: true, costStatus: 'unmetered', costUsd: 0 });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
});
