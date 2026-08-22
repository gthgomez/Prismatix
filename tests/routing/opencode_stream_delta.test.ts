import { describe, it, expect } from 'vitest';
import { dispatchOpenCodeStream } from '../../supabase/functions/router/opencode_adapters';
import { CURATED_OPENCODE_REGISTRY } from '../../supabase/functions/router/models_hub';

describe('OpenCode Stream Delta Extraction & Multimodal Payload Preservation', () => {
  describe('Responses Protocol Streaming Parser', () => {
    it('accurately extracts deltas from real OpenAI Responses SSE frames', async () => {
      // Mock upstream responses stream emitting standard response.output_text.delta frames
      const frames = [
        { type: 'response.created', response: { id: 'resp-1', model: 'gpt-5.6-luna' } },
        { type: 'response.output_text.delta', delta: { text: 'Hello' } },
        { type: 'response.output_text.delta', delta: { text: ', ' } },
        { type: 'response.output_text.delta', delta: { text: 'world!' } },
        { type: 'response.completed', response: { id: 'resp-1', usage: { total_tokens: 15 } } },
      ];

      const config = CURATED_OPENCODE_REGISTRY['gpt-5.6-luna']!;
      let interceptedBody: any = null;

      const mockFetch = async (_url: string, init: any) => {
        interceptedBody = JSON.parse(init.body);
        return new Response(
          frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n',
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        );
      };

      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as any;

      try {
        const streamResult = await dispatchOpenCodeStream({
          config,
          messages: [{ role: 'user', content: 'Say hello' }],
          openCodeApiKey: 'test-key',
        });

        // Test delta extraction across all frames
        const extracted: string[] = [];
        for (const frame of frames) {
          const deltas = streamResult.extractDeltas(frame);
          extracted.push(...deltas);
        }

        expect(extracted.join('')).toBe('Hello, world!');
        expect(interceptedBody.model).toBe('gpt-5.6-luna');
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  describe('Multimodal Payload Preservation Across Protocols', () => {
    const testImage = {
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      mediaType: 'image/png',
    };

    it('preserves image attachments in openai-chat payload', async () => {
      let interceptedBody: any = null;
      const mockFetch = async (_url: string, init: any) => {
        interceptedBody = JSON.parse(init.body);
        return new Response('data: [DONE]\n\n', { status: 200 });
      };

      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as any;

      try {
        await dispatchOpenCodeStream({
          config: CURATED_OPENCODE_REGISTRY['deepseek-v4-flash']!,
          messages: [{ role: 'user', content: 'What is this image?' }],
          images: [testImage],
          openCodeApiKey: 'test-key',
        });

        const userMsg = interceptedBody.messages[0];
        expect(Array.isArray(userMsg.content)).toBe(true);
        expect(userMsg.content[0]).toEqual({ type: 'text', text: 'What is this image?' });
        expect(userMsg.content[1].type).toBe('image_url');
        expect(userMsg.content[1].image_url.url).toContain('data:image/png;base64,');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('preserves image attachments in anthropic-messages payload', async () => {
      let interceptedBody: any = null;
      const mockFetch = async (_url: string, init: any) => {
        interceptedBody = JSON.parse(init.body);
        return new Response('data: [DONE]\n\n', { status: 200 });
      };

      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as any;

      try {
        await dispatchOpenCodeStream({
          config: CURATED_OPENCODE_REGISTRY['claude-sonnet-5']!,
          messages: [{ role: 'user', content: 'Describe this image' }],
          images: [testImage],
          openCodeApiKey: 'test-key',
        });

        const userMsg = interceptedBody.messages[0];
        expect(Array.isArray(userMsg.content)).toBe(true);
        expect(userMsg.content[0].type).toBe('image');
        expect(userMsg.content[0].source.data).toBe(testImage.data);
        expect(userMsg.content[1]).toEqual({ type: 'text', text: 'Describe this image' });
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('preserves image attachments in gemini payload', async () => {
      let interceptedBody: any = null;
      const mockFetch = async (_url: string, init: any) => {
        interceptedBody = JSON.parse(init.body);
        return new Response('data: [DONE]\n\n', { status: 200 });
      };

      const origFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as any;

      try {
        await dispatchOpenCodeStream({
          config: CURATED_OPENCODE_REGISTRY['gemini-3.7-flash']!,
          messages: [{ role: 'user', content: 'Examine this screenshot' }],
          images: [testImage],
          openCodeApiKey: 'test-key',
        });

        const contents = interceptedBody.contents[0];
        expect(contents.role).toBe('user');
        expect(contents.parts[0]).toEqual({ text: 'Examine this screenshot' });
        expect(contents.parts[1].inline_data.mime_type).toBe('image/png');
        expect(contents.parts[1].inline_data.data).toBe(testImage.data);
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});
