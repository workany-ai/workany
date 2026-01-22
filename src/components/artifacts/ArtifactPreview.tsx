import { useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  Check,
  Code,
  Copy,
  ExternalLink,
  Eye,
  FileCode2,
  FileText,
  Maximize2,
  Radio,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { VitePreview } from '@/components/task/VitePreview';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { AudioPreview } from './AudioPreview';
import { CodePreview } from './CodePreview';
import { DocxPreview } from './DocxPreview';
import { ExcelPreview } from './ExcelPreview';
import { FileTooLarge } from './FileTooLarge';
import { FontPreview } from './FontPreview';
import { ImagePreview } from './ImagePreview';
import { PdfPreview } from './PdfPreview';
import { PptxPreview } from './PptxPreview';
import type {
  Artifact,
  ArtifactPreviewProps,
  PreviewMode,
  ViewMode,
} from './types';
import {
  getFileExtension,
  getOpenWithApp,
  inlineAssets,
  parseCSV,
  parseFrontmatter,
} from './utils';
import { VideoPreview } from './VideoPreview';
import { WebSearchPreview } from './WebSearchPreview';

// Expandable text component for long content
function ExpandableText({
  text,
  maxLength = 100,
}: {
  text: string;
  maxLength?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const needsTruncation = text.length > maxLength;

  if (!needsTruncation) {
    return <span>{text}</span>;
  }

  return (
    <span>
      {isExpanded ? text : `${text.slice(0, maxLength)}...`}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-primary ml-1 text-xs hover:underline"
      >
        {isExpanded ? 'Show less' : 'Show more'}
      </button>
    </span>
  );
}

export function ArtifactPreview({
  artifact,
  onClose,
  allArtifacts = [],
  livePreviewUrl,
  livePreviewStatus = 'idle',
  livePreviewError,
  onStartLivePreview,
  onStopLivePreview,
}: ArtifactPreviewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('static');
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isNodeAvailable, setIsNodeAvailable] = useState<boolean | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { t, tt } = useLanguage();

  // Check if Node.js is available (required for Live Preview)
  useEffect(() => {
    async function checkNodeAvailable() {
      try {
        const response = await fetch(`${API_BASE_URL}/preview/node-available`);
        const data = await response.json();
        setIsNodeAvailable(data.available);
        console.log('[ArtifactPreview] Node.js available:', data.available);
      } catch (error) {
        console.error(
          '[ArtifactPreview] Failed to check Node.js availability:',
          error
        );
        setIsNodeAvailable(false);
      }
    }
    checkNodeAvailable();
  }, []);

  // Check if live preview is available for this artifact
  // Requires: HTML artifact + onStartLivePreview handler + Node.js installed
  const canUseLivePreview = useMemo(() => {
    if (!artifact) return false;
    if (!isNodeAvailable) return false;
    return artifact.type === 'html' && onStartLivePreview !== undefined;
  }, [artifact, onStartLivePreview, isNodeAvailable]);

  // Auto-switch to live mode if live preview is already running
  useEffect(() => {
    if (livePreviewStatus === 'running' && canUseLivePreview) {
      setPreviewMode('live');
    }
  }, [livePreviewStatus, canUseLivePreview]);

  // Reset view mode and slide when artifact changes
  useEffect(() => {
    if (!artifact) {
      setViewMode('preview');
      setCurrentSlide(0);
      return;
    }

    // For code-only types, default to code view
    const codeOnlyTypes = ['code', 'jsx', 'css', 'json', 'text'];
    if (codeOnlyTypes.includes(artifact.type)) {
      setViewMode('code');
    } else {
      setViewMode('preview');
    }
    setCurrentSlide(0);
  }, [artifact?.id, artifact?.type]);

  // Handle copy to clipboard
  const handleCopy = async () => {
    if (!artifact?.content) return;
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Handle open in external app via API
  const handleOpenExternal = async () => {
    if (!artifact) return;

    if (artifact.path) {
      try {
        console.log(
          '[ArtifactPreview] Opening file with system app:',
          artifact.path
        );
        const response = await fetch(`${API_BASE_URL}/files/open`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: artifact.path }),
        });
        const result = await response.json();
        if (!result.success) {
          console.error('[ArtifactPreview] Failed to open file:', result.error);
        }
        return;
      } catch (err) {
        console.error('[ArtifactPreview] Failed to open file:', err);
      }
    }

    // Fallback for HTML content without path
    if (artifact.type === 'html' && artifact.content) {
      const blob = new Blob([artifact.content], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    }
  };

  // Check if artifact is a code file
  const isCodeFile = useMemo(() => {
    if (!artifact) return false;
    const codeTypes = ['code', 'jsx', 'css', 'json', 'text', 'markdown'];
    if (codeTypes.includes(artifact.type)) return true;
    const ext = getFileExtension(artifact.name);
    const codeExtensions = [
      'js',
      'jsx',
      'ts',
      'tsx',
      'py',
      'rb',
      'go',
      'rs',
      'java',
      'cpp',
      'c',
      'h',
      'hpp',
      'css',
      'scss',
      'less',
      'html',
      'htm',
      'json',
      'xml',
      'yaml',
      'yml',
      'md',
      'sql',
      'sh',
      'bash',
      'zsh',
      'toml',
      'ini',
      'conf',
      'env',
      'gitignore',
      'dockerfile',
      'makefile',
      'gradle',
      'swift',
      'kt',
      'scala',
      'php',
      'vue',
      'svelte',
    ];
    return codeExtensions.includes(ext);
  }, [artifact]);

  // Handle open in code editor via API
  const handleOpenInEditor = async () => {
    if (!artifact?.path) return;

    try {
      console.log('[ArtifactPreview] Opening in editor:', artifact.path);
      const response = await fetch(`${API_BASE_URL}/files/open-in-editor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: artifact.path }),
      });
      const result = await response.json();
      if (result.success) {
        console.log('[ArtifactPreview] Opened in', result.editor);
      } else {
        console.error(
          '[ArtifactPreview] Failed to open in editor:',
          result.error
        );
      }
    } catch (err) {
      console.error('[ArtifactPreview] Failed to open in editor:', err);
    }
  };

  // Generate iframe content for HTML with inlined assets
  // Only compute when in static preview mode to avoid unnecessary blob URL creation/revocation
  const shouldShowStaticPreview =
    viewMode === 'preview' && previewMode === 'static';

  const iframeSrc = useMemo(() => {
    // Only create blob URL when we need to show static preview
    if (!shouldShowStaticPreview) return null;
    if (!artifact?.content || artifact.type !== 'html') return null;

    const enhancedHtml =
      allArtifacts.length > 0
        ? inlineAssets(artifact.content, allArtifacts)
        : artifact.content;

    const blob = new Blob([enhancedHtml], { type: 'text/html' });
    return URL.createObjectURL(blob);
  }, [
    artifact?.content,
    artifact?.type,
    allArtifacts,
    shouldShowStaticPreview,
  ]);

  // Cleanup blob URL when it changes or on unmount
  useEffect(() => {
    return () => {
      if (iframeSrc) {
        URL.revokeObjectURL(iframeSrc);
      }
    };
  }, [iframeSrc]);

  // Parse CSV data
  const csvData = useMemo(() => {
    if (artifact?.type === 'csv' && artifact.content) {
      return parseCSV(artifact.content);
    }
    if (artifact?.data) {
      return artifact.data;
    }
    return null;
  }, [artifact?.type, artifact?.content, artifact?.data]);

  // Get slides for presentation
  const slides = useMemo(() => {
    if (artifact?.type === 'presentation' && artifact.slides) {
      return artifact.slides;
    }
    return null;
  }, [artifact?.type, artifact?.slides]);

  // Get open with app info
  const openWithApp = artifact ? getOpenWithApp(artifact) : null;

  // Check if preview is available
  const hasPreview = useMemo(() => {
    if (!artifact) return false;
    switch (artifact.type) {
      case 'html':
        return true;
      case 'image':
        return !!artifact.content || !!artifact.path;
      case 'markdown':
        return !!artifact.content;
      case 'csv':
        return !!csvData;
      case 'spreadsheet':
        return !!artifact.path;
      case 'presentation':
        return !!artifact.path || !!slides;
      case 'pdf':
        return !!artifact.content || !!artifact.path;
      case 'audio':
        return !!artifact.content || !!artifact.path;
      case 'video':
        return !!artifact.content || !!artifact.path;
      case 'font':
        return !!artifact.path;
      case 'document':
        return !!artifact.path;
      case 'websearch':
        return !!artifact.content;
      default:
        return false;
    }
  }, [artifact, csvData, slides]);

  // Check if code view is available
  const hasCodeView = useMemo(() => {
    if (!artifact) return false;
    if (
      ['image', 'pdf', 'document', 'spreadsheet', 'presentation'].includes(
        artifact.type
      )
    ) {
      return false;
    }
    return !!artifact.content;
  }, [artifact]);

  // Empty state
  if (!artifact) {
    return (
      <div className="bg-background flex h-full flex-col">
        <div className="border-border/50 bg-muted/30 flex shrink-0 items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-2">
            <Eye className="text-muted-foreground size-4" />
            <span className="text-muted-foreground text-sm font-medium">
              {t.task.artifacts}
            </span>
          </div>
        </div>
        <div className="bg-muted/20 flex flex-1 flex-col items-center justify-center p-8">
          <div className="flex flex-col items-center text-center">
            <div className="border-border bg-background mb-4 flex size-16 items-center justify-center rounded-xl border">
              <FileText className="text-muted-foreground/50 size-8" />
            </div>
            <h3 className="text-muted-foreground text-sm font-medium">
              {t.library.noFiles}
            </h3>
            <p className="text-muted-foreground/70 mt-1 text-xs">
              Select an artifact from the right panel to preview
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'bg-background flex h-full flex-col',
        isFullscreen && 'fixed inset-0 z-50'
      )}
    >
      {/* Header */}
      <div className="border-border/50 bg-muted/30 flex shrink-0 items-center justify-between border-b px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-foreground truncate text-sm font-medium">
            {artifact.name}
          </span>
          <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase">
            {getFileExtension(artifact.name) || artifact.type}
          </span>
        </div>

        <TooltipProvider delayDuration={300}>
          <div className="flex shrink-0 items-center gap-1">
            {openWithApp && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleOpenExternal}
                    className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
                  >
                    <ExternalLink className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{tt('preview.openInApp', { app: openWithApp.name })}</p>
                </TooltipContent>
              </Tooltip>
            )}

            {isCodeFile && artifact.path && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleOpenInEditor}
                    className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
                  >
                    <FileCode2 className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{t.preview.openInEditor}</p>
                </TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
                >
                  <Maximize2 className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>
                  {isFullscreen
                    ? t.preview.exitFullscreen
                    : t.preview.fullscreen}
                </p>
              </TooltipContent>
            </Tooltip>

            {onClose && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onClose}
                    className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
                  >
                    <X className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{t.preview.close}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </TooltipProvider>
      </div>

      {/* View mode toggle - translations handled inline */}
      {(hasCodeView || (canUseLivePreview && viewMode === 'preview')) && (
        <div className="bg-muted/20 border-border/30 flex shrink-0 items-center gap-2 border-b px-4 py-2">
          {hasPreview && hasCodeView && (
            <div className="bg-muted flex items-center gap-1 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('preview')}
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  viewMode === 'preview'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Eye className="size-3.5" />
                {t.preview.preview}
              </button>
              <button
                onClick={() => setViewMode('code')}
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  viewMode === 'code'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Code className="size-3.5" />
                {t.preview.code}
              </button>
            </div>
          )}

          {canUseLivePreview && viewMode === 'preview' && (
            <div className="bg-muted flex items-center gap-1 rounded-lg p-0.5">
              <button
                onClick={() => setPreviewMode('static')}
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  previewMode === 'static'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Eye className="size-3.5" />
                {t.preview.static}
              </button>
              <button
                onClick={() => {
                  setPreviewMode('live');
                  if (livePreviewStatus === 'idle' && onStartLivePreview) {
                    onStartLivePreview();
                  }
                }}
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  previewMode === 'live'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Radio
                  className={cn(
                    'size-3.5',
                    livePreviewStatus === 'running' && 'text-green-500'
                  )}
                />
                {t.preview.live}
                {livePreviewStatus === 'running' && (
                  <span className="size-1.5 animate-pulse rounded-full bg-green-500" />
                )}
              </button>
            </div>
          )}

          {!hasPreview && hasCodeView && (
            <div className="bg-muted text-foreground flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium">
              <Code className="size-3.5" />
              {t.preview.code}
            </div>
          )}

          {hasCodeView && viewMode === 'code' && (
            <button
              onClick={handleCopy}
              className="text-muted-foreground hover:bg-accent hover:text-foreground ml-auto flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors"
              title={t.preview.copy}
            >
              {copied ? (
                <>
                  <Check className="size-3.5 text-emerald-500" />
                  <span className="text-emerald-500">{t.preview.copied}</span>
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  <span>{t.preview.copy}</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'preview' ? (
          previewMode === 'live' && canUseLivePreview ? (
            <VitePreview
              previewUrl={livePreviewUrl || null}
              status={livePreviewStatus}
              error={livePreviewError || null}
              onStart={onStartLivePreview}
              onStop={onStopLivePreview}
            />
          ) : (
            <PreviewContent
              artifact={artifact}
              iframeSrc={iframeSrc}
              iframeRef={iframeRef}
              csvData={csvData}
              slides={slides}
              currentSlide={currentSlide}
              onSlideChange={setCurrentSlide}
            />
          )
        ) : (
          <CodePreview artifact={artifact} />
        )}
      </div>
    </div>
  );
}

// Preview content component
function PreviewContent({
  artifact,
  iframeSrc,
  iframeRef,
  csvData,
  slides,
  currentSlide,
  onSlideChange,
}: {
  artifact: Artifact;
  iframeSrc: string | null;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  csvData: string[][] | null;
  slides: string[] | null;
  currentSlide: number;
  onSlideChange: (slide: number) => void;
}) {
  // Open file in system application
  const handleOpenExternal = async () => {
    if (!artifact.path) return;
    try {
      const response = await fetch(`${API_BASE_URL}/files/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: artifact.path }),
      });
      const data = await response.json();
      if (!data.success) {
        console.error('[Preview] Failed to open file:', data.error);
      }
    } catch (err) {
      console.error('[Preview] Error opening file:', err);
    }
  };

  // File too large
  if (artifact.fileTooLarge && artifact.fileSize) {
    return (
      <FileTooLarge
        artifact={artifact}
        fileSize={artifact.fileSize}
        icon={FileText}
        onOpenExternal={handleOpenExternal}
      />
    );
  }

  // HTML Preview
  if (artifact.type === 'html' && iframeSrc) {
    return (
      <div className="h-full bg-white">
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin"
          title={artifact.name}
        />
      </div>
    );
  }

  // Image Preview
  if (artifact.type === 'image') {
    return <ImagePreview artifact={artifact} />;
  }

  // Markdown Preview
  if (artifact.type === 'markdown' && artifact.content) {
    // Parse YAML frontmatter and content
    const { frontmatter, content: markdownContent } = parseFrontmatter(
      artifact.content
    );
    return (
      <div className="bg-background h-full overflow-auto">
        <div className="max-w-none p-6">
          {/* Frontmatter Table */}
          {frontmatter && Object.keys(frontmatter).length > 0 && (
            <div className="border-border/50 mb-6 overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(frontmatter).map(([key, value]) => (
                    <tr
                      key={key}
                      className="border-border/30 border-b last:border-b-0"
                    >
                      <td className="bg-muted/30 text-muted-foreground w-32 px-4 py-2 align-top font-medium">
                        {key}
                      </td>
                      <td className="text-foreground px-4 py-2">
                        <ExpandableText text={value} maxLength={100} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Markdown Content */}
          <div className="prose prose-sm dark:prose-invert prose-h1:text-xl prose-h1:font-semibold prose-h2:text-lg prose-h2:font-semibold max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {markdownContent}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  // CSV Preview
  if (artifact.type === 'csv' && csvData) {
    return (
      <div className="bg-background h-full overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted sticky top-0">
            {csvData.length > 0 && (
              <tr>
                {csvData[0].map((cell, i) => (
                  <th
                    key={i}
                    className="border-border text-foreground border px-3 py-2 text-left font-medium"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {csvData.slice(1).map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-muted/50">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="border-border text-foreground border px-3 py-2"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Excel Preview
  if (artifact.type === 'spreadsheet' && artifact.path) {
    return <ExcelPreview artifact={artifact} />;
  }

  // PPTX Preview
  if (artifact.type === 'presentation' && artifact.path) {
    return <PptxPreview artifact={artifact} />;
  }

  // DOCX Preview
  if (artifact.type === 'document' && artifact.path) {
    return <DocxPreview artifact={artifact} />;
  }

  // Legacy presentation preview (slides from artifact.slides)
  if (artifact.type === 'presentation' && slides) {
    return (
      <div className="bg-muted/30 flex h-full flex-col overflow-hidden">
        <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
          <div className="relative aspect-[16/9] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-lg">
            {slides[currentSlide]?.startsWith('<') ? (
              <iframe
                srcDoc={slides[currentSlide]}
                className="h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin"
                title={`Slide ${currentSlide + 1}`}
              />
            ) : slides[currentSlide]?.startsWith('data:') ||
              slides[currentSlide]?.startsWith('http') ? (
              <img
                src={slides[currentSlide]}
                alt={`Slide ${currentSlide + 1}`}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center p-8">
                <div className="text-center whitespace-pre-wrap text-gray-800">
                  {slides[currentSlide]}
                </div>
              </div>
            )}
            <div className="absolute right-4 bottom-4 rounded-md bg-black/60 px-3 py-1.5 text-xs text-white">
              Page {currentSlide + 1} / {slides.length}
            </div>
          </div>
        </div>

        <div className="border-border bg-background shrink-0 border-t">
          <div className="flex gap-2 overflow-x-auto p-3">
            {slides.map((slide, index) => (
              <button
                key={index}
                onClick={() => onSlideChange(index)}
                className={cn(
                  'aspect-[16/9] w-24 shrink-0 cursor-pointer overflow-hidden rounded-md border-2 transition-all',
                  index === currentSlide
                    ? 'border-primary shadow-md'
                    : 'border-border hover:border-primary/50'
                )}
              >
                {slide.startsWith('<') ? (
                  <iframe
                    srcDoc={slide}
                    className="pointer-events-none h-full w-full origin-top-left scale-[0.2] border-0"
                    style={{ width: '500%', height: '500%' }}
                    title={`Thumbnail ${index + 1}`}
                  />
                ) : slide.startsWith('data:') || slide.startsWith('http') ? (
                  <img
                    src={slide}
                    alt={`Thumbnail ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center overflow-hidden bg-gray-100 p-1 text-[8px] text-gray-500">
                    {slide.slice(0, 50)}...
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // PDF Preview
  if (artifact.type === 'pdf') {
    return <PdfPreview artifact={artifact} />;
  }

  // Audio Preview
  if (artifact.type === 'audio') {
    return <AudioPreview artifact={artifact} />;
  }

  // Video Preview
  if (artifact.type === 'video') {
    return <VideoPreview artifact={artifact} />;
  }

  // Font Preview
  if (artifact.type === 'font') {
    return <FontPreview artifact={artifact} />;
  }

  // WebSearch Preview
  if (artifact.type === 'websearch') {
    return <WebSearchPreview artifact={artifact} />;
  }

  // Document Preview (fallback)
  if (artifact.type === 'document') {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="border-border bg-background mb-4 flex size-20 items-center justify-center rounded-xl border">
            <FileText className="size-10 text-blue-500" />
          </div>
          <h3 className="text-foreground mb-2 text-lg font-medium">
            {artifact.name}
          </h3>
          <p className="text-muted-foreground text-sm">
            Use the external link button above to open with Microsoft Word or
            other compatible applications.
          </p>
        </div>
      </div>
    );
  }

  // Default: show prompt to switch to code view
  return (
    <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
      <div className="flex flex-col items-center text-center">
        <div className="border-border bg-background mb-4 flex size-16 items-center justify-center rounded-xl border">
          <Code className="text-muted-foreground/50 size-8" />
        </div>
        <h3 className="text-muted-foreground text-sm font-medium">
          Preview not available
        </h3>
        <p className="text-muted-foreground/70 mt-1 text-xs">
          Switch to Code view to see the content
        </p>
      </div>
    </div>
  );
}
