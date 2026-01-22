import { useEffect, useRef, useState } from 'react';
import { cn } from '@/shared/lib/utils';
import { readFile } from '@tauri-apps/plugin-fs';
import { Loader2, Music, Pause, Play } from 'lucide-react';

import type { PreviewComponentProps } from './types';
import { getAudioMimeType, isRemoteUrl } from './utils';

export function AudioPreview({ artifact }: PreviewComponentProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let blobUrl: string | null = null;

    async function loadAudio() {
      // If content is already a data URL or http URL, use it directly
      if (
        artifact.content &&
        (artifact.content.startsWith('data:') ||
          artifact.content.startsWith('http'))
      ) {
        setAudioUrl(artifact.content);
        setLoading(false);
        return;
      }

      if (!artifact.path) {
        setError('No audio file path available');
        setLoading(false);
        return;
      }

      console.log('[Audio Preview] Loading audio from path:', artifact.path);

      try {
        if (isRemoteUrl(artifact.path)) {
          // Remote URL - use directly
          const url = artifact.path.startsWith('//')
            ? `https:${artifact.path}`
            : artifact.path;
          setAudioUrl(url);
        } else {
          // Local file - read as blob using Tauri fs plugin
          console.log('[Audio Preview] Reading local audio file...');

          const ext = artifact.path.split('.').pop()?.toLowerCase() || '';
          const mimeType = getAudioMimeType(ext);

          const data = await readFile(artifact.path);
          const blob = new Blob([data], { type: mimeType });
          console.log('[Audio Preview] Loaded', blob.size, 'bytes');

          blobUrl = URL.createObjectURL(blob);
          setAudioUrl(blobUrl);
        }
        setError(null);
      } catch (err) {
        console.error('[Audio Preview] Failed to load audio:', err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
      } finally {
        setLoading(false);
      }
    }

    loadAudio();

    // Cleanup blob URL on unmount
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [artifact.path, artifact.content]);

  // Handle play/pause
  const togglePlayPause = async () => {
    if (!audioRef.current) {
      console.log('[Audio Preview] No audio ref');
      return;
    }
    try {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        await audioRef.current.play();
      }
    } catch (err) {
      console.error('[Audio Preview] Play error:', err);
      setError(
        `Failed to play: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  // Handle time update
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  // Handle loaded metadata
  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      console.log(
        '[Audio Preview] Loaded, duration:',
        audioRef.current.duration
      );
    }
  };

  // Handle audio error
  const handleAudioError = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.currentTarget;
    const errorCode = audio.error?.code;
    const errorMessage = audio.error?.message || 'Unknown error';
    console.error('[Audio Preview] Audio error:', errorCode, errorMessage);
    setError(`Audio error: ${errorMessage}`);
  };

  // Skip forward/backward
  const skip = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(
        0,
        Math.min(duration, audioRef.current.currentTime + seconds)
      );
    }
  };

  // Format time
  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Progress percentage
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (loading) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <div className="relative mb-8">
          <div className="bg-primary flex size-44 items-center justify-center rounded-2xl shadow-xl">
            <Music className="text-primary-foreground size-16 opacity-80" />
          </div>
        </div>
        <h3 className="text-foreground mb-2 max-w-md truncate text-center text-lg font-semibold">
          {artifact.name.replace(/\.[^/.]+$/, '')}
        </h3>
        <div className="text-muted-foreground mt-4 flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Loading audio...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="mb-4 flex size-20 items-center justify-center rounded-full bg-red-500/10">
            <Music className="size-10 text-red-500" />
          </div>
          <h3 className="text-foreground mb-2 text-lg font-medium">
            {artifact.name}
          </h3>
          <p className="text-muted-foreground text-sm break-all whitespace-pre-wrap">
            {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
      {/* Album art */}
      <div className="relative mb-8">
        <div
          className={cn(
            'bg-primary flex size-44 items-center justify-center rounded-2xl shadow-xl transition-transform duration-300',
            isPlaying && 'scale-105'
          )}
        >
          <Music className="text-primary-foreground size-16 opacity-80" />
        </div>
        {isPlaying && (
          <div className="bg-primary/20 absolute -inset-2 -z-10 animate-pulse rounded-2xl blur-xl" />
        )}
      </div>

      {/* File name */}
      <h3 className="text-foreground mb-1 max-w-md truncate text-center text-lg font-semibold">
        {artifact.name.replace(/\.[^/.]+$/, '')}
      </h3>
      <p className="text-muted-foreground mb-6 text-xs">
        {artifact.name.split('.').pop()?.toUpperCase()} Audio
      </p>

      {/* Audio element */}
      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onError={handleAudioError}
      />

      {/* Player controls */}
      <div className="w-full max-w-sm">
        {/* Progress bar */}
        <div className="mb-6">
          <div
            className="bg-muted relative h-1.5 w-full cursor-pointer rounded-full"
            onClick={(e) => {
              if (!audioRef.current || !duration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const percent = (e.clientX - rect.left) / rect.width;
              audioRef.current.currentTime = percent * duration;
            }}
          >
            <div
              className="bg-primary absolute top-0 left-0 h-full rounded-full transition-all duration-150"
              style={{ width: `${progress}%` }}
            />
            <div
              className="bg-foreground absolute top-1/2 size-3 -translate-y-1/2 rounded-full shadow-lg transition-all duration-150"
              style={{ left: `calc(${progress}% - 6px)` }}
            />
          </div>
          <div className="text-muted-foreground mt-2 flex justify-between text-xs">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Control buttons */}
        <div className="flex items-center justify-center gap-6">
          {/* Rewind */}
          <button
            onClick={() => skip(-10)}
            className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-10 items-center justify-center rounded-full transition-colors"
            title="Rewind 10s"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.5 3C17.15 3 21.08 6.03 22.47 10.22L20.1 11C19.05 7.81 16.04 5.5 12.5 5.5C10.54 5.5 8.77 6.22 7.38 7.38L10 10H3V3L5.6 5.6C7.45 4 9.85 3 12.5 3M10 12V22H8V14H6V12H10M18 14V20C18 21.11 17.11 22 16 22H14C12.9 22 12 21.1 12 20V14C12 12.9 12.9 12 14 12H16C17.11 12 18 12.9 18 14M14 14V20H16V14H14Z" />
            </svg>
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlayPause}
            disabled={!audioUrl}
            className={cn(
              'flex size-14 items-center justify-center rounded-full shadow-lg transition-all',
              'bg-primary text-primary-foreground',
              'hover:bg-primary/90 hover:scale-105',
              'active:scale-95',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {isPlaying ? (
              <Pause className="size-6" />
            ) : (
              <Play className="ml-0.5 size-6" />
            )}
          </button>

          {/* Forward */}
          <button
            onClick={() => skip(10)}
            className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-10 items-center justify-center rounded-full transition-colors"
            title="Forward 10s"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.5 3C6.85 3 2.92 6.03 1.53 10.22L3.9 11C4.95 7.81 7.96 5.5 11.5 5.5C13.46 5.5 15.23 6.22 16.62 7.38L14 10H21V3L18.4 5.6C16.55 4 14.15 3 11.5 3M10 12V22H8V14H6V12H10M18 14V20C18 21.11 17.11 22 16 22H14C12.9 22 12 21.1 12 20V14C12 12.9 12.9 12 14 12H16C17.11 12 18 12.9 18 14M14 14V20H16V14H14Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
