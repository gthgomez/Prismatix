import React, { useState } from 'react';

export interface FormattedMessageProps {
  content: string;
  isStreaming?: boolean;
  showCursor?: boolean;
}

interface CodeBlockProps {
  language: string;
  code: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Clipboard write failed (e.g. non-secure context or permission denied)
    }
  };

  const displayLang = language.trim() || 'code';

  return (
    <div className='code-block-wrapper'>
      <div className='code-block-header'>
        <span className='code-block-lang'>{displayLang}</span>
        <button
          type='button'
          className={`code-copy-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          aria-label={copied ? 'Code copied to clipboard' : 'Copy code to clipboard'}
          title={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className='code-block-pre'>
        <code className={`code-block-content language-${displayLang}`}>{code}</code>
      </pre>
    </div>
  );
};

interface Block {
  type: 'code' | 'text';
  language?: string;
  content: string;
}

/**
 * Splits markdown content into code blocks and prose text blocks.
 * Safely handles unclosed code blocks during active streaming.
 */
function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\\n/g, '\n');
  const lines = normalized.split('\n');
  let inCode = false;
  let currentLang = '';
  let currentCode: string[] = [];
  let currentText: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trimStart().startsWith('```')) {
      if (!inCode) {
        // Opening code fence
        if (currentText.length > 0) {
          blocks.push({ type: 'text', content: currentText.join('\n') });
          currentText = [];
        }
        inCode = true;
        currentLang = line.trimStart().slice(3).trim();
        currentCode = [];
      } else {
        // Closing code fence
        inCode = false;
        blocks.push({
          type: 'code',
          language: currentLang,
          content: currentCode.join('\n'),
        });
        currentLang = '';
        currentCode = [];
      }
    } else {
      if (inCode) {
        currentCode.push(line);
      } else {
        currentText.push(line);
      }
    }
  }

  // Handle unclosed code block (common during live token streaming)
  if (inCode && currentCode.length > 0) {
    blocks.push({
      type: 'code',
      language: currentLang,
      content: currentCode.join('\n'),
    });
  } else if (currentText.length > 0) {
    blocks.push({ type: 'text', content: currentText.join('\n') });
  }

  return blocks;
}

/**
 * Parses inline formatting (inline `code`, **bold**, *italic*) within a text string.
 * Completely immune to HTML injection as output is React nodes only.
 */
function parseInline(text: string): React.ReactNode[] {
  // Regex matches: `inline code`, **bold**, or *italic*
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(pattern);

  return parts.map((part, index) => {
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return (
        <code key={index} className='inline-code'>
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 3) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

/**
 * Renders prose text lines, handling headers, bullet points, multi-line blockquotes, tables, and line breaks.
 */
function renderProse(text: string): React.ReactNode {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: React.ReactNode[] = [];
  let isNumberedList = false;
  let currentQuoteLines: string[] = [];

  const flushQuote = () => {
    if (currentQuoteLines.length > 0) {
      elements.push(
        <blockquote key={`quote-${elements.length}`} className='formatted-quote'>
          {currentQuoteLines.map((qLine, qIdx) => (
            <React.Fragment key={qIdx}>
              {qIdx > 0 && <br />}
              {parseInline(qLine)}
            </React.Fragment>
          ))}
        </blockquote>,
      );
      currentQuoteLines = [];
    }
  };

  const flushList = () => {
    if (currentList.length > 0) {
      if (isNumberedList) {
        elements.push(
          <ol key={`list-${elements.length}`} className='formatted-list'>
            {currentList}
          </ol>,
        );
      } else {
        elements.push(
          <ul key={`list-${elements.length}`} className='formatted-list'>
            {currentList}
          </ul>,
        );
      }
      currentList = [];
      isNumberedList = false;
    }
  };

  const flushAll = () => {
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Multi-line Blockquotes (> or > text)
    if (trimmed.startsWith('>')) {
      flushList();
      const quoteText = trimmed.startsWith('> ') ? trimmed.slice(2) : trimmed.slice(1);
      currentQuoteLines.push(quoteText);
      continue;
    }
    flushQuote();

    // Markdown Table Detection (| col1 | col2 |)
    if (
      trimmed.startsWith('|') &&
      trimmed.endsWith('|') &&
      i + 1 < lines.length &&
      /^\|(\s*:?-+:?\s*\|)+$/.test(lines[i + 1]!.trim())
    ) {
      flushAll();
      const headerRow = trimmed
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim());
      i++; // Skip delimiter row

      const rows: string[][] = [];
      while (i + 1 < lines.length && lines[i + 1]!.trim().startsWith('|') && lines[i + 1]!.trim().endsWith('|')) {
        i++;
        const rowCells = lines[i]!
          .trim()
          .slice(1, -1)
          .split('|')
          .map((cell) => cell.trim());
        rows.push(rowCells);
      }

      elements.push(
        <div key={`table-wrapper-${i}`} className='formatted-table-wrapper'>
          <table className='formatted-table'>
            <thead>
              <tr>
                {headerRow.map((header, hIdx) => (
                  <th key={hIdx}>{parseInline(header)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx}>{parseInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Headers
    if (trimmed.startsWith('### ')) {
      flushAll();
      elements.push(
        <h4 key={`h3-${i}`} className='formatted-h3'>
          {parseInline(trimmed.slice(4))}
        </h4>,
      );
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushAll();
      elements.push(
        <h3 key={`h2-${i}`} className='formatted-h2'>
          {parseInline(trimmed.slice(3))}
        </h3>,
      );
      continue;
    }
    if (trimmed.startsWith('# ')) {
      flushAll();
      elements.push(
        <h2 key={`h1-${i}`} className='formatted-h1'>
          {parseInline(trimmed.slice(2))}
        </h2>,
      );
      continue;
    }

    // Bullet lists (- or *)
    const bulletMatch = /^[*-]\s+(.+)/.exec(trimmed);
    if (bulletMatch) {
      if (isNumberedList) flushList();
      currentList.push(<li key={`item-${i}`}>{parseInline(bulletMatch[1]!)}</li>);
      continue;
    }

    // Numbered lists (1. or 2.)
    const numberMatch = /^\d+\.\s+(.+)/.exec(trimmed);
    if (numberMatch) {
      if (!isNumberedList && currentList.length > 0) flushList();
      isNumberedList = true;
      currentList.push(<li key={`item-${i}`}>{parseInline(numberMatch[1]!)}</li>);
      continue;
    }

    // Normal prose paragraph line
    flushAll();
    if (trimmed === '') {
      elements.push(<div key={`spacer-${i}`} className='formatted-spacer' />);
    } else {
      elements.push(
        <p key={`p-${i}`} className='formatted-p'>
          {parseInline(line)}
        </p>,
      );
    }
  }

  flushAll();
  return <>{elements}</>;
}

export const FormattedMessage: React.FC<FormattedMessageProps> = ({
  content,
  isStreaming = false,
  showCursor = false,
}) => {
  if (!content) {
    return showCursor ? <span className='cursor-blink'>▊</span> : null;
  }

  const blocks = parseBlocks(content);

  return (
    <div className={`formatted-message-container ${isStreaming ? 'streaming' : ''}`}>
      {blocks.map((block, idx) => {
        if (block.type === 'code') {
          return (
            <CodeBlock
              key={`code-${idx}`}
              language={block.language || 'text'}
              code={block.content}
            />
          );
        }
        return <React.Fragment key={`text-${idx}`}>{renderProse(block.content)}</React.Fragment>;
      })}
      {showCursor && <span className='cursor-blink'>▊</span>}
    </div>
  );
};
