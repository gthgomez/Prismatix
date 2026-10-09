// Shared, Deno-free SSE parser + encoders. Single authority for the router and
// the browser client.
//
// Implements the Server-Sent Events wire framing (WHATWG SSE): recognizes
// `\r\n`, `\r` and `\n` line endings, joins multiple `data:` lines with `\n`,
// parses `event:`, `id:` and `retry:` fields, surfaces comment lines (used for
// heartbeats) as `{ comment: true }`, and dispatches an event on a blank line.
// The parser is incremental: it keeps a bounded buffer across chunks and is
// safe to feed bytes or text.
export interface SseEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
  comment?: boolean;
}

export interface SseParser {
  push(chunk: Uint8Array | string): SseEvent[];
  flush(): SseEvent[];
}

export function createSseParser(): SseParser {
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  let eventName: string | undefined;
  let lastId: string | undefined;
  let retry: number | undefined;

  const resetFields = () => {
    dataLines = [];
    eventName = undefined;
    retry = undefined;
  };
  const dispatch = (out: SseEvent[]) => {
    if (dataLines.length === 0 && eventName === undefined && retry === undefined) return;
    const evt: SseEvent = { data: dataLines.join('\n') };
    if (eventName !== undefined) evt.event = eventName;
    if (lastId !== undefined) evt.id = lastId;
    if (retry !== undefined) evt.retry = retry;
    out.push(evt);
    resetFields();
  };
  const processLine = (line: string, out: SseEvent[]) => {
    if (line === '') {
      dispatch(out);
      return;
    }
    if (line.startsWith(':')) {
      out.push({ data: '', comment: true });
      return;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
    else if (field === 'event') eventName = value;
    else if (field === 'id') lastId = value;
    else if (field === 'retry') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) retry = n;
    }
  };
  const feed = (text: string, out: SseEvent[]) => {
    buffer += text;
    for (;;) {
      const match = /\r\n|\r|\n/.exec(buffer);
      if (!match) break;
      const idx = match.index;
      if (match[0] === '\r' && idx === buffer.length - 1) break; // CRLF split across chunks
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + match[0].length);
      processLine(line, out);
    }
  };
  return {
    push(chunk) {
      const out: SseEvent[] = [];
      const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      feed(text, out);
      return out;
    },
    flush() {
      const out: SseEvent[] = [];
      if (buffer.length > 0) {
        // A trailing CR was withheld because it could be the first half of a
        // CRLF pair; at end-of-stream it is a complete line terminator.
        const tail = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
        buffer = '';
        processLine(tail, out);
      }
      dispatch(out);
      return out;
    },
  };
}

export function encodeSseEvent(event: {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}): string {
  let out = '';
  if (event.event !== undefined) out += `event: ${event.event}\n`;
  if (event.id !== undefined) out += `id: ${event.id}\n`;
  if (event.retry !== undefined) out += `retry: ${event.retry}\n`;
  for (const line of event.data.split('\n')) out += `data: ${line}\n`;
  return `${out}\n`;
}

export function encodeSseComment(text: string): string {
  return `: ${text}\n\n`;
}

export function isDoneData(event: SseEvent): boolean {
  return event.data === '[DONE]';
}
