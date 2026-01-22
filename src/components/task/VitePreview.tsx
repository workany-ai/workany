/**
 * VitePreview Component
 *
 * Displays a live Vite dev server preview in an iframe with HMR support.
 * Includes controls for refresh, open in new tab, and stop server.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PreviewStatus } from '@/shared/hooks/useVitePreview';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  AlertCircle,
  ExternalLink,
  Loader2,
  Maximize2,
  Play,
  RefreshCw,
  Square,
  X,
} from 'lucide-react';

interface VitePreviewProps {
  previewUrl: string | null;
  status: PreviewStatus;
  error: string | null;
  onStart?: () => void;
  onStop?: () => void;
  onClose?: () => void;
  className?: string;
}

export function VitePreview({
  previewUrl,
  status,
  error,
  onStart,
  onStop,
  onClose,
  className,
}: VitePreviewProps) {
  const { t } = useLanguage();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  // Handle iframe refresh
  const handleRefresh = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  // Handle open in new tab (use Tauri opener plugin)
  const handleOpenExternal = useCallback(async () => {
    if (previewUrl) {
      try {
        await openUrl(previewUrl);
      } catch {
        // Fallback to window.open if Tauri plugin fails
        window.open(previewUrl, '_blank');
      }
    }
  }, [previewUrl]);

  // Handle keyboard shortcut for refresh
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + R to refresh
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        handleRefresh();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRefresh]);

  // Render loading state
  if (status === 'starting') {
    return (
      <div
        className={cn(
          'bg-background flex h-full flex-col',
          isFullscreen && 'fixed inset-0 z-50',
          className
        )}
      >
        <PreviewHeader
          url={null}
          status={status}
          onRefresh={handleRefresh}
          onOpenExternal={handleOpenExternal}
          onStop={onStop}
          onClose={onClose}
          onFullscreen={() => setIsFullscreen(!isFullscreen)}
          isFullscreen={isFullscreen}
        />
        <div className="bg-muted/20 flex flex-1 flex-col items-center justify-center p-8">
          <Loader2 className="text-primary mb-4 size-8 animate-spin" />
          <h3 className="text-foreground mb-1 text-sm font-medium">
            {t.preview.startingServer}
          </h3>
          <p className="text-muted-foreground mb-2 max-w-xs text-center text-xs">
            {t.preview.installingDeps}
          </p>
          <p className="text-muted-foreground/70 max-w-xs text-center text-xs">
            {t.preview.firstRunHint}
          </p>
        </div>
      </div>
    );
  }

  // Render error state
  if (status === 'error' && error) {
    return (
      <div
        className={cn(
          'bg-background flex h-full flex-col',
          isFullscreen && 'fixed inset-0 z-50',
          className
        )}
      >
        <PreviewHeader
          url={null}
          status={status}
          onRefresh={handleRefresh}
          onOpenExternal={handleOpenExternal}
          onStop={onStop}
          onClose={onClose}
          onFullscreen={() => setIsFullscreen(!isFullscreen)}
          isFullscreen={isFullscreen}
        />
        <div className="bg-muted/20 flex flex-1 flex-col items-center justify-center p-8">
          <div className="mb-4 flex size-16 items-center justify-center rounded-xl border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
            <AlertCircle className="size-8 text-red-500" />
          </div>
          <h3 className="text-foreground mb-2 text-sm font-medium">
            {t.preview.previewError}
          </h3>
          <p className="text-muted-foreground mb-4 max-w-md text-center text-xs">
            {error}
          </p>
          {onStart && (
            <button
              onClick={onStart}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              <Play className="size-4" />
              {t.preview.retry}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Render idle state (no preview running)
  if (status === 'idle' || !previewUrl) {
    return (
      <div
        className={cn(
          'bg-background flex h-full flex-col',
          isFullscreen && 'fixed inset-0 z-50',
          className
        )}
      >
        <PreviewHeader
          url={null}
          status={status}
          onRefresh={handleRefresh}
          onOpenExternal={handleOpenExternal}
          onStop={onStop}
          onClose={onClose}
          onFullscreen={() => setIsFullscreen(!isFullscreen)}
          isFullscreen={isFullscreen}
        />
        <div className="bg-muted/20 flex flex-1 flex-col items-center justify-center p-8">
          <div className="border-border bg-background mb-4 flex size-16 items-center justify-center rounded-xl border">
            <Play className="text-muted-foreground/50 size-8" />
          </div>
          <h3 className="text-foreground mb-1 text-sm font-medium">
            {t.preview.livePreview}
          </h3>
          <p className="text-muted-foreground mb-4 max-w-xs text-center text-xs">
            {t.preview.livePreviewHint}
          </p>
          {onStart && (
            <button
              onClick={onStart}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              <Play className="size-4" />
              {t.preview.startPreview}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Render running preview
  return (
    <div
      className={cn(
        'bg-background flex h-full flex-col',
        isFullscreen && 'fixed inset-0 z-50',
        className
      )}
    >
      <PreviewHeader
        url={previewUrl}
        status={status}
        onRefresh={handleRefresh}
        onOpenExternal={handleOpenExternal}
        onStop={onStop}
        onClose={onClose}
        onFullscreen={() => setIsFullscreen(!isFullscreen)}
        isFullscreen={isFullscreen}
      />
      <div className="flex-1 overflow-hidden bg-white">
        <iframe
          key={iframeKey}
          ref={iframeRef}
          src={previewUrl}
          className="h-full w-full border-0"
          title={t.preview.livePreview}
        />
      </div>
    </div>
  );
}

// Header component for the preview
interface PreviewHeaderProps {
  url: string | null;
  status: PreviewStatus;
  onRefresh: () => void;
  onOpenExternal: () => void;
  onStop?: () => void;
  onClose?: () => void;
  onFullscreen: () => void;
  isFullscreen: boolean;
}

function PreviewHeader({
  url,
  status,
  onRefresh,
  onOpenExternal,
  onStop,
  onClose,
  onFullscreen,
  isFullscreen,
}: PreviewHeaderProps) {
  const { t } = useLanguage();

  return (
    <div className="border-border/50 bg-muted/30 flex shrink-0 items-center justify-between border-b px-4 py-2">
      {/* Left: Status and URL */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Status indicator */}
        <div
          className={cn(
            'size-2 shrink-0 rounded-full',
            status === 'running' && 'bg-green-500',
            status === 'starting' && 'animate-pulse bg-yellow-500',
            status === 'error' && 'bg-red-500',
            (status === 'idle' || status === 'stopped') && 'bg-gray-400'
          )}
        />
        <span className="text-muted-foreground shrink-0 text-xs font-medium">
          {t.preview.livePreview}
        </span>
        {url && (
          <>
            <span className="text-muted-foreground/50">|</span>
            <span className="text-muted-foreground truncate text-xs">
              {url}
            </span>
          </>
        )}
      </div>

      {/* Right: Action buttons */}
      <div className="flex shrink-0 items-center gap-1">
        {/* Refresh */}
        {status === 'running' && (
          <button
            onClick={onRefresh}
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
            title={t.preview.refreshHint}
          >
            <RefreshCw className="size-4" />
          </button>
        )}

        {/* Open external */}
        {url && (
          <button
            onClick={onOpenExternal}
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
            title={t.preview.openInNewTab}
          >
            <ExternalLink className="size-4" />
          </button>
        )}

        {/* Fullscreen */}
        <button
          onClick={onFullscreen}
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
          title={isFullscreen ? t.preview.exitFullscreen : t.preview.fullscreen}
        >
          <Maximize2 className="size-4" />
        </button>

        {/* Stop server */}
        {status === 'running' && onStop && (
          <button
            onClick={onStop}
            className="text-muted-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950"
            title={t.preview.stopServer}
          >
            <Square className="size-4" />
          </button>
        )}

        {/* Close */}
        {onClose && (
          <button
            onClick={onClose}
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors"
            title={t.preview.close}
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
