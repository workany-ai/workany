/**
 * OpenClaw WebSocket Hook
 *
 * Implements the moltbot protocol for real-time event streaming.
 * Handles chat events (delta/final/error/aborted) and agent events (tool/lifecycle).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/config';

// ============================================================================
// Types - Following moltbot protocol
// ============================================================================

export interface OpenClawConfig {
  gatewayUrl: string;
  authToken?: string;
}

// Content block types
export interface TextContent {
  type: 'text';
  text?: string;
}

export interface ThinkingContent {
  type: 'thinking';
  thinking?: string;
}

export interface ToolCallContent {
  type: 'toolCall';
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'toolResult';
  toolCallId?: string;
  toolName?: string;
  text?: string;
  isError?: boolean;
}

export type ContentBlock =
  | TextContent
  | ThinkingContent
  | ToolCallContent
  | ToolResultContent;

// Chat event payload matching moltbot protocol
export interface ChatEventPayload {
  runId: string;
  sessionKey: string;
  seq: number;
  state: 'delta' | 'final' | 'error' | 'aborted';
  message?: {
    role: string;
    content: ContentBlock[];
    timestamp?: number;
    toolCallId?: string;
    toolName?: string;
  };
  errorMessage?: string;
}

// Agent event payload for tool calls
export interface AgentEventPayload {
  runId: string;
  seq: number;
  stream: 'tool' | 'lifecycle' | 'assistant' | 'error';
  ts: number;
  data: {
    // Tool stream phases
    phase?: 'start' | 'update' | 'result' | 'end' | 'error';
    name?: string;
    toolCallId?: string;
    args?: Record<string, unknown>;
    result?: unknown;
    partialResult?: unknown;
    error?: string;
  };
}

// Lifecycle event
export interface LifecycleEventPayload {
  runId: string;
  phase: 'start' | 'end' | 'error';
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

export type OpenClawEvent =
  | { event: 'chat'; payload: ChatEventPayload }
  | { event: 'agent'; payload: AgentEventPayload };

export type EventHandler = (event: OpenClawEvent) => void;

// Tool stream entry for tracking tool calls
export interface ToolStreamEntry {
  toolCallId: string;
  runId: string;
  name: string;
  args?: Record<string, unknown>;
  output?: string;
  startedAt: number;
  updatedAt: number;
  phase: 'start' | 'update' | 'result';
}

interface WebSocketMessage {
  type:
    | 'connected'
    | 'subscribed'
    | 'unsubscribed'
    | 'event'
    | 'error'
    | 'pong';
  sessionKey?: string;
  event?: string;
  payload?: unknown;
  message?: string;
  seq?: number;
}

interface UseOpenClawWebSocketOptions {
  autoConnect?: boolean;
  onChatEvent?: (payload: ChatEventPayload) => void;
  onAgentEvent?: (payload: AgentEventPayload) => void;
  onError?: (error: string) => void;
}

interface UseOpenClawWebSocketReturn {
  isConnected: boolean;
  isSubscribed: boolean;
  chatStream: string | null;
  toolStream: Map<string, ToolStreamEntry>;
  subscribe: (sessionKey: string, config: OpenClawConfig) => void;
  unsubscribe: (sessionKey: string) => void;
  disconnect: () => void;
}

// ============================================================================
// Text Extraction (following moltbot)
// ============================================================================

/**
 * Extract text from message content
 */
export function extractText(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;

  const m = message as Record<string, unknown>;
  const content = m.content;

  // String content
  if (typeof content === 'string') {
    return content;
  }

  // Array content (content blocks)
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        if (p.type === 'text' && typeof p.text === 'string') {
          return p.text;
        }
        return null;
      })
      .filter(Boolean);
    return parts.join('\n');
  }

  // Direct text field
  if (typeof m.text === 'string') {
    return m.text;
  }

  return null;
}

/**
 * Extract thinking content from message
 */
