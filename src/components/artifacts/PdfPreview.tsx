import { useEffect, useState } from 'react';
import { readFile, stat } from '@tauri-apps/plugin-fs';
import { FileText, Loader2 } from 'lucide-react';

import { FileTooLarge } from './FileTooLarge';
import type { PreviewComponentProps } from './types';
import { isRemoteUrl, MAX_PREVIEW_SIZE, openFileExternal } from './utils';

export function PdfPreview({ artifact }: PreviewComponentProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileTooLarge, setFileTooLarge] = useState<number | null>(null);

  const handleOpenExternal = () => {
    if (artifact.path) {
      openFileExternal(artifact.path);
    }
  };

  useEffect(() => {
    let blobUrl: string | null = null;

    async function loadPdf() {
      if (!artifact.path) {
        setError('No PDF file path available');
        setLoading(false);
        return;
      }

      console.log('[PDF Preview] Loading PDF from path:', artifact.path);

      try {
        // Check file size first for local files
        if (!isRemoteUrl(artifact.path)) {
          const fileInfo = await stat(artifact.path);
          if (fileInfo.size > MAX_PREVIEW_SIZE) {
            console.log('[PDF Preview] File too large:', fileInfo.size);
            setFileTooLarge(fileInfo.size);
            setLoading(false);
            return;
          }
        }

        let blob: Blob;

        if (isRemoteUrl(artifact.path)) {
          // Remote URL - fetch the PDF
          console.log('[PDF Preview] Fetching remote PDF...');
          const url = artifact.path.startsWith('//')
            ? `https:${artifact.path}`
            : artifact.path;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(
              `Failed to fetch PDF: ${response.status} ${response.statusText}`
            );
          }
          blob = await response.blob();
        } else {
          // Local file - use Tauri fs plugin
          console.log('[PDF Preview] Reading local PDF file...');
          const data = await readFile(artifact.path);
          blob = new Blob([data], { type: 'application/pdf' });
        }

        console.log('[PDF Preview] Loaded', blob.size, 'bytes');
        blobUrl = URL.createObjectURL(blob);
        setPdfUrl(blobUrl);
        setError(null);
      } catch (err) {
        console.error('[PDF Preview] Failed to load PDF:', err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
      } finally {
        setLoading(false);
      }
    }

    loadPdf();

    // Cleanup blob URL on unmount
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [artifact.path]);

  if (loading) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
        <p className="text-muted-foreground mt-4 text-sm">Loading PDF...</p>
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

  if (error || !pdfUrl) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="border-border bg-background mb-4 flex size-20 items-center justify-center rounded-xl border">
            <FileText className="size-10 text-red-500" />
          </div>
          <h3 className="text-foreground mb-2 text-lg font-medium">
            {artifact.name}
          </h3>
          <p className="text-muted-foreground text-sm break-all whitespace-pre-wrap">
            {error || 'No PDF file path available'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-muted/20 h-full">
      <iframe
        src={pdfUrl}
        className="h-full w-full border-0"
        title={artifact.name}
      />
    </div>
  );
}
