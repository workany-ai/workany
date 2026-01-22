import { API_BASE_URL } from '@/config';

import type { Artifact } from './types';

// Max file size for preview (50MB)
export const MAX_PREVIEW_SIZE = 50 * 1024 * 1024;

// Format file size for display
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Get file extension from artifact name
export function getFileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() || '';
}

// Check if a path is a URL (remote file)
export function isRemoteUrl(path: string): boolean {
  return (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('//')
  );
}

// Get language hint for syntax highlighting
export function getLanguageHint(artifact: Artifact): string {
  const ext = getFileExtension(artifact.name);
  const langMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    json: 'json',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    toml: 'toml',
  };
  return langMap[ext] || 'plaintext';
}

// Get app name for "Open with" button based on file type
export function getOpenWithApp(
  artifact: Artifact
): { name: string; icon: string } | null {
  switch (artifact.type) {
    case 'html':
      return { name: 'Browser', icon: 'Globe' };
    case 'presentation':
      return { name: 'Microsoft PowerPoint', icon: 'Presentation' };
    case 'document':
      return { name: 'Microsoft Word', icon: 'FileText' };
    case 'spreadsheet':
    case 'csv':
      return { name: 'Microsoft Excel', icon: 'FileSpreadsheet' };
    case 'pdf':
      return { name: 'Preview', icon: 'FileText' };
    case 'audio':
      return { name: 'Music Player', icon: 'Music' };
    case 'video':
      return { name: 'Video Player', icon: 'Video' };
    case 'image':
      return { name: 'Image Viewer', icon: 'Eye' };
    case 'font':
      return { name: 'Font Viewer', icon: 'FileText' };
    default:
      return null;
  }
}

// Parse CSV content to 2D array
export function parseCSV(content: string): string[][] {
  const lines = content.trim().split('\n');
  return lines.map((line) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  });
}

// Simple markdown to HTML converter
export function markdownToHtml(markdown: string): string {
  let html = markdown;

  // Escape HTML
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Code blocks
  html = html.replace(/```[\w]*\n([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');

  // Blockquotes
  html = html.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');

  // Unordered lists
  html = html.replace(/^\s*[-*+] (.*$)/gim, '<li>$1</li>');

  // Ordered lists
  html = html.replace(/^\s*\d+\. (.*$)/gim, '<li>$1</li>');

  // Wrap consecutive list items
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // Horizontal rules
  html = html.replace(/^[-*_]{3,}$/gim, '<hr />');

  // Paragraphs
  html = html.replace(/\n\n+/g, '</p><p>');
  html = `<p>${html}</p>`;
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[1-6]>)/g, '$1');
  html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre>)/g, '$1');
  html = html.replace(/(<\/pre>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<blockquote>)/g, '$1');
  html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
  html = html.replace(/<p>(<hr \/>)/g, '$1');

  return html;
}

// Inline CSS and JS into HTML content
export function inlineAssets(html: string, allArtifacts: Artifact[]): string {
  let result = html;

  // Find and inline CSS files
  const cssRegex = /<link[^>]*href=["']([^"']+\.css)["'][^>]*>/gi;
  result = result.replace(cssRegex, (match, filename) => {
    if (filename.startsWith('http') || filename.startsWith('//')) return match;

    const cssArtifact = allArtifacts.find(
      (a) => a.name === filename || a.name.endsWith(`/${filename}`)
    );

    if (cssArtifact?.content) {
      console.log('[ArtifactPreview] Inlining CSS:', filename);
      return `<style>/* Inlined from ${filename} */\n${cssArtifact.content}</style>`;
    }
    return match;
  });

  // Find and inline JS files
  const jsRegex = /<script[^>]*src=["']([^"']+\.js)["'][^>]*><\/script>/gi;
  result = result.replace(jsRegex, (match, filename) => {
    if (filename.startsWith('http') || filename.startsWith('//')) return match;

    const jsArtifact = allArtifacts.find(
      (a) => a.name === filename || a.name.endsWith(`/${filename}`)
    );

    if (jsArtifact?.content) {
      console.log('[ArtifactPreview] Inlining JS:', filename);
      return `<script>/* Inlined from ${filename} */\n${jsArtifact.content}</script>`;
    }
    return match;
  });

  return result;
}

// Open file in external application
export async function openFileExternal(path: string): Promise<void> {
  if (!path) return;
  try {
    await fetch(`${API_BASE_URL}/files/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  } catch (err) {
    console.error('[Preview] Failed to open file:', err);
  }
}

// Get MIME type for image files
export function getImageMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
  };
  return mimeTypes[ext] || 'image/png';
}

// Get MIME type for audio files
export function getAudioMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    wma: 'audio/x-ms-wma',
    aiff: 'audio/aiff',
    aud: 'audio/basic',
  };
  return mimeTypes[ext] || 'audio/mpeg';
}

// Get MIME type for video files
export function getVideoMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogg: 'video/ogg',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    m4v: 'video/x-m4v',
    wmv: 'video/x-ms-wmv',
    flv: 'video/x-flv',
    '3gp': 'video/3gpp',
  };
  return mimeTypes[ext] || 'video/mp4';
}

// Parse YAML frontmatter from markdown content
// Returns { frontmatter: parsed key-value pairs, content: remaining markdown }
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, string> | null;
  content: string;
} {
  // Match frontmatter: starts with ---, contains YAML content, ends with ---
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: null, content: content.trim() };
  }

  // Parse YAML key-value pairs (simple parsing for common cases)
  const yamlContent = match[1];
  const frontmatter: Record<string, string> = {};

  yamlContent.split('\n').forEach((line) => {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      let value = line.substring(colonIndex + 1).trim();
      // Remove surrounding quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && value) {
        frontmatter[key] = value;
      }
    }
  });

  const remainingContent = content.replace(frontmatterRegex, '').trim();
  return {
    frontmatter: Object.keys(frontmatter).length > 0 ? frontmatter : null,
    content: remainingContent,
  };
}

// Strip YAML frontmatter from markdown content (legacy, kept for compatibility)
export function stripFrontmatter(content: string): string {
  return parseFrontmatter(content).content;
}
