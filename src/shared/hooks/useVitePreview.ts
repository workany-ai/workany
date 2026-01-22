/**
 * useVitePreview Hook
 *
 * Manages the lifecycle of a Vite preview server for live preview functionality.
 * Provides start/stop controls and status monitoring.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/config';

const AGENT_SERVER_URL = API_BASE_URL;

export type PreviewStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'error'
  | 'stopped';

export interface PreviewState {
  previewUrl: string | null;
  status: PreviewStatus;
  error: string | null;
  hostPort: number | null;
}

export interface UseVitePreviewReturn extends PreviewState {
  startPreview: (workDir: string) => Promise<void>;
  stopPreview: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

interface PreviewApiResponse {
  id: string;
  taskId: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  url?: string;
  hostPort?: number;
  error?: string;
}

const POLL_INTERVAL_MS = 2000; // Poll every 2 seconds while starting

export function useVitePreview(taskId: string | null): UseVitePreviewReturn {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<PreviewStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hostPort, setHostPort] = useState<number | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const taskIdRef = useRef<string | null>(taskId);

  // Update taskIdRef when taskId changes
  useEffect(() => {
    taskIdRef.current = taskId;
  }, [taskId]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  // Reset state when taskId changes
  useEffect(() => {
    if (taskId) {
      // Check if there's an existing preview for this task
      refreshStatus();
    } else {
      setPreviewUrl(null);
      setStatus('idle');
      setError(null);
      setHostPort(null);
    }
  }, [taskId]);

  /**
   * Fetch current status from the server
   */
  const refreshStatus = useCallback(async () => {
    if (!taskIdRef.current) return;

    try {
      const response = await fetch(
        `${AGENT_SERVER_URL}/preview/status/${taskIdRef.current}`
      );

      if (!response.ok) {
        throw new Error(`Failed to get status: ${response.statusText}`);
      }

      const data: PreviewApiResponse = await response.json();
      updateStateFromResponse(data);
    } catch (err) {
      console.error('[useVitePreview] Error fetching status:', err);
    }
  }, []);

  /**
   * Update local state from API response
   */
  const updateStateFromResponse = useCallback((data: PreviewApiResponse) => {
    setStatus(data.status === 'stopped' ? 'idle' : data.status);
    setPreviewUrl(data.url || null);
    setHostPort(data.hostPort || null);
    setError(data.error || null);

    // Stop polling if no longer starting
    if (data.status !== 'starting' && pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  /**
   * Start the Vite preview server
   */
  const startPreview = useCallback(
    async (workDir: string) => {
      if (!taskIdRef.current) {
        setError('No task ID provided');
        setStatus('error');
        return;
      }

      // Clear any existing polling
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }

      setStatus('starting');
      setError(null);

      try {
        console.log(
          '[useVitePreview] Starting preview for:',
          taskIdRef.current
        );
        console.log('[useVitePreview] workDir:', workDir);

        const response = await fetch(`${AGENT_SERVER_URL}/preview/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            taskId: taskIdRef.current,
            workDir,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.error || `Failed to start preview: ${response.statusText}`
          );
        }

        const data: PreviewApiResponse = await response.json();
        console.log('[useVitePreview] Start response:', data);

        updateStateFromResponse(data);

        // If still starting, poll for status updates
        if (data.status === 'starting') {
          pollIntervalRef.current = setInterval(async () => {
            if (!taskIdRef.current) return;

            try {
              const statusResponse = await fetch(
                `${AGENT_SERVER_URL}/preview/status/${taskIdRef.current}`
              );

              if (statusResponse.ok) {
                const statusData: PreviewApiResponse =
                  await statusResponse.json();
                updateStateFromResponse(statusData);
              }
            } catch (err) {
              console.error('[useVitePreview] Polling error:', err);
            }
          }, POLL_INTERVAL_MS);
        }
      } catch (err) {
        console.error('[useVitePreview] Start error:', err);
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [updateStateFromResponse]
  );

  /**
   * Stop the Vite preview server
   */
  const stopPreview = useCallback(async () => {
    if (!taskIdRef.current) return;

    // Clear any existing polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    try {
      console.log('[useVitePreview] Stopping preview for:', taskIdRef.current);

      const response = await fetch(`${AGENT_SERVER_URL}/preview/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId: taskIdRef.current,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Failed to stop preview: ${response.statusText}`
        );
      }

      setStatus('idle');
      setPreviewUrl(null);
      setHostPort(null);
      setError(null);
    } catch (err) {
      console.error('[useVitePreview] Stop error:', err);
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return {
    previewUrl,
    status,
    error,
    hostPort,
    startPreview,
    stopPreview,
    refreshStatus,
  };
}
