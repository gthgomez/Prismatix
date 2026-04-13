// src/services/contextManager.ts
import type { Message } from '../types.ts';
import { estimateTokenCount } from '../costEngine';

export interface ContextAnalysis {
  messageCount: number;
  tokenEstimate: number;
  utilizationPercent: number;
  shouldReset: boolean;
  summary?: string;
  recentContext: { role: string; preview: string }[];
}

export class ContextManager {
  private readonly MAX_CONTEXT_TOKENS = 200000;
  private readonly WARNING_THRESHOLD = 0.8;

  public analyzeConversation(messages: Message[]): ContextAnalysis {
    let totalTokens = 0;

    messages.forEach(msg => {
      const contentText = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);
      totalTokens += estimateTokenCount(contentText);
    });

    const utilization = totalTokens / this.MAX_CONTEXT_TOKENS;

    const recent = messages.slice(-3).map(m => {
      const text = typeof m.content === 'string'
        ? m.content
        : '[Multimodal Content]';
      return {
        role: m.role,
        preview: text.substring(0, 50) + (text.length > 50 ? '...' : '')
      };
    });

    return {
      messageCount: messages.length,
      tokenEstimate: totalTokens,
      utilizationPercent: utilization * 100,
      shouldReset: utilization > this.WARNING_THRESHOLD,
      recentContext: recent
    };
  }

  public generateContextSummary(messages: Message[]): ContextAnalysis & { summary: string } {
    const analysis = this.analyzeConversation(messages);
    return {
      ...analysis,
      summary: `Conversation with ${messages.length} messages.`,
    };
  }
}
