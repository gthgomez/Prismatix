import { describe, expect, it } from 'vitest';
import { extractTextContent, calculateHistoryTokens, estimateTokens } from './utils';
import type { Message } from './types';

describe('extractTextContent', () => {
  it('returns strings as-is', () => {
    expect(extractTextContent('Hello world')).toBe('Hello world');
    expect(extractTextContent('')).toBe('');
  });

  it('extracts text parts from multimodal array', () => {
    const multimodal = [
      { type: 'text', text: 'First line of question' },
      { type: 'image_url', image_url: { url: 'https://example.com/pic.png' } },
      { type: 'text', text: 'Second line of question' },
    ];
    expect(extractTextContent(multimodal)).toBe('First line of question\nSecond line of question');
  });

  it('extracts string elements if array contains plain strings', () => {
    const parts = ['Line 1', 'Line 2'];
    expect(extractTextContent(parts)).toBe('Line 1\nLine 2');
  });

  it('returns empty string for non-string non-array values or empty arrays', () => {
    expect(extractTextContent(null)).toBe('');
    expect(extractTextContent(undefined)).toBe('');
    expect(extractTextContent(123)).toBe('');
    expect(extractTextContent([])).toBe('');
    expect(extractTextContent([{ type: 'image_url' }])).toBe('');
  });
});

describe('calculateHistoryTokens', () => {
  it('calculates tokens for messages with multimodal content', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this architecture?' },
        ],
        timestamp: 1700000000000,
      },
      {
        role: 'assistant',
        content: 'It is a microservices event loop.',
        timestamp: 1700000001000,
      },
    ];

    const tokens = calculateHistoryTokens(messages);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBe(
      estimateTokens('What is this architecture?') +
      estimateTokens('It is a microservices event loop.')
    );
  });
});
