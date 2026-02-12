/**
 * OpenClaw Gateway Protocol Types
 *
 * This module defines the types for communicating with the OpenClaw Gateway
 * via WebSocket JSON-RPC protocol.
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * OpenClaw agent configuration
 */
export interface OpenClawConfig {
  /** Gateway WebSocket URL (default: ws://127.0.0.1:18789) */
  gatewayUrl: string;
  /** Authentication token (recommended) */
  authToken?: string;
  /** Alternative password authentication */
  password?: string;
  /** Connection timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Reconnection attempts (default: 3) */
  reconnectAttempts?: number;
}

// ============================================================================
// JSON-RPC Protocol Types
// ============================================================================

/**
 * JSON-RPC 2.0 request frame
 */
export interface JsonRpcRequestFrame {
  type: 'req';
  id: string; // UUID for matching response
  method: string;
  params?: unknown;
}

/**
 * JSON-RPC 2.0 response frame
 */
export interface JsonRpcResponseFrame {
  type: 'res';
  id: string; // Corresponds to request ID
  ok: boolean;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * JSON-RPC 2.0 event frame
 */
export interface JsonRpcEventFrame {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
}

/**
 * Any JSON-RPC frame
 */
export type JsonRpcFrame =
  | JsonRpcRequestFrame
  | JsonRpcResponseFrame
  | JsonRpcEventFrame;

// ============================================================================
// Gateway Message Types
// ============================================================================

/**
 * Content types in OpenClaw messages
 */
export type OpenClawContent =
  | TextContent
  | ToolCallContent
  | ToolResultContent
  | ThinkingContent;

/**
 * Text content
 */
export interface TextContent {
  type: 'text';
  text?: string;
  textSignature?: string;
}

/**
 * Tool call content
 */
export interface ToolCallContent {
  type: 'toolCall';
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  partialJson?: string;
}

/**
 * Tool result content
 */
export interface ToolResultContent {
  type: 'toolResult';
  toolCallId?: string;
  toolName?: string;
  content?: Array<{ type?: string; text?: string }>;
  details?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Thinking/reasoning content
 */
export interface ThinkingContent {
  type: 'thinking';
  thinking?: string;
  thinkingSignature?: string;
}

/**
 * OpenClaw gateway message
 */
export interface OpenClawMessage {
  role?: 'user' | 'assistant' | 'system';
  content?: OpenClawContent[];
  toolCallId?: string;
  toolName?: string;
  details?: Record<string, unknown>;
  isError?: boolean;
  timestamp?: number;
  __optimisticId?: string;
}

// ============================================================================
// Session Types
// ============================================================================

/**
 * Session metadata
 */
export interface SessionMeta {
  key: string; // Session key (internal)
  friendlyId?: string; // User-facing ID
  title?: string;
  derivedTitle?: string;
  label?: string;
  updatedAt?: number;
  lastMessage?: OpenClawMessage | null;
  totalTokens?: number;
  contextTokens?: number;
}

/**
 * Session summary (from sessions.list)
 */
export interface SessionSummary {
  key: string;
  friendlyId?: string;
  label?: string;
}

// ============================================================================
// RPC Request/Response Types
// ============================================================================

/**
 * Connect handshake params
 */
export interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: string;
    displayName: string;
    version: string;
    platform: string;
    mode: 'ui' | 'cli';
    instanceId: string;
  };
  auth: {
    token?: string;
    password?: string;
  };
  role: 'operator' | 'node';
  scopes: string[];
}

/**
 * Sessions list request params
 */
export interface SessionsListParams {
  limit?: number;
  includeLastMessage?: boolean;
  includeDerivedTitles?: boolean;
}

/**
 * Sessions list response
 */
export interface SessionsListResponse {
  sessions?: SessionSummary[];
}

/**
 * Sessions resolve request params
 */
export interface SessionsResolveParams {
  key: string;
  includeUnknown?: boolean;
  includeGlobal?: boolean;
}

/**
 * Sessions resolve response
 */
export interface SessionsResolveResponse {
  ok: boolean;
  key: string;
}

/**
 * Sessions patch request params (create/update)
 */
export interface SessionsPatchParams {
  key: string;
  label?: string;
}

/**
 * Sessions patch response
 */
export interface SessionsPatchResponse {
  ok: boolean;
  key: string;
  path?: string;
  entry?: Record<string, unknown>;
}

/**
 * Chat history request params
 */
export interface ChatHistoryParams {
  sessionKey: string;
  limit?: number;
}

/**
 * Chat history response
 */
export interface ChatHistoryResponse {
  sessionKey: string;
  sessionId?: string;
  messages: OpenClawMessage[];
  thinkingLevel?: string;
}

/**
 * Chat send request params
 */
export interface ChatSendParams {
  sessionKey: string;
  message: string;
  thinking?: string;
  attachments?: Array<{
    mimeType: string;
    content: string; // base64
  }>;
  deliver?: boolean;
  timeoutMs?: number;
  idempotencyKey?: string;
}

/**
 * Chat send response
 */
export interface ChatSendResponse {
  runId: string;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * OpenClaw gateway error
 */
export class OpenClawGatewayError extends Error {
  constructor(
    message: string,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'OpenClawGatewayError';
  }
}

/**
 * Connection error
 */
export class OpenClawConnectionError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'OpenClawConnectionError';
  }
}

/**
 * Timeout error
 */
export class OpenClawTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenClawTimeoutError';
  }
}
