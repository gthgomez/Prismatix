import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FormattedMessage, CodeBlock } from './FormattedMessage';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container.remove();
  root = null;
  vi.restoreAllMocks();
});

function render(ui: React.ReactNode): Root {
  const r = createRoot(container);
  act(() => {
    r.render(ui);
  });
  return r;
}

describe('FormattedMessage', () => {
  it('renders plain prose paragraphs cleanly', () => {
    root = render(<FormattedMessage content='Hello world\nThis is a second line.' />);
    expect(container.textContent).toContain('Hello world');
    expect(container.textContent).toContain('This is a second line.');
    expect(container.querySelectorAll('.formatted-p').length).toBe(2);
  });

  it('renders fenced code blocks with language label and copy button', () => {
    const markdown = '```python\ndef hello():\n    return "world"\n```';
    root = render(<FormattedMessage content={markdown} />);

    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('def hello():');
    expect(container.querySelector('.code-block-lang')?.textContent).toBe('python');
    expect(container.querySelector('.code-copy-btn')?.textContent).toBe('Copy');
  });

  it('handles unclosed code blocks during active streaming without breaking', () => {
    const streamingMarkdown = '```typescript\nconst greeting: string = "hi";';
    root = render(<FormattedMessage content={streamingMarkdown} isStreaming showCursor />);

    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('const greeting: string = "hi";');
    expect(container.querySelector('.code-block-lang')?.textContent).toBe('typescript');
    expect(container.querySelector('.cursor-blink')).not.toBeNull();
  });

  it('renders inline code, bold, and italic text', () => {
    const content = 'Use `console.log()` to print **important** *info*.';
    root = render(<FormattedMessage content={content} />);

    const code = container.querySelector('code.inline-code');
    expect(code?.textContent).toBe('console.log()');

    const strong = container.querySelector('strong');
    expect(strong?.textContent).toBe('important');

    const em = container.querySelector('em');
    expect(em?.textContent).toBe('info');
  });

  it('does not treat letters around asterisks as emphasis', () => {
    root = render(<FormattedMessage content={'Keep a*b*c and é*b*é and ü*info*ü literal, emphasize *info* and café *au* lait.'} />);
    const emphasis = [...container.querySelectorAll('em')].map((node) => node.textContent);
    expect(emphasis).toEqual(['info', 'au']);
    expect(container.textContent).toContain('a*b*c');
    expect(container.textContent).toContain('é*b*é');
    expect(container.textContent).toContain('ü*info*ü');
  });

  it('nests indented lists and keeps mixed markers as separate lists', () => {
    const content = [
      '- Parent',
      '  - Child',
      '  - Child two',
      '- Sibling',
      '1. Number',
      '  1. Nested number',
    ].join('\n');
    root = render(<FormattedMessage content={content} />);

    const topBullet = container.querySelector('ul.formatted-list');
    expect(topBullet).not.toBeNull();
    const topBulletItems = [...topBullet!.children].filter((node) => node.tagName === 'LI');
    expect(topBulletItems).toHaveLength(2);
    expect(topBulletItems[0]?.textContent).toContain('Parent');
    const nestedBullets = topBulletItems[0]?.querySelectorAll(':scope > ul.formatted-list > li');
    expect(nestedBullets).toHaveLength(2);
    expect(nestedBullets?.[0]?.textContent).toBe('Child');
    expect(nestedBullets?.[1]?.textContent).toBe('Child two');
    expect(topBulletItems[1]?.querySelector('ul')).toBeNull();
    expect(topBulletItems[1]?.textContent).toBe('Sibling');

    const numbered = container.querySelector('ol.formatted-list');
    expect(numbered).not.toBeNull();
    const numberedItems = [...numbered!.children].filter((node) => node.tagName === 'LI');
    expect(numberedItems).toHaveLength(1);
    expect(numberedItems[0]?.textContent).toContain('Number');
    const nestedNumber = numberedItems[0]?.querySelector(':scope > ol.formatted-list > li');
    expect(nestedNumber?.textContent).toBe('Nested number');
    expect(container.querySelector('ul.formatted-list ol')).toBeNull();
  });

  it('renders headers and bullet lists', () => {
    const content = '### Features\n- First feature\n- Second feature\n1. Numbered item';
    root = render(<FormattedMessage content={content} />);

    expect(container.querySelector('h4.formatted-h3')?.textContent).toBe('Features');
    expect(container.querySelectorAll('li').length).toBe(3);
  });

  it('is completely immune to HTML injection (XSS)', () => {
    const malicious = '<script>alert("hack")</script><img src=x onerror=alert(1)>';
    root = render(<FormattedMessage content={malicious} />);

    // Must be escaped text, not DOM elements
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<script>alert("hack")</script>');
  });

  it('copies code to clipboard and updates button state', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    root = render(<CodeBlock language='bash' code='npm run test' />);
    const copyBtn = container.querySelector<HTMLButtonElement>('.code-copy-btn')!;
    expect(copyBtn.textContent).toBe('Copy');

    await act(async () => {
      copyBtn.click();
    });

    expect(writeTextMock).toHaveBeenCalledWith('npm run test');
    expect(copyBtn.textContent).toBe('✓ Copied');
  });

  it('renders multi-line blockquotes into a single blockquote element with line breaks', () => {
    const quote = '> Line one of quote\n> Line two of quote';
    root = render(<FormattedMessage content={quote} />);

    const bq = container.querySelectorAll('blockquote.formatted-quote');
    expect(bq.length).toBe(1);
    expect(bq[0]?.textContent).toContain('Line one of quote');
    expect(bq[0]?.textContent).toContain('Line two of quote');
  });

  it('renders markdown tables cleanly', () => {
    const table = '| Header A | Header B |\n| --- | --- |\n| Cell 1 | Cell 2 |';
    root = render(<FormattedMessage content={table} />);

    const tableEl = container.querySelector('table.formatted-table');
    expect(tableEl).not.toBeNull();
    const ths = container.querySelectorAll('th');
    expect(ths.length).toBe(2);
    expect(ths[0]?.textContent).toBe('Header A');
    const tds = container.querySelectorAll('td');
    expect(tds.length).toBe(2);
    expect(tds[0]?.textContent).toBe('Cell 1');
  });
});
