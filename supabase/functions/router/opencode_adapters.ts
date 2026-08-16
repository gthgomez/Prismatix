// opencode_adapters.ts
// Protocol-specific adapters for OpenCode Zen/Console models with multimodal support and AbortSignal propagation.

import { ModelConfig } from './models_hub.ts';

export interface UpstreamStreamResult {
  response: Response;
  extractDeltas: (payload: any) => string[];
}

export interface AdapterMessage {
  role: string;
  content: string;
}

export interface AdapterImage {
  data: string;
  mediaType: string;
}

export async function dispatchOpenCodeStream(params: {
  config: ModelConfig;
  messages: AdapterMessage[];
  images?: AdapterImage[];
  openCodeApiKey: string;
  openCodeBaseUrl?: string;
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
}): Promise<UpstreamStreamResult> {
  const {
    config,
    messages,
    images = [],
    openCodeApiKey,
    openCodeBaseUrl = 'https://opencode.ai/zen/v1',
    signal,
    maxTokens = config.budgetCap,
    temperature = 0.7,
  } = params;

  switch (config.protocol) {
    case 'openai-chat': {
      // OpenAI-compatible Chat Completions protocol with multimodal image support
      const formattedMessages = messages.map((m, idx) => {
        const isLastUser = m.role === 'user' && idx === messages.length - 1;
        if (isLastUser && images.length > 0) {
          return {
            role: m.role,
            content: [
              { type: 'text', text: m.content },
              ...images.map((img) => ({
                type: 'image_url',
                image_url: { url: `data:${img.mediaType};base64,${img.data}` },
              })),
            ],
          };
        }
        return { role: m.role, content: m.content };
      });

      const body = {
        model: config.modelId,
        messages: formattedMessages,
        stream: true,
        max_tokens: maxTokens,
        temperature,
      };

      const response = await fetch(`${openCodeBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openCodeApiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal,
      });

      return {
        response,
        extractDeltas: (payload: any) => {
          if (!payload?.choices || !Array.isArray(payload.choices)) return [];
          const deltas: string[] = [];
          for (const choice of payload.choices) {
            const text = choice?.delta?.content;
            if (typeof text === 'string' && text.length > 0) {
              deltas.push(text);
            }
          }
          return deltas;
        },
      };
    }

    case 'openai-responses': {
      // OpenAI Responses protocol with full streaming event delta extraction & multimodal support
      let inputPayload: any;
      if (images.length > 0) {
        inputPayload = messages.map((m, idx) => {
          const isLastUser = m.role === 'user' && idx === messages.length - 1;
          if (isLastUser) {
            return {
              role: m.role,
              content: [
                { type: 'input_text', text: m.content },
                ...images.map((img) => ({
                  type: 'input_image',
                  image_url: `data:${img.mediaType};base64,${img.data}`,
                })),
              ],
            };
          }
          return { role: m.role, content: m.content };
        });
      } else {
        inputPayload = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
      }

      const body = {
        model: config.modelId,
        input: inputPayload,
        stream: true,
        max_output_tokens: maxTokens,
        temperature,
      };

      const response = await fetch(`${openCodeBaseUrl}/responses`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openCodeApiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal,
      });

      return {
        response,
        extractDeltas: (payload: any) => {
          if (!payload) return [];
          // Support official OpenAI Responses streaming event types & output items
          const text =
            payload?.delta?.text ||
            payload?.response?.output_text?.delta ||
            payload?.output_item?.text?.delta ||
            (typeof payload?.delta === 'string' ? payload.delta : undefined) ||
            (typeof payload?.text === 'string' ? payload.text : undefined);

          if (typeof text === 'string' && text.length > 0) {
            return [text];
          }

          if (Array.isArray(payload?.output_items)) {
            const deltas: string[] = [];
            for (const item of payload.output_items) {
              if (typeof item?.text?.delta === 'string' && item.text.delta.length > 0) {
                deltas.push(item.text.delta);
              }
            }
            return deltas;
          }
          return [];
        },
      };
    }

    case 'anthropic-messages': {
      // Anthropic Messages protocol via OpenCode with multimodal image block support
      const systemMsg = messages.find((m) => m.role === 'system')?.content;
      const nonSystemMessages = messages
        .filter((m) => m.role !== 'system')
        .map((m, idx, arr) => {
          const isLastUser = m.role === 'user' && idx === arr.length - 1;
          if (isLastUser && images.length > 0) {
            return {
              role: 'user',
              content: [
                ...images.map((img) => ({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: img.mediaType,
                    data: img.data,
                  },
                })),
                { type: 'text', text: m.content },
              ],
            };
          }
          return {
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          };
        });

      const body: any = {
        model: config.modelId,
        messages: nonSystemMessages,
        max_tokens: maxTokens,
        stream: true,
        temperature,
      };
      if (systemMsg) {
        body.system = systemMsg;
      }

      const response = await fetch(`${openCodeBaseUrl}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': openCodeApiKey,
          'Authorization': `Bearer ${openCodeApiKey}`,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal,
      });

      return {
        response,
        extractDeltas: (payload: any) => {
          if (payload?.type === 'content_block_delta') {
            const text = payload?.delta?.text;
            return typeof text === 'string' && text.length > 0 ? [text] : [];
          }
          if (payload?.type === 'message_delta' && typeof payload?.delta?.text === 'string') {
            return [payload.delta.text];
          }
          return [];
        },
      };
    }

    case 'gemini': {
      // Gemini streaming via specialized endpoint or proxy with multimodal inline_data support
      const formattedContents = messages.map((m, idx) => {
        const isLastUser = m.role === 'user' && idx === messages.length - 1;
        const parts: any[] = [{ text: m.content }];
        if (isLastUser && images.length > 0) {
          for (const img of images) {
            parts.push({
              inline_data: {
                mime_type: img.mediaType,
                data: img.data,
              },
            });
          }
        }
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts,
        };
      });

      const body = {
        contents: formattedContents,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature,
        },
      };

      const response = await fetch(
        `${openCodeBaseUrl}/models/${encodeURIComponent(config.modelId)}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openCodeApiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify(body),
          signal,
        },
      );

      return {
        response,
        extractDeltas: (payload: any) => {
          if (!payload?.candidates || !Array.isArray(payload.candidates)) return [];
          const deltas: string[] = [];
          for (const candidate of payload.candidates) {
            const parts = candidate?.content?.parts;
            if (Array.isArray(parts)) {
              for (const part of parts) {
                if (typeof part?.text === 'string' && part.text.length > 0) {
                  deltas.push(part.text);
                }
              }
            }
          }
          return deltas;
        },
      };
    }
  }
}
