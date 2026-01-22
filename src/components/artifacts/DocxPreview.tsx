import { useEffect, useState } from 'react';
import { cn } from '@/shared/lib/utils';
import { readFile, stat } from '@tauri-apps/plugin-fs';
import JSZip from 'jszip';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';

import { FileTooLarge } from './FileTooLarge';
import type { DocxParagraph, PreviewComponentProps } from './types';
import { isRemoteUrl, MAX_PREVIEW_SIZE, openFileExternal } from './utils';

export function DocxPreview({ artifact }: PreviewComponentProps) {
  const [paragraphs, setParagraphs] = useState<DocxParagraph[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileTooLarge, setFileTooLarge] = useState<number | null>(null);

  const handleOpenExternal = () => {
    if (artifact.path) {
      openFileExternal(artifact.path);
    }
  };

  useEffect(() => {
    async function loadDocx() {
      if (!artifact.path) {
        setError('No DOCX file path available');
        setLoading(false);
        return;
      }

      console.log('[DOCX Preview] Loading DOCX from path:', artifact.path);

      try {
        // Check file size first
        if (!isRemoteUrl(artifact.path)) {
          const fileInfo = await stat(artifact.path);
          if (fileInfo.size > MAX_PREVIEW_SIZE) {
            console.log('[DOCX Preview] File too large:', fileInfo.size);
            setFileTooLarge(fileInfo.size);
            setLoading(false);
            return;
          }
        }

        let arrayBuffer: ArrayBuffer;

        if (isRemoteUrl(artifact.path)) {
          const url = artifact.path.startsWith('//')
            ? `https:${artifact.path}`
            : artifact.path;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(
              `Failed to fetch DOCX: ${response.status} ${response.statusText}`
            );
          }
          arrayBuffer = await response.arrayBuffer();
        } else {
          const data = await readFile(artifact.path);
          arrayBuffer = data.buffer;
        }

        console.log('[DOCX Preview] Loaded', arrayBuffer.byteLength, 'bytes');

        // Parse DOCX using JSZip
        const zip = await JSZip.loadAsync(arrayBuffer);

        // Get document.xml content
        const documentXml = await zip
          .file('word/document.xml')
          ?.async('string');
        if (!documentXml) {
          throw new Error('Invalid DOCX: missing word/document.xml');
        }

        // Parse XML
        const parser = new DOMParser();
        const doc = parser.parseFromString(documentXml, 'text/xml');

        // Extract paragraphs
        const parsedParagraphs: DocxParagraph[] = [];
        const pElements = doc.querySelectorAll('w\\:p, p');

        pElements.forEach((pEl) => {
          // Get paragraph style
          const pStyle = pEl.querySelector('w\\:pStyle, pStyle');
          const styleName = pStyle?.getAttribute('w:val') || '';

          // Check if it's a heading
          const isHeading =
            styleName.toLowerCase().includes('heading') ||
            styleName.toLowerCase().includes('title') ||
            styleName.match(/^h\d$/i) !== null;
          const headingMatch = styleName.match(/(\d)/);
          const headingLevel = headingMatch
            ? parseInt(headingMatch[1])
            : undefined;

          // Get all text content from this paragraph
          const textElements = pEl.querySelectorAll('w\\:t, t');
          let paragraphText = '';

          textElements.forEach((tEl) => {
            paragraphText += tEl.textContent || '';
          });

          // Check for bold/italic
          const rPr = pEl.querySelector('w\\:rPr, rPr');
          const isBold = !!rPr?.querySelector('w\\:b, b');
          const isItalic = !!rPr?.querySelector('w\\:i, i');

          // Only add non-empty paragraphs
          if (paragraphText.trim()) {
            parsedParagraphs.push({
              text: paragraphText,
              style: styleName,
              isBold,
              isItalic,
              isHeading,
              headingLevel,
            });
          }
        });

        console.log(
          '[DOCX Preview] Parsed',
          parsedParagraphs.length,
          'paragraphs'
        );
        setParagraphs(parsedParagraphs);
        setError(null);
      } catch (err) {
        console.error('[DOCX Preview] Failed to load DOCX:', err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
      } finally {
        setLoading(false);
      }
    }

    loadDocx();
  }, [artifact.path]);

  if (loading) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
        <p className="text-muted-foreground mt-4 text-sm">
          Loading document...
        </p>
      </div>
    );
  }

  if (fileTooLarge !== null) {
    return (
      <FileTooLarge
        artifact={artifact}
        fileSize={fileTooLarge}
        icon={FileText}
        onOpenExternal={handleOpenExternal}
      />
    );
  }

  if (error || paragraphs.length === 0) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="border-border bg-background mb-4 flex size-20 items-center justify-center rounded-xl border">
            <FileText className="size-10 text-blue-500" />
          </div>
          <h3 className="text-foreground mb-2 text-lg font-medium">
            {artifact.name}
          </h3>
          <p className="text-muted-foreground mb-4 text-sm break-all whitespace-pre-wrap">
            {error || 'No content available'}
          </p>
          <button
            onClick={handleOpenExternal}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <ExternalLink className="size-4" />
            Open in Word
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background flex h-full flex-col">
      {/* Document content */}
      <div className="flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-3xl">
          {paragraphs.map((para, idx) => {
            // Render based on style
            if (para.isHeading || para.style?.toLowerCase().includes('title')) {
              const level =
                para.headingLevel ||
                (para.style?.toLowerCase().includes('title') ? 1 : 2);
              const headingClasses = cn(
                'text-foreground font-bold mb-4',
                level === 1 && 'text-3xl mt-8',
                level === 2 && 'text-2xl mt-6',
                level === 3 && 'text-xl mt-4',
                level > 3 && 'text-lg mt-4'
              );

              if (level === 1) {
                return (
                  <h1 key={idx} className={headingClasses}>
                    {para.text}
                  </h1>
                );
              } else if (level === 2) {
                return (
                  <h2 key={idx} className={headingClasses}>
                    {para.text}
                  </h2>
                );
              } else if (level === 3) {
                return (
                  <h3 key={idx} className={headingClasses}>
                    {para.text}
                  </h3>
                );
              } else {
                return (
                  <h4 key={idx} className={headingClasses}>
                    {para.text}
                  </h4>
                );
              }
            }

            // Regular paragraph
            return (
              <p
                key={idx}
                className={cn(
                  'text-foreground/90 mb-4 text-base leading-relaxed',
                  para.isBold && 'font-semibold',
                  para.isItalic && 'italic'
                )}
              >
                {para.text}
              </p>
            );
          })}
        </div>
      </div>

      {/* Status bar */}
      <div className="border-border bg-muted/30 text-muted-foreground shrink-0 border-t px-4 py-2 text-xs">
        {paragraphs.length} paragraphs
      </div>
    </div>
  );
}
