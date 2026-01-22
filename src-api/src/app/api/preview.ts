/**
 * Preview API Routes
 *
 * Provides HTTP endpoints for managing Vite preview servers.
 */

import { Hono } from 'hono';

import {
  getPreviewManager,
  isNodeAvailable,
  type PreviewConfig,
} from '@/shared/services/preview';

const preview = new Hono();

/**
 * Check if Node.js is available for Live Preview
 *
 * GET /preview/node-available
 * Returns: { available: boolean }
 */
preview.get('/node-available', (c) => {
  const available = isNodeAvailable();
  console.log(`[Preview API] Node.js available: ${available}`);
  return c.json({ available });
});

/**
 * Start a Vite preview server
 *
 * POST /preview/start
 * Body: { taskId: string, workDir: string, port?: number }
 */
preview.post('/start', async (c) => {
  try {
    const body = await c.req.json<PreviewConfig>();
    const { taskId, workDir, port } = body;

    if (!taskId) {
      return c.json({ error: 'taskId is required' }, 400);
    }

    if (!workDir) {
      return c.json({ error: 'workDir is required' }, 400);
    }

    console.log(`[Preview API] Starting preview for task ${taskId}`);
    console.log(`[Preview API] workDir: ${workDir}`);

    const manager = getPreviewManager();
    const status = await manager.startPreview({ taskId, workDir, port });

    return c.json(status);
  } catch (error) {
    console.error('[Preview API] Start error:', error);
    return c.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * Stop a Vite preview server
 *
 * POST /preview/stop
 * Body: { taskId: string }
 */
preview.post('/stop', async (c) => {
  try {
    const body = await c.req.json<{ taskId: string }>();
    const { taskId } = body;

    if (!taskId) {
      return c.json({ error: 'taskId is required' }, 400);
    }

    console.log(`[Preview API] Stopping preview for task ${taskId}`);

    const manager = getPreviewManager();
    const status = await manager.stopPreview(taskId);

    return c.json(status);
  } catch (error) {
    console.error('[Preview API] Stop error:', error);
    return c.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * Get status of a preview server
 *
 * GET /preview/status/:taskId
 */
preview.get('/status/:taskId', async (c) => {
  try {
    const taskId = c.req.param('taskId');

    if (!taskId) {
      return c.json({ error: 'taskId is required' }, 400);
    }

    const manager = getPreviewManager();
    const status = manager.getStatus(taskId);

    return c.json(status);
  } catch (error) {
    console.error('[Preview API] Status error:', error);
    return c.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * Stop all preview servers
 *
 * POST /preview/stop-all
 */
preview.post('/stop-all', async (c) => {
  try {
    console.log('[Preview API] Stopping all preview servers');

    const manager = getPreviewManager();
    await manager.stopAll();

    return c.json({ success: true, message: 'All preview servers stopped' });
  } catch (error) {
    console.error('[Preview API] Stop-all error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

export { preview as previewRoutes };
