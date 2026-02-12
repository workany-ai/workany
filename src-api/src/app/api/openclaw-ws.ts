/**
 * OpenClaw WebSocket Real-time Events API
 *
 * Implements the moltbot protocol for real-time event streaming.
 * Frame types: req (request), res (response), event (event)
 *
 * Event types:
 * - chat: {state: "delta"|"final"|"error"|"aborted", message, seq}
 * - agent: {stream: "tool"|"lifecycle"|"assistant", data, seq}
 */

import WebSocket from 'ws';

import type {
  JsonRpcEventFrame,
  OpenClawConfig,
} from '@/extensions/agent/openclaw/types';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('OpenClawWebSocket');

// ============================================================================
// Types
// ============================================================================

interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping';
  sessionKey?: string;
  config?: {
    gatewayUrl: string;
    authToken?: string;
  };
}

// Chat event payload matching moltbot protocol
interface ChatEventPayload {
  runId: string;
  sessionKey: string;
  seq: number;
  state: 'delta' | 'final' | 'error' | 'aborted';
  message?: {
    role: string;
    content: Array<{
      type: string;
      text?: string;
      thinking?: string;
    }>;
    timestamp?: number;
  };
  errorMessage?: string;
}

// Agent event payload matching moltbot protocol
interface AgentEventPayload {
  runId: string;
  seq: number;
  stream: 'tool' | 'lifecycle' | 'assistant' | 'error';
  ts: number;
  data: Record<string, unknown>;
}

interface ServerMessage {
  type: 'connected' | 'subscribed' | 'unsubscribed' | 'event' | 'error' | 'pong';
  sessionKey?: string;
  event?: string;
  payload?: ChatEventPayload | AgentEventPayload | unknown;
  message?: string;
  seq?: number;
}

// ============================================================================
// Gateway Connection Manager
// ============================================================================

interface GatewayConnection {
  ws: WebSocket;
  config: OpenClawConfig;
  subscribers: Set<(event: JsonRpcEventFrame) => void>;
  subscribedSessions: Set<string>;
  requestId: number;
}

/**
 * Manages persistent connections to OpenClaw Gateway for event streaming
 * Follows moltbot protocol for session subscription via node.event
 */
class GatewayConnectionManager {
  private connections = new Map<string, GatewayConnection>();

  /**
   * Get or create a gateway connection
   */
  async getConnection(
    config: OpenClawConfig,
    onEvent: (event: JsonRpcEventFrame) => void
  ): Promise<{ connectionKey: string; close: () => void }> {
    const connectionKey = this.createConnectionKey(config);

    logger.info('[GatewayManager] getConnection called, key:', connectionKey);

    let conn = this.connections.get(connectionKey);

    if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
      logger.info('[GatewayManager] Creating new connection...');
      conn = await this.createConnection(config);
      this.connections.set(connectionKey, conn);
      logger.info('[GatewayManager] Connection created and stored');
    } else {
      logger.info('[GatewayManager] Reusing existing connection');
    }

    conn.subscribers.add(onEvent);
    logger.info('[GatewayManager] Total subscribers:', conn.subscribers.size);

