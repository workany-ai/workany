import { Hono } from 'hono';

import type { SandboxConfig } from '@/core/agent/types';
import {
  createJob,
  createSession,
  deleteSession,
  getJob,
  getPlan,
  getSession,
  runAgent,
  runExecutionPhase,
  runPlanningPhase,
} from '@/shared/services/agent';
import type { AgentRequest } from '@/shared/types/agent';

const agent = new Hono();


// SSE Response headers
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

// Phase 1: Create a plan — returns { jobId, sessionId } immediately; SSE via GET /stream/:jobId
agent.post('/plan', async (c) => {
  const body = await c.req.json<AgentRequest>();

  console.log('[AgentAPI] POST /plan received:', {
    hasPrompt: !!body.prompt,
    hasModelConfig: !!body.modelConfig,
    modelConfig: body.modelConfig
      ? {
          hasApiKey: !!body.modelConfig.apiKey,
          baseUrl: body.modelConfig.baseUrl,
          model: body.modelConfig.model,
        }
      : null,
  });

  if (!body.prompt) {
    return c.json({ error: 'prompt is required' }, 400);
  }

  const session = createSession('plan');
  const generator = runPlanningPhase(body.prompt, session, body.modelConfig);

  // Create background job – generator runs asynchronously
  const jobId = createJob(generator, session.id);

  console.log('[AgentAPI] POST /plan created job:', jobId, 'sessionId:', session.id);

  // Return immediately – client polls SSE via GET /stream/:jobId
  return c.json({ jobId, sessionId: session.id });
});

// Phase 2: Execute an approved plan — returns { jobId, sessionId } immediately; SSE via GET /stream/:jobId
agent.post('/execute', async (c) => {
  const body = await c.req.json<{
    planId: string;
    prompt: string;
    workDir?: string;
    taskId?: string;
    modelConfig?: { apiKey?: string; baseUrl?: string; model?: string };
    sandboxConfig?: SandboxConfig;
    skillsConfig?: {
      enabled: boolean;
      userDirEnabled: boolean;
      appDirEnabled: boolean;
      skillsPath?: string;
    };
    mcpConfig?: {
      enabled: boolean;
      userDirEnabled: boolean;
      appDirEnabled: boolean;
      mcpConfigPath?: string;
    };
  }>();

  console.log('[AgentAPI] POST /execute received:', {
    planId: body.planId,
    hasPrompt: !!body.prompt,
    sandboxConfig: body.sandboxConfig
      ? {
          enabled: body.sandboxConfig.enabled,
          provider: body.sandboxConfig.provider,
        }
      : null,
    skillsConfig: body.skillsConfig,
    mcpConfig: body.mcpConfig,
  });

  if (!body.planId) {
    return c.json({ error: 'planId is required' }, 400);
  }

  const plan = getPlan(body.planId);
  if (!plan) {
    return c.json({ error: 'Plan not found or expired' }, 404);
  }

  const session = createSession('execute');
  const generator = runExecutionPhase(
    body.planId,
    session,
    body.prompt || '',
    body.workDir,
    body.taskId,
    body.modelConfig,
    body.sandboxConfig,
    body.skillsConfig,
    body.mcpConfig
  );

  // Create background job – generator runs asynchronously
  const jobId = createJob(generator, session.id);

  console.log('[AgentAPI] POST /execute created job:', jobId, 'sessionId:', session.id);

  // Return immediately – client polls SSE via GET /stream/:jobId
  return c.json({ jobId, sessionId: session.id });
});

