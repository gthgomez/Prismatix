// PX06 SSE parser conformance matrix.
//
// Exercises `supabase/functions/_shared/sse_parser.ts` (the single SSE authority
// shared by the Deno router and the Vite/browser client) against the SSE wire
// spec: CRLF/CR/LF line endings, chunk boundaries that split delimiters and
// multibyte text, multi-line `data:` fields, `event:`/`id:`/`retry:` fields,
// comment/heartbeat lines, the `[DONE]` terminator and encode round-trips.
import { describe, expect, it } from 'vitest';
import {
  createSseParser,
  encodeSseComment,
  encodeSseEvent,
  isDoneData,
  type SseEvent,
} from '../../supabase/functions/_shared/sse_parser.ts';
import {
  createSseParser as clientCreateSseParser,
  encodeSseEvent as clientEncodeSseEvent,
} from '../../src/sseParser.ts';

describe('client sseParser re-export', () => {
  it('re-exports the shared parser functions (one authority, no second parser)', () => {
    expect(clientCreateSseParser).toBe(createSseParser);
    expect(clientEncodeSseEvent).toBe(encodeSseEvent);
  });
});

describe('createSseParser line-ending conformance', () => {
  it('parses LF-delimited events', () => {
    const parser = createSseParser();
    const events = parser.push('data: hello\n\n');
    expect(events).toEqual([{ data: 'hello' }]);
  });

  it('parses CRLF-delimited events', () => {
    const parser = createSseParser();
    const events = parser.push('data: hello\r\n\r\n');
    expect(events).toEqual([{ data: 'hello' }]);
  });

  it('parses CR-only-delimited events', () => {
    const parser = createSseParser();
    // A non-final CR is unambiguously a line ending; the trailing CR is held
    // (it could be the first half of a CRLF pair) and dispatched by flush.
    const events = parser.push('data: hello\r\rdata: world\r');
    expect(events).toEqual([{ data: 'hello' }]);
    expect(parser.flush()).toEqual([{ data: 'world' }]);
  });

  it('does not treat a CR at a chunk boundary as a line ending until the next chunk arrives (CRLF split)', () => {
    const parser = createSseParser();
    // First chunk ends on a lone CR — could be CR of a CRLF pair.
    expect(parser.push('data: hello\r')).toEqual([]);
    // The LF completes the CRLF; the blank CRLF dispatches the event.
    const events = parser.push('\n\r\n');
    expect(events).toEqual([{ data: 'hello' }]);
  });
});

describe('createSseParser incremental chunking', () => {
  it('joins a single event split across many chunks', () => {
    const parser = createSseParser();
    const out: SseEvent[] = [];
    for (const chunk of ['da', 'ta: he', 'llo wo', 'rld', '\n', '\n']) {
      out.push(...parser.push(chunk));
    }
    expect(out).toEqual([{ data: 'hello world' }]);
  });

  it('decodes Uint8Array chunks with a streaming decoder (multibyte split)', () => {
    const parser = createSseParser();
    const encoder = new TextEncoder();
    const bytes = encoder.encode('data: héllo ✓\n\n');
    // Split in the middle of the multibyte characters.
    const first = bytes.slice(0, 8);
    const second = bytes.slice(8);
    const out = [...parser.push(first), ...parser.push(second)];
    expect(out).toEqual([{ data: 'héllo ✓' }]);
  });

  it('joins multiple data: lines with a newline', () => {
    const parser = createSseParser();
    const events = parser.push('data: line one\ndata: line two\n\n');
    expect(events).toEqual([{ data: 'line one\nline two' }]);
  });

  it('strips exactly one leading space from a field value', () => {
    const parser = createSseParser();
    const events = parser.push('data:  two spaces\n\n');
    expect(events).toEqual([{ data: ' two spaces' }]);
  });

  it('treats a bare field (no colon) as an empty value', () => {
    const parser = createSseParser();
    const events = parser.push('data\n\n');
    expect(events).toEqual([{ data: '' }]);
  });
});

describe('createSseParser field handling', () => {
  it('parses event, id and retry fields', () => {
    const parser = createSseParser();
    const events = parser.push('event: ping\nid: 42\nretry: 1500\ndata: payload\n\n');
    expect(events).toEqual([{ data: 'payload', event: 'ping', id: '42', retry: 1500 }]);
  });

  it('ignores a non-numeric or negative retry value', () => {
    const parser = createSseParser();
    const events = parser.push('retry: nope\ndata: x\n\n');
    expect(events).toEqual([{ data: 'x' }]);
  });

  it('emits comment lines (heartbeats) as comment events', () => {
    const parser = createSseParser();
    expect(parser.push(': keepalive\n\n')).toEqual([{ data: '', comment: true }]);
  });

  it('does not dispatch an empty trailing buffer on push', () => {
    const parser = createSseParser();
    expect(parser.push('')).toEqual([]);
  });
});

describe('createSseParser flush', () => {
  it('flushes an unterminated final event', () => {
    const parser = createSseParser();
    expect(parser.push('data: trailing')).toEqual([]);
    expect(parser.flush()).toEqual([{ data: 'trailing' }]);
  });

  it('flushes nothing when the buffer is empty', () => {
    const parser = createSseParser();
    expect(parser.push('data: done\n\n')).toEqual([{ data: 'done' }]);
    expect(parser.flush()).toEqual([]);
  });
});

describe('isDoneData', () => {
  it('recognizes the [DONE] terminator only', () => {
    expect(isDoneData({ data: '[DONE]' })).toBe(true);
    expect(isDoneData({ data: '[DONE] ', event: 'message' })).toBe(false);
    expect(isDoneData({ data: 'done' })).toBe(false);
  });
});

describe('encode helpers', () => {
  it('encodes a comment/heartbeat as ": <text>\\n\\n"', () => {
    expect(encodeSseComment('keepalive')).toBe(': keepalive\n\n');
  });

  it('round-trips a full event through encode + parse', () => {
    const parser = createSseParser();
    const encoded = encodeSseEvent({
      event: 'content_block_delta',
      id: 'evt-1',
      retry: 250,
      data: 'first line\nsecond line',
    });
    const events = parser.push(encoded);
    expect(events).toEqual([
      {
        data: 'first line\nsecond line',
        event: 'content_block_delta',
        id: 'evt-1',
        retry: 250,
      },
    ]);
  });

  it('encodes a plain data event with a trailing blank line', () => {
    expect(encodeSseEvent({ data: '[DONE]' })).toBe('data: [DONE]\n\n');
  });
});
