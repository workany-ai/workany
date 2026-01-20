import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';

import {
  agentRoutes,
  filesRoutes,
  healthRoutes,
  mcpRoutes,
  previewRoutes,
  providersRoutes,
  sandboxRoutes,
} from '@/app/api';
import { corsMiddleware } from '@/app/middleware/index.js';
import { loadConfig } from '@/config/loader.js';
import {
  initProviderManager,
  shutdownProviderManager,
} from '@/shared/provider/manager';
import { getPreviewManager } from '@/shared/services/preview';

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use('*', corsMiddleware);

// Routes
app.route('/health', healthRoutes);
app.route('/agent', agentRoutes);
app.route('/sandbox', sandboxRoutes);
app.route('/preview', previewRoutes);
app.route('/providers', providersRoutes);
app.route('/files', filesRoutes);
app.route('/mcp', mcpRoutes);

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'WorkAny API',
    version: '0.1.1',
    endpoints: {
      health: '/health',
      agent: '/agent',
      sandbox: '/sandbox',
      preview: '/preview',
      providers: '/providers',
      files: '/files',
      mcp: '/mcp',
    },
  });
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Default port: 2026 for development, 2620 for production (set via Tauri sidecar env)
const port = Number(process.env.PORT) || 2026;

// Store server instance for hot reload cleanup
let server: ServerType | null = null;

// Cleanup function
const cleanup = async () => {
  // Stop all preview servers
  try {
    const previewManager = getPreviewManager();
    await previewManager.stopAll();
  } catch (error) {
    console.error('Error stopping preview servers:', error);
  }

  // Shutdown provider manager
  try {
    await shutdownProviderManager();
  } catch (error) {
    console.error('Error shutting down provider manager:', error);
  }

  if (server) {
    server.close();
    server = null;
  }
};

// Handle hot reload - close existing server
process.on('SIGTERM', () => cleanup());
process.on('SIGINT', () => cleanup());

// For tsx watch - handle the restart signal
if (process.env.NODE_ENV !== 'production') {
  process.on('exit', () => cleanup());
}

// Initialize and start server
async function start() {
  console.log(`🚀 WorkAny API starting...`);

  // Load configuration
  await loadConfig();

  // Initialize provider manager
  await initProviderManager();

  console.log(`🚀 Server starting on http://localhost:${port}`);

  server = serve({
    fetch: app.fetch,
    port,
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

// Note: Don't export default app here, as Bun will try to auto-start it with Bun.serve()
// which conflicts with our @hono/node-server serve() call
