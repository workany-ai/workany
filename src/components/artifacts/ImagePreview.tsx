import { useEffect, useState } from 'react';
import { readFile, stat } from '@tauri-apps/plugin-fs';
import { Eye, FileText, Loader2 } from 'lucide-react';

import { FileTooLarge } from './FileTooLarge';
import type { PreviewComponentProps } from './types';
import {
  getImageMimeType,
  isRemoteUrl,
  MAX_PREVIEW_SIZE,
  openFileExternal,
} from './utils';

export function ImagePreview({ artifact }: PreviewComponentProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
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

    async function loadImage() {
      // If content is already a data URL or base64, use it directly
      if (
        artifact.content &&
        (artifact.content.startsWith('data:') ||
          artifact.content.startsWith('http'))
      ) {
        setImageUrl(artifact.content);
        setLoading(false);
        return;
      }

      if (!artifact.path) {
        setError('No image file path available');
        setLoading(false);
        return;
      }

      console.log('[Image Preview] Loading image from path:', artifact.path);

      try {
        // Check file size first for local files
        if (!isRemoteUrl(artifact.path)) {
          const fileInfo = await stat(artifact.path);
          if (fileInfo.size > MAX_PREVIEW_SIZE) {
            console.log('[Image Preview] File too large:', fileInfo.size);
            setFileTooLarge(fileInfo.size);
            setLoading(false);
            return;
          }
        }

        // Determine MIME type from extension
        const ext = artifact.path.split('.').pop()?.toLowerCase() || '';
        const mimeType = getImageMimeType(ext);

        let blob: Blob;

        if (isRemoteUrl(artifact.path)) {
          // Remote URL - fetch the image
          console.log('[Image Preview] Fetching remote image...');
          const url = artifact.path.startsWith('//')
            ? `https:${artifact.path}`
            : artifact.path;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(
              `Failed to fetch image: ${response.status} ${response.statusText}`
            );
          }
          blob = await response.blob();
        } else {
          // Local file - use Tauri fs plugin
          console.log('[Image Preview] Reading local image file...');
          const data = await readFile(artifact.path);
          blob = new Blob([data], { type: mimeType });
        }

        console.log('[Image Preview] Loaded', blob.size, 'bytes');
        blobUrl = URL.createObjectURL(blob);
        setImageUrl(blobUrl);
        setError(null);
      } catch (err) {
        console.error('[Image Preview] Failed to load image:', err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
      } finally {
        setLoading(false);
      }
    }

    loadImage();

    // Cleanup blob URL on unmount
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [artifact.path, artifact.content]);

  if (loading) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <Loader2 className="text-muted-foreground size-8 animate-spin" />
        <p className="text-muted-foreground mt-4 text-sm">Loading image...</p>
      </div>
    );
  }

  if (fileTooLarge !== null) {
    return (
      <FileTooLarge
        artifact={artifact}
        fileSize={fileTooLarge}
        icon={Eye}
        onOpenExternal={handleOpenExternal}
      />
    );
  }

  if (error || !imageUrl) {
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
            {error || 'No image file path available'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-muted/20 flex h-full items-center justify-center p-4">
      <img
        src={imageUrl}
        alt={artifact.name}
        className="max-h-full max-w-full rounded-lg object-contain shadow-sm"
      />
    </div>
  );
}
