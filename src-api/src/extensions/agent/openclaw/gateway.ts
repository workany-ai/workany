/**
 * OpenClaw Gateway WebSocket Client
 *
 * This module implements a WebSocket client for communicating with the
 * OpenClaw Gateway using the JSON-RPC protocol with short connection mode.
 */

import { randomUUID } from 'node:crypto';
import { platform } from 'node:os';
import WebSocket from 'ws';

import type {
  ChatHistoryParams,
  ChatHistoryResponse,
  ChatSendParams,
  ChatSendResponse,
  ConnectParams,
  JsonRpcFrame,
  JsonRpcRequestFrame,
  JsonRpcResponseFrame,
  OpenClawConfig,
  SessionsListParams,
  SessionsListResponse,
  SessionsPatchParams,
  SessionsPatchResponse,
  SessionsResolveParams,
  SessionsResolveResponse,
} from './types';
import {
  OpenClawConnectionError as ConnectionError,
  OpenClawGatewayError as GatewayError,
} from './types';

// ============================================================================
// Logger
// ============================================================================

import { createLogger } from '@/shared/utils/logger';
import {
  OPENCLAW_IDLE_TIMEOUT,
  getOpenClawGatewayUrl,
  getOpenClawAuthToken,
  getOpenClawAuthPassword,
} from '@/config/constants';

const logger = createLogger('OpenClawGateway');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Wait for WebSocket to open
 */
function wsOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      ws.off('open', onOpen);
      ws.off('error', onError);
      resolve();
    };

    const onError = (err: Error) => {
      ws.off('open', onOpen);
      ws.off('error', onError);
      reject(new ConnectionError(`WebSocket error: ${err.message || err}`));
    };

    ws.once('open', onOpen);
    ws.once('error', onError);
  });
}

/**
 * Wait for WebSocket to close
 */
function wsClose(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    ws.once('close', () => resolve());
    ws.close();
  });
}

/**
 * Build connect params
 */
function buildConnectParams(token?: string, password?: string): ConnectParams {
  return {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: 'gateway-client',
      displayName: 'workany',
      version: '1.0.0',
      platform: platform(),
      mode: 'ui',
      instanceId: randomUUID(),
    },
    auth: {
      token: token || undefined,
      password: password || undefined,
    },
    role: 'operator',
    scopes: ['operator.admin'],
  };
}

/**
 * Create a response waiters map and handler for RPC requests
 */
function createRpcWaiters() {
  const waiters = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  const createWaiter = (id: string): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      waiters.set(id, { resolve, reject });
    });
  };

  const handleMessage = (data: Buffer): void => {
    try {
      const frame: JsonRpcFrame = JSON.parse(data.toString('utf-8'));

      if (frame.type !== 'res') {
        return;
      }

      const responseFrame = frame as JsonRpcResponseFrame;
      const waiter = waiters.get(responseFrame.id);

      if (waiter) {
        waiters.delete(responseFrame.id);

        if (responseFrame.ok) {
          waiter.resolve(responseFrame.payload);
        } else {
          waiter.reject(
            new GatewayError(
              responseFrame.error?.message || 'Gateway error',
              responseFrame.error?.code,
              responseFrame.error?.details
            )
          );
        }
      }
    } catch (error) {
      logger.error('Failed to parse message:', error);
    }
  };

  return { waiters, createWaiter, handleMessage };
}

// ============================================================================
// OpenClaw Gateway Client
// ============================================================================

/**
 * OpenClaw Gateway WebSocket client
 *
 * Uses short connection mode: each RPC call creates a new WebSocket connection.
 */
export class OpenClawGateway {
  private config: Required<
    Omit<OpenClawConfig, 'authToken' | 'password'>
  > & {
    authToken?: string;
    password?: string;
  };

  constructor(config: OpenClawConfig) {
    this.config = {
      gatewayUrl: config.gatewayUrl || getOpenClawGatewayUrl(),
      timeout: config.timeout || OPENCLAW_IDLE_TIMEOUT,
      reconnectAttempts: config.reconnectAttempts || 3,
      authToken: config.authToken,
      password: config.password,
    };
  }

  /**
   * Perform a JSON-RPC request
   *
   * @param method - RPC method name
   * @param params - Method parameters
   * @returns Promise with the response payload
   */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    logger.debug(`[OpenClawGateway] RPC request: ${method}`);

