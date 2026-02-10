/**
 * useBotChats Hook
 *
 * Fetches all OpenClaw Bot chat sessions with their history.
 */

import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/config';

export interface BotContentPart {
  type: 'text' | 'thinking' | 'toolCall' | 'toolResult';
  text?: string;
  thinking?: string;
  thinkingSignature?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  partialJson?: string;
  toolCallId?: string;
  toolName?: string;
  content?: Array<{ type?: string; text?: string }>;
  details?: Record<string, unknown>;
  isError?: boolean;
}

export interface BotChatMessage {
  role: 'user' | 'assistant' | 'toolResult';
  content: string;
  timestamp?: number;
  rawContent?: BotContentPart[];
  toolCallId?: string;
  toolName?: string;
  details?: Record<string, unknown>;
  isError?: boolean;
}

export interface BotChatSession {
  sessionKey: string;
  friendlyId?: string;
  label?: string;
  messages: BotChatMessage[];
  lastMessage?: string;
  messageCount: number;
  updatedAt?: number;
}

function getOpenClawConfig() {
  const stored = localStorage.getItem('openclaw_config');
  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

function convertMessage(m: any): BotChatMessage {
  return {
    role: m.role,
    content:
      m.content
        ?.filter((c: any) => c.type === 'text')
        .map((c: any) => c.text || '')
        .join('\n') || '',
    timestamp: m.timestamp,
    rawContent: m.content || [],
    toolCallId: m.toolCallId,
    toolName: m.toolName,
    details: m.details,
    isError: m.isError,
  };
}

function getLastMessage(messages: BotChatMessage[]): string {
  const lastAssistant = messages
    .filter((m) => m.role === 'assistant')
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];

  const lastUser = messages
    .filter((m) => m.role === 'user')
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];

  const lastMessage = lastAssistant?.content || lastUser?.content || '';
  return lastMessage.slice(0, 50) + (lastMessage.length > 50 ? '...' : '');
}

async function fetchSessionHistory(
  sessionKey: string,
  config: { gatewayUrl?: string; authToken?: string }
): Promise<BotChatMessage[]> {
  const response = await fetch(`${API_BASE_URL}/openclaw/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionKey,
      gatewayUrl: config.gatewayUrl,
      authToken: config.authToken,
    }),
  });

  if (!response.ok) return [];

  const data = await response.json();
  if (!data.success || !data.messages) return [];

  return data.messages
    .filter((m: any) => ['user', 'assistant', 'toolResult'].includes(m.role))
    .map(convertMessage);
}

function createFallbackSession(session: any): BotChatSession {
  return {
    sessionKey: session.key,
    friendlyId: session.friendlyId,
    label: session.label,
    messages: [],
    lastMessage: session.label || '新对话',
    messageCount: 0,
    updatedAt: session.updatedAt,
  };
}

export function useBotChats() {
  const [sessions, setSessions] = useState<BotChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchBotChats() {
      setIsLoading(true);

      try {
        const config = getOpenClawConfig();
        if (!config) {
          setSessions([]);
          return;
        }

        const sessionsResponse = await fetch(
          `${API_BASE_URL}/openclaw/sessions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              gatewayUrl: config.gatewayUrl,
              authToken: config.authToken,
            }),
          }
        );

        if (!sessionsResponse.ok) {
          console.error('[useBotChats] Failed to fetch sessions');
          setSessions([]);
          return;
        }

        const sessionsData = await sessionsResponse.json();
        if (!sessionsData.success || !sessionsData.sessions) {
          setSessions([]);
          return;
        }

        const botSessions = sessionsData.sessions;

        const chatSessions: BotChatSession[] = await Promise.all(
          botSessions.map(async (session: any) => {
            try {
              const messages = await fetchSessionHistory(session.key, config);

              if (messages.length > 0) {
                return {
                  sessionKey: session.key,
                  friendlyId: session.friendlyId,
                  label: session.label,
                  messages,
                  lastMessage: getLastMessage(messages),
                  messageCount: messages.length,
                  updatedAt: session.updatedAt || Date.now(),
                };
              }

              return createFallbackSession(session);
            } catch (error) {
              console.error(
                `[useBotChats] Failed to fetch history for ${session.key}:`,
                error
              );
              return createFallbackSession(session);
            }
          })
        );

        chatSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        setSessions(chatSessions);
      } catch (error) {
        console.error('[useBotChats] Error:', error);
        setSessions([]);
      } finally {
        setIsLoading(false);
      }
    }

    fetchBotChats();
  }, []);

  return { sessions, isLoading };
}