    return {
      connectionKey,
      close: () => {
        const c = this.connections.get(connectionKey);
        if (c) {
          c.subscribers.delete(onEvent);
          // Close connection if no more subscribers
          if (c.subscribers.size === 0) {
            // Unsubscribe from all sessions before closing
            for (const sessionKey of c.subscribedSessions) {
              this.sendSessionUnsubscribe(c, sessionKey);
            }
            c.ws.close();
            this.connections.delete(connectionKey);
          }
        }
      },
    };
  }

  /**
   * Subscribe to a session's events
   * Sends node.event with chat.subscribe to the gateway
   */
  async subscribeToSession(
    config: OpenClawConfig,
    sessionKey: string
  ): Promise<void> {
    const connectionKey = this.createConnectionKey(config);
    const conn = this.connections.get(connectionKey);

    if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
      logger.warn('[GatewayManager] No connection available for subscription');
      return;
    }

    // Already subscribed?
    if (conn.subscribedSessions.has(sessionKey)) {
      logger.debug('[GatewayManager] Already subscribed to session:', sessionKey);
      return;
    }

    // Send chat.subscribe via node.event (moltbot protocol)
    this.sendSessionSubscribe(conn, sessionKey);
    conn.subscribedSessions.add(sessionKey);
    logger.info('[GatewayManager] Subscribed to session:', sessionKey);
  }

  /**
   * Unsubscribe from a session's events
   * Sends node.event with chat.unsubscribe to the gateway
   */
  async unsubscribeFromSession(
    config: OpenClawConfig,
    sessionKey: string
  ): Promise<void> {
    const connectionKey = this.createConnectionKey(config);
    const conn = this.connections.get(connectionKey);

    if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (conn.subscribedSessions.has(sessionKey)) {
      this.sendSessionUnsubscribe(conn, sessionKey);
      conn.subscribedSessions.delete(sessionKey);
      logger.info('[GatewayManager] Unsubscribed from session:', sessionKey);
    }
  }

  private sendSessionSubscribe(conn: GatewayConnection, sessionKey: string) {
    const requestId = ++conn.requestId;
    // moltbot protocol uses payloadJSON as a string
    const params = {
      event: 'chat.subscribe',
      payloadJSON: JSON.stringify({ sessionKey }),
    };

    conn.ws.send(
      JSON.stringify({
        type: 'req',
        id: `node-event-${requestId}`,
        method: 'node.event',
        params,
      })
    );

    logger.info('[GatewayManager] Sent chat.subscribe for session:', sessionKey);
  }

  private sendSessionUnsubscribe(conn: GatewayConnection, sessionKey: string) {
    const requestId = ++conn.requestId;
    // moltbot protocol uses payloadJSON as a string
    const params = {
      event: 'chat.unsubscribe',
      payloadJSON: JSON.stringify({ sessionKey }),
    };

    conn.ws.send(
      JSON.stringify({
        type: 'req',
        id: `node-event-${requestId}`,
        method: 'node.event',
        params,
      })
    );

    logger.debug('[GatewayManager] Sent chat.unsubscribe for session:', sessionKey);
  }

  private createConnectionKey(config: OpenClawConfig): string {
    return `${config.gatewayUrl}:${config.authToken || 'no-token'}`;
  }

  private async createConnection(config: OpenClawConfig): Promise<GatewayConnection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(config.gatewayUrl!);
      const conn: GatewayConnection = {
        ws,
        config,
        subscribers: new Set(),
        subscribedSessions: new Set(),
        requestId: 0,
      };

      let connectionResolved = false;
      const connectRequestId = `connect-${Date.now()}`;

      ws.on('open', () => {
        logger.info('[GatewayManager] Connected to OpenClaw Gateway');

        // Send connect handshake following moltbot protocol
        const connectParams = {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: 'workany-events',
            displayName: 'WorkAny',
            version: '1.0.0',
            platform: process.platform,
            mode: 'ui',
            instanceId: `workany-${Date.now()}`,
          },
          auth: {
            token: config.authToken,
            password: config.password,
          },
          role: 'operator',
          scopes: ['operator.admin'],
          caps: ['tool-events'], // Request tool events
        };

        ws.send(
          JSON.stringify({
            type: 'req',
            id: connectRequestId,
            method: 'connect',
            params: connectParams,
          })
        );

        // Set a timeout for connection
        setTimeout(() => {
          if (!connectionResolved) {
            logger.warn('[GatewayManager] Connection timeout - proceeding anyway');
            connectionResolved = true;
            resolve(conn);
          }
        }, 5000);
      });

      ws.on('message', (data) => {
        try {
          const frame = JSON.parse(data.toString());

          // Log all incoming frames for debugging
          logger.info('[GatewayManager] Received frame:', JSON.stringify({
            type: frame.type,
            event: frame.event,
            id: frame.id,
            method: frame.method,
          }));

          // Wait for connect response before resolving
          if (frame.type === 'res' && frame.id === connectRequestId && !connectionResolved) {
            connectionResolved = true;
            logger.info('[GatewayManager] Connect handshake completed');
            resolve(conn);
          }

          // Handle event frames
          if (frame.type === 'event') {
            const eventFrame = frame as JsonRpcEventFrame;
            const payload = eventFrame.payload as { sessionKey?: string };
            logger.info(
              '[GatewayManager] Event details - event:',
              eventFrame.event,
              'sessionKey:',
              payload?.sessionKey,
              'seq:',
              eventFrame.seq,
              'subscribers:',
              conn.subscribers.size
            );

            // Broadcast to all subscribers
            for (const subscriber of conn.subscribers) {
              subscriber(eventFrame);
            }
          } else if (frame.type === 'res') {
            // Response to our requests (connect, node.event, etc.)
            logger.info('[GatewayManager] Response to:', frame.id, 'result:', JSON.stringify(frame.result)?.slice(0, 200));
          }
        } catch (error) {
          logger.error('[GatewayManager] Failed to parse message:', error);
        }
      });

      ws.on('error', (error) => {
        logger.error('[GatewayManager] WebSocket error:', error);
        if (!connectionResolved) {
          reject(error);
        }
      });

      ws.on('close', () => {
        logger.info('[GatewayManager] Connection closed');
      });

      // Connection timeout
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Connection timeout'));
          ws.close();
        }
      }, 10000);
    });
  }
}

// Singleton instance
const gatewayManager = new GatewayConnectionManager();

// ============================================================================
// WebSocket Server
// ============================================================================

