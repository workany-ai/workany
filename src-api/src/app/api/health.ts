import { Hono } from 'hono';

const health = new Hono();

health.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * Dependencies check endpoint
 * Now that we use @codeany/open-agent-sdk (in-process), no external CLI is required.
 * This endpoint returns success immediately for backward compatibility.
 */
health.get('/dependencies', async (c) => {
  return c.json({
    success: true,
    allRequiredInstalled: true,
    claudeCode: true, // No longer needed, always pass
    dependencies: [],
  });
});

health.get('/dependencies/:id', async (c) => {
  return c.json({
    success: true,
    installed: true,
    message: 'No external CLI dependencies required. Agent runs in-process via @codeany/open-agent-sdk.',
  });
});

health.get('/dependencies/:id/install-commands', (c) => {
  return c.json({
    success: true,
    commands: {},
    message: 'No installation needed. Agent runs in-process.',
  });
});

health.post('/dependencies/:id/install', async (c) => {
  return c.json({
    success: true,
    installed: true,
    message: 'No installation needed. Agent runs in-process.',
  });
});

export default health;
