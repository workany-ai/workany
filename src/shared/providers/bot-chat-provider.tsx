import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { API_BASE_URL } from '@/config';
import {
  type BotChatMessage,
  type BotChatSession,
} from '@/shared/hooks/useBotChats';

interface BotChatContextType {
  sessions: BotChatSession[];
  isLoading: boolean;
  refreshSessions: () => Promise<void>;
}

const BotChatContext = createContext<BotChatContextType | undefined>(undefined);

function getOpenClawConfig(): { gatewayUrl?: string; authToken?: string } | null {
  const stored = localStorage.getItem('openclaw_config');
  if (!stored) return null;

  try {
    return JSON.parse(stored) as { gatewayUrl?: string; authToken?: string };
  } catch {
    return null;
  }
}

interface OpenClawMessage {
  role: string;
  content?: Array<{ type?: string; text?: string }>;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  details?: Record<string, unknown>;
  isError?: boolean;
}

interface OpenClawSession {
  key: string;
  friendlyId?: string;
  label?: string;
  updatedAt?: number;
}

interface OpenClawSessionsResponse {
  success: boolean;
  sessions?: OpenClawSession[];
}

interface OpenClawHistoryResponse {
  success: boolean;
  messages?: OpenClawMessage[];
}

function convertMessage(message: OpenClawMessage): BotChatMessage {
  return {
    role: message.role as BotChatMessage['role'],
    content:
      message.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text || '')
        .join('\n') || '',
    timestamp: message.timestamp,
    rawContent: message.content || [],
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    details: message.details,
    isError: message.isError,
  };
}

function getLastMessage(messages: BotChatMessage[]): string {
  const sortByTimestamp = (a: BotChatMessage, b: BotChatMessage) =>
    (b.timestamp || 0) - (a.timestamp || 0);

  const lastAssistant = messages
    .filter((m) => m.role === 'assistant')
    .sort(sortByTimestamp)[0];

  const lastUser = messages
    .filter((m) => m.role === 'user')
    .sort(sortByTimestamp)[0];

  const content = lastAssistant?.content || lastUser?.content || '';
  const previewLength = 50;

  return content.length > previewLength
    ? content.slice(0, previewLength) + '...'
    : content;
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

  const data = (await response.json()) as OpenClawHistoryResponse;
  if (!data.success || !data.messages) return [];

  const validRoles = new Set(['user', 'assistant', 'toolResult']);

  return data.messages
    .filter((m) => validRoles.has(m.role))
    .map(convertMessage);
}

function createFallbackSession(session: OpenClawSession): BotChatSession {
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

export function BotChatProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<BotChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchBotChats = async function (): Promise<void> {
    setIsLoading(true);
    try {
      const config = getOpenClawConfig();
      if (!config) {
        setSessions([]);
        return;
      }

      const sessionsResponse = await fetch(`${API_BASE_URL}/openclaw/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gatewayUrl: config.gatewayUrl,
          authToken: config.authToken,
        }),
      });

      if (!sessionsResponse.ok) {
        setSessions([]);
        return;
      }

      const sessionsData = (await sessionsResponse.json()) as OpenClawSessionsResponse;
      if (!sessionsData.success || !sessionsData.sessions) {
        setSessions([]);
        return;
      }

      const chatSessions: BotChatSession[] = await Promise.all(
        sessionsData.sessions.map(async (session) => {
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
          } catch {
            return createFallbackSession(session);
          }
        })
      );

      chatSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      setSessions(chatSessions);
    } catch {
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBotChats();
  }, []);

  const value = useMemo(
    () => ({
      sessions,
      isLoading,
      refreshSessions: fetchBotChats,
    }),
    [sessions, isLoading]
  );

  return (
    <BotChatContext.Provider value={value}>{children}</BotChatContext.Provider>
  );
}

export function useBotChatContext(): BotChatContextType {
  const context = useContext(BotChatContext);
  if (context === undefined) {
    throw new Error('useBotChatContext must be used within a BotChatProvider');
  }
  return context;
}
