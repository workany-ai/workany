import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { API_BASE_URL } from '@/config';
import { getBotSessions, getDatabase } from '@/shared/db/database';
import { type BotChatSession } from '@/shared/hooks/useBotChats';
import {
  convertOpenClawMessage,
  generateTitleFromContent,
  getLastMessagePreview,
} from '@/shared/lib/bot-message-utils';
import {
  rowToBotChatMessage,
  rowToBotChatSession,
  syncBotMessages,
  syncBotSessions,
  type BotSyncState,
} from '@/shared/lib/bot-sync';

interface BotChatContextType {
  sessions: BotChatSession[];
  isLoading: boolean;
  syncState: BotSyncState;
  refreshSessions: () => Promise<void>;
  syncSessions: () => Promise<void>;
  syncMessages: (sessionKey: string) => Promise<void>;
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
  lastMessage?: {
    role: string;
    content?: Array<{ type?: string; text?: string }>;
    timestamp?: number;
    toolCallId?: string;
    toolName?: string;
    details?: Record<string, unknown>;
    isError?: boolean;
  };
}

interface OpenClawSessionsResponse {
  success: boolean;
  sessions?: OpenClawSession[];
}

export function BotChatProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<BotChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [syncState, setSyncState] = useState<BotSyncState>({
    isSyncingSessions: false,
    syncingSessionKey: null,
    lastSyncTime: null,
    syncError: null,
  });

  /**
   * Load local sessions from SQLite database
   */
  const loadLocalSessions = async function (): Promise<BotChatSession[]> {
    const db = await getDatabase();
    if (!db) {
      return [];
    }

    try {
      const sessionRows = await getBotSessions(db);
      const chatSessions = sessionRows.map((row) => rowToBotChatSession(row));
      return chatSessions;
    } catch (error) {
      console.error('[BotChatProvider] Failed to load local sessions:', error);
      return [];
    }
  };

  /**
   * Fetch sessions from cloud only (fallback when no database)
   */
  const fetchBotChatsFromCloud = useCallback(async (): Promise<void> => {
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
          let lastMessagePreview = '新对话';
          let generatedLabel = session.label;

          if (session.lastMessage) {
            const botMessage = convertOpenClawMessage(session.lastMessage);
            lastMessagePreview = getLastMessagePreview([botMessage]);

            if (!generatedLabel && botMessage.content) {
              generatedLabel = generateTitleFromContent(botMessage.content);
            }
          }

          return {
            sessionKey: session.key,
            friendlyId: session.friendlyId,
            label: generatedLabel || undefined,
            messages: [],
            lastMessage: lastMessagePreview,
            messageCount: 0,
            updatedAt: session.updatedAt || Date.now(),
          };
        }
      );

      chatSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      setSessions(chatSessions);
    } catch (error) {
      console.error('[BotChatProvider] Failed to fetch from cloud:', error);
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Sync sessions from cloud to local database
   */
  const syncSessionsFromCloud = useCallback(async (): Promise<void> => {
    setSyncState((prev) => ({
      ...prev,
      isSyncingSessions: true,
      syncError: null,
    }));

    try {
      const db = await getDatabase();
      if (!db) {
        // No database available, fallback to cloud-only fetch
        await fetchBotChatsFromCloud();
        return;
      }

      const sessionRows = await syncBotSessions(db);
      const chatSessions = sessionRows.map((row) => rowToBotChatSession(row));

      chatSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      setSessions(chatSessions);

      setSyncState((prev) => ({
        ...prev,
        isSyncingSessions: false,
        lastSyncTime: Date.now(),
      }));
    } catch (error) {
      console.error('[BotChatProvider] Failed to sync sessions:', error);
      setSyncState((prev) => ({
        ...prev,
        isSyncingSessions: false,
        syncError:
          error instanceof Error ? error.message : 'Failed to sync sessions',
      }));
    }
  }, [fetchBotChatsFromCloud]);

  /**
   * Sync messages for a specific session from cloud to local database
   */
  const syncMessagesForSession = useCallback(
    async (sessionKey: string): Promise<void> => {
      setSyncState((prev) => ({
        ...prev,
        syncingSessionKey: sessionKey,
        syncError: null,
      }));

      try {
        const db = await getDatabase();
        if (!db) {
          return;
        }

        const messageRows = await syncBotMessages(db, sessionKey);

        setSessions((prevSessions) =>
          prevSessions.map((session) => {
            if (session.sessionKey === sessionKey) {
              return {
                ...session,
                messages: messageRows.map(rowToBotChatMessage),
                messageCount: messageRows.length,
              };
            }
            return session;
          })
        );

        setSyncState((prev) => ({ ...prev, syncingSessionKey: null }));
      } catch (error) {
        console.error('[BotChatProvider] Failed to sync messages:', error);
        setSyncState((prev) => ({
          ...prev,
          syncingSessionKey: null,
          syncError:
            error instanceof Error ? error.message : 'Failed to sync messages',
        }));
      }
    },
    []
  );

  /**
   * Initialize: Load local sessions first, then sync from cloud if configured
   */
  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      if (!isMounted) return;
      setIsLoading(true);

      // First, try to load local sessions
      const localSessions = await loadLocalSessions();
      if (!isMounted) return;

      if (localSessions.length > 0) {
        // Show local sessions immediately
        localSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        setSessions(localSessions);
        setIsLoading(false);

        // Fire-and-forget background sync from cloud if configured
        const config = getOpenClawConfig();
        if (config) {
          syncSessionsFromCloud();
        }
      } else {
        // No local cache - must fetch from cloud before showing UI
        const config = getOpenClawConfig();
        if (config) {
          await syncSessionsFromCloud();
        }
        if (!isMounted) return;
        setIsLoading(false);
      }
    };

    initialize();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(
    () => ({
      sessions,
      isLoading,
      syncState,
      refreshSessions: syncSessionsFromCloud,
      syncSessions: syncSessionsFromCloud,
      syncMessages: syncMessagesForSession,
    }),
    [
      sessions,
      isLoading,
      syncState,
      syncSessionsFromCloud,
      syncMessagesForSession,
    ]
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
