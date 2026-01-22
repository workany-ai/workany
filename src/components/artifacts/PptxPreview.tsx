import { useEffect, useState } from 'react';
import { cn } from '@/shared/lib/utils';
import { readFile, stat } from '@tauri-apps/plugin-fs';
import JSZip from 'jszip';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Presentation,
} from 'lucide-react';

import { FileTooLarge } from './FileTooLarge';
import type { PptxSlide, PreviewComponentProps } from './types';
import { isRemoteUrl, MAX_PREVIEW_SIZE, openFileExternal } from './utils';

export function PptxPreview({ artifact }: PreviewComponentProps) {
  const [slides, setSlides] = useState<PptxSlide[]>([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileTooLarge, setFileTooLarge] = useState<number | null>(null);

  const handleOpenExternal = () => {
    if (artifact.path) {
      openFileExternal(artifact.path);
    }
  };

  useEffect(() => {
    const blobUrls: string[] = [];

    async function loadPptx() {
      if (!artifact.path) {
        setError('No PPTX file path available');
        setLoading(false);
        return;
      }

      console.log('[PPTX Preview] Loading PPTX from path:', artifact.path);

      try {
        // Check file size first
        if (!isRemoteUrl(artifact.path)) {
          const fileInfo = await stat(artifact.path);
          if (fileInfo.size > MAX_PREVIEW_SIZE) {
            console.log('[PPTX Preview] File too large:', fileInfo.size);
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
              `Failed to fetch PPTX: ${response.status} ${response.statusText}`
            );
          }
          arrayBuffer = await response.arrayBuffer();
        } else {
          const data = await readFile(artifact.path);
          arrayBuffer = data.buffer;
        }

        console.log('[PPTX Preview] Loaded', arrayBuffer.byteLength, 'bytes');

        // Parse PPTX using JSZip
        const zip = await JSZip.loadAsync(arrayBuffer);

        // Extract images from ppt/media/
        const newImageUrls = new Map<string, string>();
        const mediaFiles = Object.keys(zip.files).filter((name) =>
          name.startsWith('ppt/media/')
        );
        for (const mediaPath of mediaFiles) {
          const file = zip.files[mediaPath];
          if (!file.dir) {
            const blob = await file.async('blob');
            const url = URL.createObjectURL(blob);
            blobUrls.push(url);
            const fileName = mediaPath.split('/').pop() || '';
            newImageUrls.set(fileName, url);
          }
        }

        // Get slide count from presentation.xml
        const presentationXml = await zip
          .file('ppt/presentation.xml')
          ?.async('string');
        if (!presentationXml) {
          throw new Error('Invalid PPTX: missing presentation.xml');
        }

        // Parse slides
        const parsedSlides: PptxSlide[] = [];
        let slideIndex = 1;

        while (true) {
          const slideFile = zip.file(`ppt/slides/slide${slideIndex}.xml`);
          if (!slideFile) break;

          const slideXml = await slideFile.async('string');

          // Parse slide content
          const parser = new DOMParser();
          const doc = parser.parseFromString(slideXml, 'text/xml');

          // Extract text content
          const textElements = doc.querySelectorAll('a\\:t, t');
          const textContent: string[] = [];
          let title = '';

          textElements.forEach((el, idx) => {
            const text = el.textContent?.trim();
            if (text) {
              if (idx === 0 && !title) {
                title = text;
              } else {
                textContent.push(text);
              }
            }
          });

          // Try to find image reference for this slide
          const relsFile = zip.file(
            `ppt/slides/_rels/slide${slideIndex}.xml.rels`
          );
          let slideImageUrl: string | undefined;

          if (relsFile) {
            const relsXml = await relsFile.async('string');
            const relsDoc = parser.parseFromString(relsXml, 'text/xml');
            const relationships = relsDoc.querySelectorAll('Relationship');

            relationships.forEach((rel) => {
              const type = rel.getAttribute('Type') || '';
              const target = rel.getAttribute('Target') || '';

              if (type.includes('image') && target.includes('media/')) {
                const imageName = target.split('/').pop() || '';
                if (newImageUrls.has(imageName)) {
                  slideImageUrl = newImageUrls.get(imageName);
                }
              }
            });
          }

          parsedSlides.push({
            index: slideIndex,
            title: title || `Slide ${slideIndex}`,
            content: textContent,
            imageUrl: slideImageUrl,
          });

          slideIndex++;
        }

        if (parsedSlides.length === 0) {
          throw new Error('No slides found in PPTX file');
        }

        console.log('[PPTX Preview] Parsed', parsedSlides.length, 'slides');
        setSlides(parsedSlides);
        setError(null);
      } catch (err) {
        console.error('[PPTX Preview] Failed to load PPTX:', err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
      } finally {
        setLoading(false);
      }
    }

    loadPptx();

    // Cleanup blob URLs on unmount
    return () => {
      blobUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [artifact.path]);

  // Navigate slides
  const goToPrev = () => {
    if (currentSlide > 0) setCurrentSlide(currentSlide - 1);
  };

  const goToNext = () => {
    if (currentSlide < slides.length - 1) setCurrentSlide(currentSlide + 1);
  };

  if (loading) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
        <p className="text-muted-foreground mt-4 text-sm">
          Loading presentation...
        </p>
      </div>
    );
  }

  if (fileTooLarge !== null) {
    return (
      <FileTooLarge
        artifact={artifact}
        fileSize={fileTooLarge}
        icon={Presentation}
        onOpenExternal={handleOpenExternal}
      />
    );
  }

  if (error || slides.length === 0) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="border-border bg-background mb-4 flex size-20 items-center justify-center rounded-xl border">
            <Presentation className="size-10 text-orange-500" />
          </div>
          <h3 className="text-foreground mb-2 text-lg font-medium">
            {artifact.name}
          </h3>
          <p className="text-muted-foreground mb-4 text-sm break-all whitespace-pre-wrap">
            {error || 'No slides available'}
          </p>
          <button
            onClick={handleOpenExternal}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <ExternalLink className="size-4" />
            Open in PowerPoint
          </button>
        </div>
      </div>
    );
  }

  const slide = slides[currentSlide];

  return (
    <div className="bg-muted/30 flex h-full flex-col">
      {/* Slide display */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
        {/* Navigation buttons */}
        <button
          onClick={goToPrev}
          disabled={currentSlide === 0}
          className={cn(
            'absolute left-4 z-10 flex size-10 items-center justify-center rounded-full transition-all',
            'bg-background/80 hover:bg-background shadow-lg',
            'disabled:cursor-not-allowed disabled:opacity-30'
          )}
        >
          <ChevronLeft className="text-foreground size-5" />
        </button>

        <button
          onClick={goToNext}
          disabled={currentSlide === slides.length - 1}
          className={cn(
            'absolute right-4 z-10 flex size-10 items-center justify-center rounded-full transition-all',
            'bg-background/80 hover:bg-background shadow-lg',
            'disabled:cursor-not-allowed disabled:opacity-30'
          )}
        >
          <ChevronRight className="text-foreground size-5" />
        </button>

        {/* Slide content */}
        <div className="bg-background relative aspect-[16/9] w-full max-w-4xl overflow-hidden rounded-lg shadow-xl">
          {slide.imageUrl ? (
            // Slide with image
            <div className="relative h-full w-full">
              <img
                src={slide.imageUrl}
                alt={slide.title}
                className="h-full w-full object-contain"
              />
              {/* Overlay text if present */}
              {(slide.title || slide.content.length > 0) && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-6">
                  {slide.title && (
                    <h2 className="mb-2 text-xl font-bold text-white">
                      {slide.title}
                    </h2>
                  )}
                </div>
              )}
            </div>
          ) : (
            // Text-only slide
            <div className="flex h-full w-full flex-col p-8">
              {slide.title && (
                <h2 className="text-foreground mb-6 text-2xl font-bold">
                  {slide.title}
                </h2>
              )}
              <div className="flex-1 overflow-auto">
                {slide.content.map((text, idx) => (
                  <p key={idx} className="text-foreground/80 mb-3 text-base">
                    {text}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Page indicator */}
          <div className="text-muted-foreground bg-muted/80 absolute right-4 bottom-4 rounded-md px-3 py-1.5 text-xs">
            {currentSlide + 1} / {slides.length}
          </div>
        </div>
      </div>

      {/* Thumbnail strip */}
      <div className="border-border bg-background shrink-0 border-t">
        <div className="flex gap-2 overflow-x-auto p-3">
          {slides.map((s, index) => (
            <button
              key={index}
              onClick={() => setCurrentSlide(index)}
              className={cn(
                'aspect-[16/9] w-24 shrink-0 cursor-pointer overflow-hidden rounded-md border-2 transition-all',
                index === currentSlide
                  ? 'border-primary shadow-md'
                  : 'border-border hover:border-primary/50'
              )}
            >
              {s.imageUrl ? (
                <img
                  src={s.imageUrl}
                  alt={s.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="bg-muted/50 flex h-full w-full flex-col items-start justify-start p-1.5">
                  <span className="text-foreground line-clamp-2 text-[8px] font-medium">
                    {s.title}
                  </span>
                  {s.content.length > 0 && (
                    <span className="text-muted-foreground mt-0.5 line-clamp-2 text-[6px]">
                      {s.content[0]}
                    </span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