// Legacy: Direct execution (plan + execute in one call)
// NOW: Returns { jobId, sessionId } immediately; SSE consumed via GET /stream/:jobId
agent.post('/', async (c) => {
  const body = await c.req.json<AgentRequest>();

  console.log('[AgentAPI] POST / received:', {
    hasPrompt: !!body.prompt,
    hasModelConfig: !!body.modelConfig,
    modelConfig: body.modelConfig
      ? {
          hasApiKey: !!body.modelConfig.apiKey,
          baseUrl: body.modelConfig.baseUrl,
          model: body.modelConfig.model,
        }
      : null,
    sandboxConfig: body.sandboxConfig
      ? {
          enabled: body.sandboxConfig.enabled,
          provider: body.sandboxConfig.provider,
        }
      : null,
    hasImages: !!body.images,
    imagesCount: body.images?.length || 0,
  });

  // Debug logging for images
  if (body.images && body.images.length > 0) {
    body.images.forEach(
      (img: { data: string; mimeType: string }, i: number) => {
        console.log(
          `[AgentAPI] Image ${i}: mimeType=${img.mimeType}, dataLength=${img.data?.length || 0}`
        );
      }
    );
  } else {
    console.log('[AgentAPI] No images in request');
  }

  if (!body.prompt) {
    return c.json({ error: 'prompt is required' }, 400);
  }

  const session = createSession();
  const generator = runAgent(
    body.prompt,
    session,
    body.conversation,
    body.workDir,
    body.taskId,
    body.modelConfig,
    body.sandboxConfig,
    body.images,
    body.skillsConfig,
    body.mcpConfig
  );

  // Create background job – generator runs asynchronously
  const jobId = createJob(generator, session.id);

  console.log('[AgentAPI] POST / created job:', jobId, 'sessionId:', session.id);

  // Return immediately – client polls SSE via GET /stream/:jobId
  return c.json({ jobId, sessionId: session.id });
});

// SSE stream for a background job
agent.get('/stream/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const job = getJob(jobId);

  if (!job) {
    return c.json({ error: 'Job not found or expired' }, 404);
  }

  const encoder = new TextEncoder();
  let cursor = 0; // Next unread index in job.buffer

  const readable = new ReadableStream({
    async start(controller) {
      const send = (msg: unknown) => {
        const data = `data: ${JSON.stringify(msg)}\n\n`;
        controller.enqueue(encoder.encode(data));
      };

      // SSE heartbeat – keeps WKWebView connection alive during Claude thinking
      // WKWebView (macOS Tauri) disconnects idle SSE connections after ~60s
      const HEARTBEAT_INTERVAL_MS = 15_000;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      const startHeartbeat = () => {
        heartbeatTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          } catch {
            // Stream may have been closed
            if (heartbeatTimer) clearInterval(heartbeatTimer);
          }
        }, HEARTBEAT_INTERVAL_MS);
      };

      const stopHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };

      startHeartbeat();

      try {
        // Stream all buffered + future messages
        while (true) {
          // Send all messages up to the current buffer length
          while (cursor < job.buffer.length) {
            send(job.buffer[cursor]);
            cursor++;
          }

          if (job.isDone) {
            // If there was an error, emit an error event
            if (job.error) {
              send({ type: 'error', message: job.error });
            }
            break;
          }

          // Wait for the next message from job.subscribers
          await new Promise<void>((resolve) => {
            job.subscribers.add(resolve);
          });
        }
      } finally {
        stopHeartbeat();
        controller.close();
      }
    },
  });

  return new Response(readable, { headers: SSE_HEADERS });
});

// Stop a running agent
agent.post('/stop/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const session = getSession(sessionId);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  deleteSession(sessionId);
  return c.json({ status: 'stopped' });
});

// Get session status
agent.get('/session/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const session = getSession(sessionId);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  return c.json({
    id: session.id,
    createdAt: session.createdAt,
    phase: session.phase,
    isAborted: session.abortController.signal.aborted,
  });
});

// Get plan by ID
agent.get('/plan/:planId', async (c) => {
  const planId = c.req.param('planId');
  const plan = getPlan(planId);

  if (!plan) {
    return c.json({ error: 'Plan not found' }, 404);
  }

  return c.json(plan);
});

export default agent;
