// opencode_adapters.ts
// Protocol-specific adapters for OpenCode Zen/Console models with AbortSignal propagation.

import { ModelConfig } from './models_hub.ts';

export interface UpstreamStreamResult {
  response: Response;
  extractDeltas: (payload: any) => string[];
}

export async function dispatchOpenCodeStream(params: {
  config: ModelConfig;
  messages: Array<{ role: string; content: string; imageAttachments?: any[] }>;
  openCodeApiKey: string;
  openCodeBaseUrl?: string;
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
}): Promise<UpstreamStreamResult> {
  const {
    config,
    messages,
    openCodeApiKey,
    openCodeBaseUrl = 'https://opencode.ai/zen/v1',
    signal,
    maxTokens = config.budgetCap,
    temperature = 0.7,
  } = params;

  switch (config.protocol) {
    case 'openai-chat':
    case 'gemini': {
      // OpenAI-compatible Chat Completions protocol
      const formattedMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

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
      // OpenAI Responses protocol
      const input = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');

      const body = {
        model: config.modelId,
        input,
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
          const text = payload?.output_item?.text?.delta || payload?.delta?.text || payload?.text;
          return typeof text === 'string' && text.length > 0 ? [text] : [];
        },
      };
    }

    case 'anthropic-messages': {
      // Anthropic Messages protocol via OpenCode
      const systemMsg = messages.find((m) => m.role === 'system')?.content;
      const nonSystemMessages = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        }));

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
          return [];
        },
      };
    }
  }
}
