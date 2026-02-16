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
    // Assistant stream
    text?: string;
    delta?: string;
    // Lifecycle
    startedAt?: number;
    endedAt?: number;
    // Internal flag for fallback mode
    _useChatStream?: boolean;
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
  const isMountedRef = useRef(false);
  const isConnectingRef = useRef(false);

  // Track finalized runs to prevent duplicate message creation
  const finalizedRunsRef = useRef<Set<string>>(new Set());

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
   * Primary source for message content when available
   */
  const handleChatEventInternal = useCallback((payload: ChatEventPayload) => {
    console.log('[OpenClawWS] Chat event:', payload.state, 'seq:', payload.seq);

    // Track runId
    if (payload.runId && payload.state === 'delta') {
      currentRunIdRef.current = payload.runId;
    }

    switch (payload.state) {
      case 'delta': {
        // Streaming text - update chatStream
        const text = extractText(payload.message);
        if (text) {
          setChatStream(text);
        }
        break;
      }

      case 'final': {
        // Mark run as finalized to prevent duplicate from agent.lifecycle.end
        if (payload.runId) {
          finalizedRunsRef.current.add(payload.runId);
        }
        // Clear chatStream - message will come from payload
        setChatStream(null);
        currentRunIdRef.current = null;
        break;
      }

      case 'error':
      case 'aborted': {
        // Clear state
        setChatStream(null);
        currentRunIdRef.current = null;
        break;
      }
    }

    onChatEventRef.current?.(payload);
  }, []);

  /**
   * Handle agent events (tool/lifecycle/assistant)
   * Secondary source for message content (fallback when chat events not sent)
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
    } else if (payload.stream === 'assistant') {
      // Update chatStream with streaming text
      const { text } = payload.data;
      if (typeof text === 'string') {
        setChatStream(text);
      }
    } else if (payload.stream === 'lifecycle') {
      if (payload.data?.phase === 'start') {
        // New run starting - clear finalized tracking for this run
        if (payload.runId) {
          finalizedRunsRef.current.delete(payload.runId);
          console.log(
            '[OpenClawWS] Lifecycle start, cleared finalized for runId:',
            payload.runId
          );
        }
      } else if (payload.data?.phase === 'end') {
        // Agent finished - clear tool stream
        setToolStream(new Map());

        const isFinalized =
          payload.runId && finalizedRunsRef.current.has(payload.runId);
        console.log(
          '[OpenClawWS] Lifecycle end, runId:',
          payload.runId,
          'already finalized:',
          isFinalized
        );

        // Only trigger finalization if not already finalized by chat event
        if (payload.runId && !isFinalized) {
          // Mark as finalized
          finalizedRunsRef.current.add(payload.runId);
          currentRunIdRef.current = null;

          console.log(
            '[OpenClawWS] Sending lifecycle.end with _useChatStream=true'
          );

          // Notify UI to use chatStream content
          // Pass a special payload indicating fallback mode
          onAgentEventRef.current?.({
            ...payload,
            data: {
              ...payload.data,
              _useChatStream: true, // Signal to UI to use chatStream
            },
          });

          // Clear chatStream AFTER notifying UI so it can capture the content
          setChatStream(null);
          return; // Don't call callback again
        }
      }
    }

    onAgentEventRef.current?.(payload);
  }, []);

  /**
   * Handle incoming WebSocket messages
   */
  const handleMessage = useCallback(
    (msg: WebSocketMessage) => {
      console.log(
        '[OpenClawWS] Received message:',
        JSON.stringify(msg).slice(0, 200)
      );

      switch (msg.type) {
        case 'connected':
          console.log('[OpenClawWS] Server confirmed connection');
          break;

        case 'subscribed':
          console.log('[OpenClawWS] Subscribed to session:', msg.sessionKey);
          setIsSubscribed(true);
          break;

        case 'unsubscribed':
          console.log(
            '[OpenClawWS] Unsubscribed from session:',
            msg.sessionKey
          );
          setIsSubscribed(false);
          break;

        case 'event':
          console.log(
            '[OpenClawWS] Received event:',
            msg.event,
            'seq:',
            msg.seq
          );
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
              console.log('[OpenClawWS] Processing chat event');
              handleChatEventInternal(msg.payload as ChatEventPayload);
            } else if (msg.event === 'agent') {
              console.log('[OpenClawWS] Processing agent event');
              handleAgentEventInternal(msg.payload as AgentEventPayload);
            }
          } else {
            console.warn('[OpenClawWS] Event missing event or payload');
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
    },
    [handleChatEventInternal, handleAgentEventInternal]
  );

  /**
   * Connect to WebSocket server
   */
  const connect = useCallback(() => {
    // Close any existing connection first (handles StrictMode double-mount)
    if (wsRef.current) {
      const existingWs = wsRef.current;
      if (
        existingWs.readyState === WebSocket.OPEN ||
        existingWs.readyState === WebSocket.CONNECTING
      ) {
        console.log(
          '[OpenClawWS] Closing existing connection before creating new one'
        );
        existingWs.onopen = null;
        existingWs.onmessage = null;
        existingWs.onclose = null;
        existingWs.onerror = null;
        existingWs.close(1000, 'Reconnecting');
        wsRef.current = null;
      }
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    isConnectingRef.current = true;
    const wsUrl = `${API_BASE_URL.replace(/^http/, 'ws')}/openclaw/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws; // Store reference immediately

      ws.onopen = () => {
        // Check if component is still mounted (handles StrictMode)
        if (!isMountedRef.current) {
          console.log(
            '[OpenClawWS] Connected but component unmounted, closing...'
          );
          ws.close(1000, 'Component unmounted');
          isConnectingRef.current = false;
          return;
        }

        console.log('[OpenClawWS] Connected');
        isConnectingRef.current = false;
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
        isConnectingRef.current = false;
        setIsConnected(false);
        setIsSubscribed(false);

        // Attempt to reconnect after a delay (only if still mounted)
        if (autoConnect && event.code !== 1000 && isMountedRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[OpenClawWS] Attempting to reconnect...');
            if (isMountedRef.current) {
              connect();
            }
          }, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error('[OpenClawWS] Error:', error);
        isConnectingRef.current = false;
        onErrorRef.current?.('WebSocket connection error');
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('[OpenClawWS] Failed to connect:', error);
      isConnectingRef.current = false;
      onErrorRef.current?.('Failed to create WebSocket connection');
    }
  }, [autoConnect, handleMessage]);

  /**
   * Subscribe to a session's events
   */
  const subscribe = useCallback(
    (sessionKey: string, config: OpenClawConfig) => {
      console.log(
        '[OpenClawWS] subscribe() called with sessionKey:',
        sessionKey
      );
      console.log('[OpenClawWS] subscribe() config:', JSON.stringify(config));
      console.log('[OpenClawWS] WebSocket state:', wsRef.current?.readyState);

      subscribedSessionRef.current = sessionKey;
      configRef.current = config;

      // Reset state for new subscription
      setChatStream(null);
      setToolStream(new Map());
      lastSeqRef.current = null;

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        console.log('[OpenClawWS] Sending subscribe message...');
        wsRef.current.send(
          JSON.stringify({
            type: 'subscribe',
            sessionKey,
            config,
          })
        );
      } else {
        console.log('[OpenClawWS] WebSocket not open, calling connect()...');
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

    isConnectingRef.current = false;
    setIsConnected(false);
    setIsSubscribed(false);
    setChatStream(null);
    setToolStream(new Map());
    subscribedSessionRef.current = null;
  }, []);

  // Auto-connect on mount (handles React StrictMode double-invocation)
  useEffect(() => {
    isMountedRef.current = true;

    if (autoConnect) {
      connect();
    }

    return () => {
      isMountedRef.current = false;
      // Always cleanup the WebSocket on unmount
      const ws = wsRef.current;
      if (ws) {
        console.log(
          '[OpenClawWS] Cleanup: closing WebSocket, state:',
          ws.readyState
        );
        // Remove all handlers to prevent callbacks after unmount
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close(1000, 'Component unmounted');
        }
        wsRef.current = null;
      }
      isConnectingRef.current = false;
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
