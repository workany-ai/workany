import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { API_BASE_URL } from '@/config';
import { type BotChatSession } from '@/shared/hooks/useBotChats';
import {
  convertOpenClawMessage,
  getLastMessagePreview,
} from '@/shared/lib/bot-message-utils';

interface BotChatContextType {
  sessions: BotChatSession[];
  isLoading: boolean;
  refreshSessions: () => Promise<void>;
}

const BotChatContext = createContext<BotChatContextType | undefined>(undefined);

function getOpenClawConfig(): {
  gatewayUrl?: string;
  authToken?: string;
} | null {
  const stored = localStorage.getItem('openclaw_config');
  if (!stored) return null;

  try {
    return JSON.parse(stored) as { gatewayUrl?: string; authToken?: string };
  } catch {
    return null;
  }
}

interface OpenClawSession {
  key: string;
  friendlyId?: string;
  label?: string;
  updatedAt?: number;
  lastMessage?: any; // Using any for simplicity as it matches OpenClawMessage structure
}

interface OpenClawSessionsResponse {
  success: boolean;
  sessions?: OpenClawSession[];
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

      const sessionsResponse = await fetch(
        `${API_BASE_URL}/openclaw/sessions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gatewayUrl: config.gatewayUrl,
            authToken: config.authToken,
            includeLastMessage: true,
          }),
        }
      );

      if (!sessionsResponse.ok) {
        setSessions([]);
        return;
      }

      const sessionsData =
        (await sessionsResponse.json()) as OpenClawSessionsResponse;
      if (!sessionsData.success || !sessionsData.sessions) {
        setSessions([]);
        return;
      }

      const chatSessions: BotChatSession[] = sessionsData.sessions.map(
        (session) => {
          let lastMessagePreview = session.label || '新对话';
          let messageCount = 0;

          if (session.lastMessage) {
            const botMessage = convertOpenClawMessage(session.lastMessage);
            lastMessagePreview = getLastMessagePreview([botMessage]);
            // Since we don't have the full count without fetching history, we can assume at least 1 if lastMessage exists
            // Or we can rely on what the API provides if it provides count (it currently doesn't seem to)
            messageCount = 1;
          }

          return {
            sessionKey: session.key,
            friendlyId: session.friendlyId,
            label: session.label,
            messages: [], // We don't load full messages here anymore
            lastMessage: lastMessagePreview,
            messageCount: messageCount, // This might be inaccurate but is better than fetching all
            updatedAt: session.updatedAt || Date.now(),
          };
        }
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
