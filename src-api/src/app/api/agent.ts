import { Hono } from 'hono';

import type { SandboxConfig } from '@/core/agent/types';
import {
  createSession,
  deleteSession,
  getPlan,
  getSession,
  runAgent,
  runExecutionPhase,
  runPlanningPhase,
} from '@/shared/services/agent';
import type { AgentRequest } from '@/shared/types/agent';

const agent = new Hono();

// Helper to create SSE stream
function createSSEStream(generator: AsyncGenerator<unknown>) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const message of generator) {
          const data = `data: ${JSON.stringify(message)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
      } catch (error) {
        const errorData = `data: ${JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        })}\n\n`;
        controller.enqueue(encoder.encode(errorData));
      } finally {
        controller.close();
      }
    },
  });
}

// SSE Response headers
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

// Phase 1: Create a plan (no execution)
agent.post('/plan', async (c) => {
  const body = await c.req.json<AgentRequest>();

  console.log('[AgentAPI] POST /plan received:', {
    hasPrompt: !!body.prompt,
    hasModelConfig: !!body.modelConfig,
    modelConfig: body.modelConfig ? {
      hasApiKey: !!body.modelConfig.apiKey,
      baseUrl: body.modelConfig.baseUrl,
      model: body.modelConfig.model,
    } : null,
  });

  if (!body.prompt) {
    return c.json({ error: 'prompt is required' }, 400);
  }

  const session = createSession('plan');
  const readable = createSSEStream(
    runPlanningPhase(body.prompt, session, body.modelConfig)
  );

  return new Response(readable, { headers: SSE_HEADERS });
});

// Phase 2: Execute an approved plan
agent.post('/execute', async (c) => {
  const body = await c.req.json<{
    planId: string;
    prompt: string;
    workDir?: string;
    taskId?: string;
    modelConfig?: { apiKey?: string; baseUrl?: string; model?: string };
    sandboxConfig?: SandboxConfig;
    skillsPath?: string;
  }>();

  console.log('[AgentAPI] POST /execute received:', {
    planId: body.planId,
    hasPrompt: !!body.prompt,
    sandboxConfig: body.sandboxConfig ? {
      enabled: body.sandboxConfig.enabled,
      provider: body.sandboxConfig.provider,
    } : null,
  });

  if (!body.planId) {
    return c.json({ error: 'planId is required' }, 400);
  }

  const plan = getPlan(body.planId);
  if (!plan) {
    return c.json({ error: 'Plan not found or expired' }, 404);
  }

  const session = createSession('execute');
  const readable = createSSEStream(
    runExecutionPhase(
      body.planId,
      session,
      body.prompt || '',
      body.workDir,
      body.taskId,
      body.modelConfig,
      body.sandboxConfig,
      body.skillsPath
    )
  );

  return new Response(readable, { headers: SSE_HEADERS });
});

// Legacy: Direct execution (plan + execute in one call)
agent.post('/', async (c) => {
  const body = await c.req.json<AgentRequest>();

  console.log('[AgentAPI] POST / received:', {
    hasPrompt: !!body.prompt,
    hasModelConfig: !!body.modelConfig,
    modelConfig: body.modelConfig ? {
      hasApiKey: !!body.modelConfig.apiKey,
      baseUrl: body.modelConfig.baseUrl,
      model: body.modelConfig.model,
    } : null,
    sandboxConfig: body.sandboxConfig ? {
      enabled: body.sandboxConfig.enabled,
      provider: body.sandboxConfig.provider,
    } : null,
  });

  if (!body.prompt) {
    return c.json({ error: 'prompt is required' }, 400);
  }

  const session = createSession();
  const readable = createSSEStream(
    runAgent(
      body.prompt,
      session,
      body.conversation,
      body.workDir,
      body.taskId,
      body.modelConfig,
      body.sandboxConfig,
      body.images,
      body.skillsPath
    )
  );

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
