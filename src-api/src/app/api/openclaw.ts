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
 * Send a message to OpenClaw Bot (async mode)
 * Returns immediately with runId, frontend polls history for response
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
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Create or patch session (only set label for new sessions)
    // For existing sessions, we don't update the label to avoid conflicts
    if (!body.sessionId) {
      // New session - set a unique label using session key prefix
      const labelPrefix = body.message.slice(0, 30).replace(/\n/g, ' ');
      try {
        await gateway.sessionsPatch({
          key: sessionKey,
          label: `${labelPrefix} (${sessionKey.slice(-6)})`,
        });
      } catch (error: unknown) {
        // Log but don't fail - label uniqueness is not critical
        logger.warn('[OpenClawAPI] Session patch failed:', error);
      }
    }

    // Send chat message (fire and forget - don't wait for response)
    gateway.chatSend({
      sessionKey,
      message: body.message,
      deliver: true,
      timeoutMs: 60000,
      idempotencyKey: runId,
    }).catch((err) => {
      logger.error('[OpenClawAPI] Chat send error (async):', err);
    });

    logger.info('[OpenClawAPI] Chat request accepted:', { runId, sessionKey });

    // Return immediately with runId
    return c.json({
      success: true,
      runId,
      sessionKey,
      status: 'accepted',
    });
  } catch (error) {
    logger.error('[OpenClawAPI] Chat error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: `Chat error: ${errorMessage}` });
  }
});

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
    const body = (await c.req.json()) as { 
      gatewayUrl?: string; 
      authToken?: string;
      limit?: number;
      includeLastMessage?: boolean;
    };

    logger.info('[OpenClawAPI] Sessions request', {
      limit: body.limit,
      includeLastMessage: body.includeLastMessage,
    });

    const gateway = new OpenClawGateway(createGatewayConfig(body));
    const sessions = await gateway.sessionsList({
      limit: body.limit,
      includeLastMessage: body.includeLastMessage,
    });

    logger.info('[OpenClawAPI] Sessions found:', sessions.sessions?.length ?? 0);

    return c.json({ success: true, sessions: sessions.sessions || [] });
  } catch (error) {
    logger.error('[OpenClawAPI] Sessions error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: `Sessions error: ${errorMessage}` });
  }
});

export { openclawRoutes };
