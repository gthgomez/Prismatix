// src/services/artifactService.ts
// Extraction, editing, versioning, and sandboxed rendering for generated artifacts.

export interface ArtifactVersion {
  versionNumber: number;
  content: string;
  savedAt: string;
  author: 'assistant' | 'user';
}

export interface Artifact {
  id: string;
  title: string;
  language: string;
  currentContent: string;
  versions: ArtifactVersion[];
  createdAt: string;
  updatedAt: string;
}

export function generateArtifactId(): string {
  return 'art_' + Math.random().toString(36).substring(2, 10);
}

export function detectArtifactLanguage(codeFenceHeader: string): { language: string; filename?: string } {
  const parts = codeFenceHeader.trim().split(/[\s:]+/);
  const language = (parts[0] || 'text').toLowerCase();
  const filename = parts.length > 1 ? parts[1] : undefined;
  return { language, filename };
}

export function extractArtifactsFromText(text: string): Artifact[] {
  const artifacts: Artifact[] = [];
  // Regex to match markdown fenced code blocks: ```lang[:filename] \n content \n ```
  const codeBlockRegex = /```([a-zA-Z0-9_-]+(?::[^\n\r]+)?)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let counter = 1;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const header = match[1] ?? 'text';
    const content = match[2] ?? '';
    const { language, filename } = detectArtifactLanguage(header);

    // Only extract substantive code blocks (> 10 chars) as artifacts
    if (content.trim().length >= 10) {
      const title = filename || `Artifact ${counter} (${language.toUpperCase()})`;
      const now = new Date().toISOString();
      artifacts.push({
        id: generateArtifactId(),
        title,
        language,
        currentContent: content,
        versions: [
          {
            versionNumber: 1,
            content,
            savedAt: now,
            author: 'assistant',
          },
        ],
        createdAt: now,
        updatedAt: now,
      });
      counter++;
    }
  }

  return artifacts;
}

export function saveArtifactRevision(artifact: Artifact, newContent: string): Artifact {
  if (artifact.currentContent === newContent) {
    return artifact;
  }
  const now = new Date().toISOString();
  const newVersion: ArtifactVersion = {
    versionNumber: artifact.versions.length + 1,
    content: newContent,
    savedAt: now,
    author: 'user',
  };

  return {
    ...artifact,
    currentContent: newContent,
    versions: [...artifact.versions, newVersion],
    updatedAt: now,
  };
}

export function getFileExtensionForLanguage(lang: string): string {
  const map: Record<string, string> = {
    javascript: 'js',
    js: 'js',
    typescript: 'ts',
    ts: 'ts',
    python: 'py',
    py: 'py',
    html: 'html',
    css: 'css',
    json: 'json',
    markdown: 'md',
    md: 'md',
    svg: 'svg',
    sql: 'sql',
    sh: 'sh',
    bash: 'sh',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return map[lang.toLowerCase()] || 'txt';
}

export function createSandboxedHtmlPreview(content: string, language: string): string {
  if (language === 'html') {
    // Wrap in standard HTML5 with isolation
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 1rem; color: #111; background: #fff; }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
  }

  if (language === 'svg') {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; display: flex; align-items: center; justify-content: center; height: 100vh; background: #f8fafc; }
    svg { max-width: 90vw; max-height: 90vh; }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
  }

  // Fallback text/code display
  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: monospace; padding: 1rem; background: #1e1e1e; color: #d4d4d4; white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>${escaped}</body>
</html>`;
}
