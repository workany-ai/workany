/**
 * OpenClaw Gateway API Routes
 *
 * Provides REST endpoints for OpenClaw Gateway integration.
 */

import { Hono } from 'hono';

import { OpenClawGateway } from '@/extensions/agent/openclaw/gateway';
import type {
  ChatSendParams,
  OpenClawConfig,
} from '@/extensions/agent/openclaw/types';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('OpenClawAPI');

// ============================================================================
// Types
// ============================================================================

interface DetectBody {
  gatewayUrl: string;
  authToken?: string;
  password?: string;
}

interface ChatBody {
  message: string;
  sessionId?: string;
  gatewayUrl?: string;
  authToken?: string;
}

interface HistoryBody {
  sessionKey: string;
  gatewayUrl?: string;
  authToken?: string;
}

// ============================================================================
// Helpers
// ============================================================================

const DEFAULT_GATEWAY_URL = 'ws://127.0.0.1:18789';

function createGatewayConfig(body: {
  gatewayUrl?: string;
  authToken?: string;
  password?: string;
}): OpenClawConfig {
  return {
    gatewayUrl: body.gatewayUrl || DEFAULT_GATEWAY_URL,
    authToken: body.authToken,
    password: body.password,
    timeout: 10000,
    reconnectAttempts: 1,
  };
}

function successResponse<T>(data: T) {
  return { success: true, ...data };
}

function errorResponse(message: string) {
  return { success: false, message };
}

// ============================================================================
// Routes
// ============================================================================

const openclawRoutes = new Hono();

// Global error handler for OpenClaw routes
openclawRoutes.onError((err, c) => {
  console.error('[OpenClawAPI] Unhandled error:', err);
  return c.json(
    { error: err instanceof Error ? err.message : 'Internal server error' },
    500
  );
});

/**
 * POST /openclaw/detect
 * Detect OpenClaw Gateway connection
 */
openclawRoutes.post('/detect', async (c) => {
  try {
    const body = (await c.req.json()) as DetectBody;

    if (!body?.gatewayUrl) {
      return c.json(errorResponse('Missing required field: gatewayUrl'));
    }

    logger.info('[OpenClawAPI] Detection requested for:', body.gatewayUrl);

    const gateway = new OpenClawGateway(createGatewayConfig(body));
    const isConnected = await gateway.checkConnection();

    if (isConnected) {
      logger.info('[OpenClawAPI] Connection successful');
      return c.json(successResponse({ message: 'Successfully connected to OpenClaw Gateway' }));
    }

    logger.info('[OpenClawAPI] Connection failed');
    return c.json(
      errorResponse(
        'Failed to connect to OpenClaw Gateway. Please check the URL and ensure the Gateway is running.'
      )
    );
  } catch (error) {
    logger.error('[OpenClawAPI] Detection error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json(errorResponse(`Connection error: ${errorMessage}`));
  }
});

/**
 * POST /openclaw/chat
 * Send a message to OpenClaw Bot
 */
openclawRoutes.post('/chat', async (c) => {
  try {
    const body = (await c.req.json()) as ChatBody;

    if (!body?.message) {
      return c.json({ success: false, error: 'Missing required field: message' });
    }

    logger.info('[OpenClawAPI] Chat requested:', {
      hasSession: !!body.sessionId,
      messageLength: body.message.length,
    });

    const config = createGatewayConfig(body);
    config.timeout = 30000;

    const gateway = new OpenClawGateway(config);
    const sessionKey = body.sessionId || `bot_${Date.now()}`;

    // Create or patch session
    try {
      await gateway.sessionsPatch({
        key: sessionKey,
        label: body.message.slice(0, 50),
      });
    } catch (error: unknown) {
      // Ignore "label already in use" error - session already exists
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'INVALID_REQUEST'
      ) {
        logger.warn('[OpenClawAPI] Session patch failed:', error);
      }
    }

    // Count existing assistant messages before sending
    let existingAssistantCount = 0;
    try {
      const preHistory = await gateway.chatHistory({ sessionKey });
      existingAssistantCount = preHistory?.messages?.filter(
        (m) => m.role === 'assistant'
      ).length ?? 0;
    } catch {
      // Ignore - treat as 0 existing messages
    }

    // Send chat message
    await gateway.chatSend({
      sessionKey,
      message: body.message,
      deliver: true,
      timeoutMs: 25000,
      idempotencyKey: `chat_${sessionKey}_${Date.now()}`,
    });

    // Poll for response
    const reply = await pollForReply(gateway, sessionKey, existingAssistantCount);

    logger.info('[OpenClawAPI] Chat response received:', {
      replyLength: reply.length,
    });

    return c.json({ success: true, reply: reply || '抱歉，我暂时无法回复。' });
  } catch (error) {
    logger.error('[OpenClawAPI] Chat error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: `Chat error: ${errorMessage}` });
  }
});

/**
 * Poll for assistant reply from chat history
 */
async function pollForReply(
  gateway: OpenClawGateway,
  sessionKey: string,
  existingCount: number
): Promise<string> {
  const maxAttempts = 30;
  const pollDelay = 500;

  for (let attempts = 0; attempts < maxAttempts; attempts++) {
    await new Promise((resolve) => setTimeout(resolve, pollDelay));

    try {
      const history = await gateway.chatHistory({ sessionKey });
      if (!history?.messages) continue;

      const assistantMessages = history.messages.filter((m) => m.role === 'assistant');

      // Check for new assistant messages
      if (assistantMessages.length > existingCount) {
        const lastMessage = assistantMessages.sort(
          (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
        )[0];

        if (lastMessage.content?.length > 0) {
          const reply = lastMessage.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text || '')
            .join('\n')
            .trim();

          if (reply) return reply;
        }
      }
    } catch (error) {
      logger.warn('[OpenClawAPI] Failed to fetch history:', error);
    }
  }

  return '';
}

/**
 * POST /openclaw/history
 * Get chat history for a session
 */
openclawRoutes.post('/history', async (c) => {
  try {
    const body = (await c.req.json()) as HistoryBody;

    if (!body?.sessionKey) {
      return c.json({ success: false, error: 'Missing required field: sessionKey' });
    }

    const gateway = new OpenClawGateway(createGatewayConfig(body));
    const history = await gateway.chatHistory({ sessionKey: body.sessionKey });

    return c.json({ success: true, messages: history.messages || [] });
  } catch (error) {
    logger.error('[OpenClawAPI] History error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: `History error: ${errorMessage}` });
  }
});

/**
 * POST /openclaw/sessions
 * Get all chat sessions
 */
openclawRoutes.post('/sessions', async (c) => {
  try {
    const body = (await c.req.json()) as { gatewayUrl?: string; authToken?: string };

    logger.info('[OpenClawAPI] Sessions request');

    const gateway = new OpenClawGateway(createGatewayConfig(body));
    const sessions = await gateway.sessionsList();

    logger.info('[OpenClawAPI] Sessions found:', sessions.sessions?.length ?? 0);

    return c.json({ success: true, sessions: sessions.sessions || [] });
  } catch (error) {
    logger.error('[OpenClawAPI] Sessions error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: `Sessions error: ${errorMessage}` });
  }
});

export { openclawRoutes };
