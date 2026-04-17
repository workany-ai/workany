/**
 * Channel Adapter Framework - Type Definitions
 *
 * Defines the contract for platform-specific channel adapters.
 * Each adapter converts between a messaging platform's protocol
 * and the internal Agent request/response format.
 *
 * Supports two connection modes:
 *  - **webhook**: passive mode, receives HTTP POST from platform
 *  - **websocket**: active mode, adapter connects to platform via long-lived WS
 */

import type { AgentMessage, ConversationMessage } from '@/core/agent/types';

export type ConnectionMode = 'webhook' | 'websocket';

export interface ChannelAdapterConfig {
  enabled: boolean;
  connectionMode?: ConnectionMode;
  webhookSecret?: string;
  [key: string]: unknown;
}

export interface IncomingMessage {
  senderId: string;
  senderName?: string;
  content: string;
  conversationId: string;
  replyToMessageId?: string;
  attachments?: Array<{
    type: string;
    url: string;
    name?: string;
  }>;
  raw: unknown;
  /** When set, the webhook handler returns this directly without agent processing */
  directResponse?: unknown;
}

export interface OutgoingMessage {
  conversationId: string;
  content: string;
  replyToMessageId?: string;
  artifacts?: Array<{
    type: string;
    data: unknown;
  }>;
}

export interface ChannelAdapter {
  readonly id: string;
  readonly name: string;

  initialize(config: ChannelAdapterConfig): Promise<void>;

  /** Webhook mode: verify incoming HTTP request signature */
  verifyWebhook(headers: Record<string, string>, body: string): Promise<boolean>;

  /** Webhook mode: parse incoming HTTP body into IncomingMessage */
  parseIncoming(body: unknown, headers: Record<string, string>): Promise<IncomingMessage | null>;

  formatResponse(
    agentMessages: AgentMessage[],
    conversationId: string
  ): Promise<OutgoingMessage>;

  send(message: OutgoingMessage): Promise<void>;

  shutdown(): Promise<void>;

  /**
   * WebSocket mode: actively connect to the platform.
   * The adapter manages its own event loop and calls `onMessage` for each incoming message.
   * Returns once the connection is established (runs in background).
   */
  connect?(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void>;

  /** WebSocket mode: disconnect from the platform */
  disconnect?(): Promise<void>;

  /** Whether this adapter is currently connected (WebSocket mode) */
  isConnected?(): boolean;

  // ─── Streaming Card (optional) ────────────────────────────────────

  /** Create a streaming card, returns message_id for updates */
  sendStreamingCard?(chatId: string, initialText: string): Promise<string | null>;

  /** Update streaming card content */
  updateStreamingCard?(messageId: string, text: string): Promise<boolean>;

  /** Close streaming card with final content */
  closeStreamingCard?(messageId: string, finalText: string): Promise<boolean>;
}

export interface ChannelSession {
  channelId: string;
  conversationId: string;
  history: ConversationMessage[];
  createdAt: Date;
  lastActiveAt: Date;
}