    const ws = new WebSocket(this.config.gatewayUrl);
    const { createWaiter, handleMessage } = createRpcWaiters();

    try {
      await wsOpen(ws);
      logger.debug('[OpenClawGateway] WebSocket opened');

      const connectParams = buildConnectParams(
        this.config.authToken,
        this.config.password
      );

      // Send connect handshake (must be first request)
      const connectId = randomUUID();
      ws.on('message', handleMessage);
      ws.send(
        JSON.stringify({
          type: 'req',
          id: connectId,
          method: 'connect',
          params: connectParams,
        } satisfies JsonRpcRequestFrame)
      );

      await createWaiter(connectId);
      logger.debug('[OpenClawGateway] Connect handshake successful');

      // Send actual business request
      const requestId = randomUUID();
      ws.send(
        JSON.stringify({
          type: 'req',
          id: requestId,
          method,
          params,
        } satisfies JsonRpcRequestFrame)
      );

      const payload = await createWaiter(requestId) as T;
      logger.debug(`[OpenClawGateway] RPC response received: ${method}`);

      return payload;
    } finally {
      ws.off('message', handleMessage);
      try {
        await wsClose(ws);
      } catch {
        // Ignore close errors
      }
    }
  }

  /**
   * Check if gateway is available (connect handshake only)
   */
  async checkConnection(): Promise<boolean> {
    logger.debug('[OpenClawGateway] Checking connection...');

    const ws = new WebSocket(this.config.gatewayUrl);
    const { createWaiter, handleMessage } = createRpcWaiters();

    try {
      await wsOpen(ws);
      logger.debug('[OpenClawGateway] WebSocket opened');

      const connectParams = buildConnectParams(
        this.config.authToken,
        this.config.password
      );

      const connectId = randomUUID();
      ws.on('message', handleMessage);
      ws.send(
        JSON.stringify({
          type: 'req',
          id: connectId,
          method: 'connect',
          params: connectParams,
        } satisfies JsonRpcRequestFrame)
      );

      await createWaiter(connectId);
      logger.debug('[OpenClawGateway] Connection check successful');

      return true;
    } catch (error) {
      logger.error('[OpenClawGateway] Connection check failed:', error);
      return false;
    } finally {
      ws.off('message', handleMessage);
      try {
        await wsClose(ws);
      } catch {
        // Ignore close errors
      }
    }
  }

  // ============================================================================
  // RPC Methods
  // ============================================================================

  /**
   * sessions.list - Get list of sessions
   */
  async sessionsList(
    params?: SessionsListParams
  ): Promise<SessionsListResponse> {
    return this.request<SessionsListResponse>('sessions.list', params);
  }

  /**
   * sessions.resolve - Resolve friendlyId to sessionKey
   */
  async sessionsResolve(
    params: SessionsResolveParams
  ): Promise<SessionsResolveResponse> {
    return this.request<SessionsResolveResponse>('sessions.resolve', params);
  }

  /**
   * sessions.patch - Create or update a session
   */
  async sessionsPatch(
    params: SessionsPatchParams
  ): Promise<SessionsPatchResponse> {
    return this.request<SessionsPatchResponse>('sessions.patch', params);
  }

  /**
   * sessions.delete - Delete a session
   */
  async sessionsDelete(sessionKey: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>('sessions.delete', { sessionKey });
  }

  /**
   * chat.history - Get chat history for a session
   */
  async chatHistory(
    params: ChatHistoryParams
  ): Promise<ChatHistoryResponse> {
    return this.request<ChatHistoryResponse>('chat.history', params);
  }

  /**
   * chat.send - Send a message to a session
   */
  async chatSend(params: ChatSendParams): Promise<ChatSendResponse> {
    return this.request<ChatSendResponse>('chat.send', params);
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an OpenClaw Gateway client
 *
 * @param config - Gateway configuration
 * @returns OpenClawGateway instance
 */
export function createOpenClawGateway(
  config: OpenClawConfig
): OpenClawGateway {
  return new OpenClawGateway(config);
}

/**
 * Get default gateway configuration from environment variables
 */
export function getDefaultGatewayConfig(): OpenClawConfig {
  return {
    gatewayUrl: getOpenClawGatewayUrl(),
    authToken: getOpenClawAuthToken(),
    password: getOpenClawAuthPassword(),
    timeout: OPENCLAW_IDLE_TIMEOUT,
    reconnectAttempts: 3,
  };
}