interface ClientData {
  sessionKeys: Set<string>;
  gatewayConnection?: {
    close: () => void;
    connectionKey: string;
  };
  config?: OpenClawConfig;
}

/**
 * Create a WebSocket server for OpenClaw events
 * Follows moltbot protocol for event broadcasting
 */
export function createOpenClawEventServer() {
  const clients = new Map<WebSocket, ClientData>();

  /**
   * Handle new WebSocket connection
   */
  const handleConnection = (ws: WebSocket) => {
    const client: ClientData = {
      sessionKeys: new Set(),
    };
    clients.set(ws, client);

    logger.info('[OpenClawWS] Client connected, total:', clients.size);

    ws.on('message', async (data) => {
      try {
        const msg: ClientMessage = JSON.parse(data.toString());
        await handleMessage(ws, msg);
      } catch (error) {
        logger.error('[OpenClawWS] Failed to handle message:', error);
        sendMessage(ws, { type: 'error', message: 'Invalid message format' });
      }
    });

    ws.on('close', () => {
      const clientData = clients.get(ws);
      if (clientData?.gatewayConnection) {
        clientData.gatewayConnection.close();
      }
      clients.delete(ws);
      logger.info('[OpenClawWS] Client disconnected, total:', clients.size);
    });

    ws.on('error', (error) => {
      logger.error('[OpenClawWS] Client error:', error);
    });

    // Send connected message
    sendMessage(ws, { type: 'connected' });
  };

  /**
   * Handle client messages
   */
  async function handleMessage(ws: WebSocket, msg: ClientMessage) {
    const client = clients.get(ws);
    if (!client) return;

    logger.info('[OpenClawWS] Received message:', msg.type);

    switch (msg.type) {
      case 'subscribe': {
        logger.info('[OpenClawWS] Subscribe request - sessionKey:', msg.sessionKey);
        logger.info('[OpenClawWS] Subscribe config:', JSON.stringify(msg.config));

        if (!msg.sessionKey || !msg.config) {
          sendMessage(ws, {
            type: 'error',
            message: 'Missing sessionKey or config',
          });
          return;
        }

        // Store config and session key
        client.config = msg.config as OpenClawConfig;
        client.sessionKeys.add(msg.sessionKey);
        logger.info('[OpenClawWS] Client sessionKeys:', Array.from(client.sessionKeys));

        // Subscribe to gateway events
        try {
          logger.info('[OpenClawWS] Getting gateway connection...');
          const { close, connectionKey } = await gatewayManager.getConnection(
            client.config,
            (event) => {
              // Filter events for this client's sessions
              const payload = event.payload as { sessionKey?: string; runId?: string };
              logger.info(
                '[OpenClawWS] Event callback - event:',
                event.event,
                'payload sessionKey:',
                payload?.sessionKey,
                'client sessionKeys:',
                Array.from(client.sessionKeys),
                'match:',
                payload?.sessionKey && client.sessionKeys.has(payload.sessionKey)
              );
              if (
                payload?.sessionKey &&
                client.sessionKeys.has(payload.sessionKey)
              ) {
                // Forward event with seq number
                logger.info('[OpenClawWS] Forwarding event to client');
                sendMessage(ws, {
                  type: 'event',
                  event: event.event,
                  payload: event.payload,
                  seq: event.seq,
                });
              } else {
                logger.warn('[OpenClawWS] Event NOT forwarded - sessionKey mismatch');
              }
            }
          );

          client.gatewayConnection = { close, connectionKey };

          // Subscribe to session events on the gateway (moltbot protocol)
          await gatewayManager.subscribeToSession(client.config, msg.sessionKey);

          sendMessage(ws, { type: 'subscribed', sessionKey: msg.sessionKey });

          logger.info('[OpenClawWS] Subscribed to session:', msg.sessionKey);
        } catch (error) {
          logger.error('[OpenClawWS] Failed to subscribe:', error);
          sendMessage(ws, {
            type: 'error',
            message: 'Failed to connect to gateway',
          });
        }
        break;
      }

      case 'unsubscribe': {
        if (msg.sessionKey) {
          client.sessionKeys.delete(msg.sessionKey);

          // Unsubscribe from session events on the gateway
          if (client.config) {
            await gatewayManager.unsubscribeFromSession(client.config, msg.sessionKey);
          }

          sendMessage(ws, { type: 'unsubscribed', sessionKey: msg.sessionKey });
        }
        break;
      }

      case 'ping': {
        sendMessage(ws, { type: 'pong' });
        break;
      }
    }
  }

  /**
   * Send message to client
   */
  function sendMessage(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  return {
    handleConnection,
    getClients: () => clients,
  };
}

// ============================================================================
// Event Type Exports
// ============================================================================

export type { ChatEventPayload, AgentEventPayload, ServerMessage };