export function extractThinking(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;

  const m = message as Record<string, unknown>;
  const content = m.content;
  const parts: string[] = [];

  if (Array.isArray(content)) {
    for (const p of content) {
      if (p.type === 'thinking' && typeof p.thinking === 'string') {
        parts.push(p.thinking.trim());
      }
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Extract tool calls from message
 */
export function extractToolCalls(message: unknown): ToolCallContent[] {
  if (!message || typeof message !== 'object') return [];

  const m = message as Record<string, unknown>;
  const content = m.content;

  if (!Array.isArray(content)) return [];

  return content.filter(
    (p): p is ToolCallContent => p.type === 'toolCall' && !!p.name
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useOpenClawWebSocket(
  options: UseOpenClawWebSocketOptions = {}
): UseOpenClawWebSocketReturn {
  const { autoConnect = true, onChatEvent, onAgentEvent, onError } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [chatStream, setChatStream] = useState<string | null>(null);
  const [toolStream, setToolStream] = useState<Map<string, ToolStreamEntry>>(
    new Map()
  );

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subscribedSessionRef = useRef<string | null>(null);
  const configRef = useRef<OpenClawConfig | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const lastSeqRef = useRef<number | null>(null);

  // Use refs for callbacks to prevent unnecessary re-renders
  const onChatEventRef = useRef(onChatEvent);
  const onAgentEventRef = useRef(onAgentEvent);
  const onErrorRef = useRef(onError);

  // Keep refs updated
  useEffect(() => {
    onChatEventRef.current = onChatEvent;
    onAgentEventRef.current = onAgentEvent;
    onErrorRef.current = onError;
  });

  /**
   * Handle chat events (delta/final/error/aborted)
   */
  const handleChatEventInternal = useCallback((payload: ChatEventPayload) => {
    console.log(
      '[OpenClawWS] Chat event:',
      payload.state,
      'seq:',
      payload.seq
    );

    // Track runId
    if (payload.runId && payload.state === 'delta') {
      currentRunIdRef.current = payload.runId;
    }

    switch (payload.state) {
      case 'delta': {
        // Streaming text - accumulate
        const text = extractText(payload.message);
        if (text) {
          setChatStream((prev) => {
            // Only update if new text is longer (accumulate like moltbot)
            if (!prev || text.length >= prev.length) {
              return text;
            }
            return prev;
          });
        }
        break;
      }

      case 'final': {
        // Completed - clear stream, keep tool stream
        setChatStream(null);
        currentRunIdRef.current = null;
        break;
      }

      case 'error':
      case 'aborted': {
        // Error or aborted - clear state
        setChatStream(null);
        currentRunIdRef.current = null;
        break;
      }
    }

    onChatEventRef.current?.(payload);
  }, []);

  /**
   * Handle agent events (tool/lifecycle)
   */
  const handleAgentEventInternal = useCallback((payload: AgentEventPayload) => {
    console.log(
      '[OpenClawWS] Agent event:',
      payload.stream,
      'phase:',
      payload.data?.phase
    );

    if (payload.stream === 'tool') {
      const { phase, name, toolCallId, args, result, partialResult } =
        payload.data;

      if (!toolCallId || !name) return;

      setToolStream((prev) => {
        const next = new Map(prev);
        const existing = next.get(toolCallId);

        if (phase === 'start') {
          // New tool call
          next.set(toolCallId, {
            toolCallId,
            runId: payload.runId,
            name,
            args,
            startedAt: payload.ts,
            updatedAt: payload.ts,
            phase: 'start',
          });
        } else if (existing) {
          // Update existing tool call
          const output =
            phase === 'result'
              ? JSON.stringify(result, null, 2)
              : partialResult
                ? JSON.stringify(partialResult, null, 2)
                : existing.output;

          next.set(toolCallId, {
            ...existing,
            output,
            updatedAt: payload.ts,
            phase: phase as 'update' | 'result',
          });
        }

        return next;
      });
    } else if (payload.stream === 'lifecycle') {
      if (payload.data?.phase === 'end') {
        // Agent finished - clear run state
        setToolStream(new Map());
      }
    }

    onAgentEventRef.current?.(payload);
  }, []);

  /**
   * Handle incoming WebSocket messages
   */
  const handleMessage = useCallback((msg: WebSocketMessage) => {
    switch (msg.type) {
      case 'connected':
        console.log('[OpenClawWS] Server confirmed connection');
        break;

      case 'subscribed':
        console.log('[OpenClawWS] Subscribed to session:', msg.sessionKey);
        setIsSubscribed(true);
        break;

      case 'unsubscribed':
        console.log('[OpenClawWS] Unsubscribed from session:', msg.sessionKey);
        setIsSubscribed(false);
        break;

      case 'event':
        if (msg.event && msg.payload) {
          // Check for sequence gap
          if (msg.seq !== undefined && lastSeqRef.current !== null) {
            if (msg.seq > lastSeqRef.current + 1) {
              console.warn(
                '[OpenClawWS] Sequence gap detected:',
                `expected ${lastSeqRef.current + 1}, got ${msg.seq}`
              );
            }
            lastSeqRef.current = msg.seq;
          }

          if (msg.event === 'chat') {
            handleChatEventInternal(msg.payload as ChatEventPayload);
          } else if (msg.event === 'agent') {
            handleAgentEventInternal(msg.payload as AgentEventPayload);
          }
        }
        break;

      case 'error':
        console.error('[OpenClawWS] Server error:', msg.message);
        onErrorRef.current?.(msg.message || 'Unknown error');
        break;

      case 'pong':
        // Keep-alive response
        break;
    }
  }, [handleChatEventInternal, handleAgentEventInternal]);

  /**
   * Connect to WebSocket server
   */
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const wsUrl = `${API_BASE_URL.replace(/^http/, 'ws')}/openclaw/ws`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[OpenClawWS] Connected');
        setIsConnected(true);
        lastSeqRef.current = null;

        // Re-subscribe if we had a previous subscription
        if (subscribedSessionRef.current && configRef.current) {
          ws.send(
            JSON.stringify({
              type: 'subscribe',
              sessionKey: subscribedSessionRef.current,
              config: configRef.current,
            })
          );
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg: WebSocketMessage = JSON.parse(event.data);
          handleMessage(msg);
        } catch (error) {
          console.error('[OpenClawWS] Failed to parse message:', error);
        }
      };

      ws.onclose = (event) => {
        console.log('[OpenClawWS] Disconnected:', event.code, event.reason);
        setIsConnected(false);
        setIsSubscribed(false);

        // Attempt to reconnect after a delay
        if (autoConnect && event.code !== 1000) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[OpenClawWS] Attempting to reconnect...');
            connect();
          }, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error('[OpenClawWS] Error:', error);
        onErrorRef.current?.('WebSocket connection error');
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('[OpenClawWS] Failed to connect:', error);
      onErrorRef.current?.('Failed to create WebSocket connection');
    }
  }, [autoConnect, handleMessage]);

  /**
   * Subscribe to a session's events
   */
  const subscribe = useCallback(
    (sessionKey: string, config: OpenClawConfig) => {
      subscribedSessionRef.current = sessionKey;
      configRef.current = config;

      // Reset state for new subscription
      setChatStream(null);
      setToolStream(new Map());
      lastSeqRef.current = null;

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'subscribe',
            sessionKey,
            config,
          })
        );
      } else {
        // Connect first, then subscribe
        connect();
      }
    },
    [connect]
  );

  /**
   * Unsubscribe from a session
   */
  const unsubscribe = useCallback((sessionKey: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'unsubscribe',
          sessionKey,
        })
      );
    }
    subscribedSessionRef.current = null;
    setIsSubscribed(false);
  }, []);

  /**
   * Disconnect WebSocket
   */
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnect');
      wsRef.current = null;
    }

    setIsConnected(false);
    setIsSubscribed(false);
    setChatStream(null);
    setToolStream(new Map());
    subscribedSessionRef.current = null;
  }, []);

  // Auto-connect on mount (only once)
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run on mount/unmount

  // Keep-alive ping
  useEffect(() => {
    if (!isConnected) return;

    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => clearInterval(pingInterval);
  }, [isConnected]);

  return {
    isConnected,
    isSubscribed,
    chatStream,
    toolStream,
    subscribe,
    unsubscribe,
    disconnect,
  };
}

// ============================================================================
// Simplified Hook for Chat Only
// ============================================================================

interface UseOpenClawChatOptions {
  sessionKey: string | null;
  config: OpenClawConfig | null;
  onFinal?: (message: ChatEventPayload['message']) => void;
  onError?: (error: string) => void;
}

/**
 * Simplified hook for chat events only
 */
export function useOpenClawChat(options: UseOpenClawChatOptions) {
  const { sessionKey, config, onFinal, onError } = options;

  const handleChatEvent = useCallback(
    (payload: ChatEventPayload) => {
      if (payload.state === 'final' && payload.message) {
        onFinal?.(payload.message);
      } else if (payload.state === 'error') {
        onError?.(payload.errorMessage || 'Unknown error');
      }
    },
    [onFinal, onError]
  );

  const {
    isConnected,
    isSubscribed,
    chatStream,
    toolStream,
    subscribe,
    unsubscribe,
  } = useOpenClawWebSocket({
    autoConnect: true,
    onChatEvent: handleChatEvent,
    onError,
  });

  // Subscribe when sessionKey and config are available
  useEffect(() => {
    if (sessionKey && config && isConnected) {
      subscribe(sessionKey, config);
    }

    return () => {
      if (sessionKey) {
        unsubscribe(sessionKey);
      }
    };
  }, [sessionKey, config, isConnected, subscribe, unsubscribe]);

  return {
    isConnected,
    isSubscribed,
    chatStream,
    toolStream,
  };
}
