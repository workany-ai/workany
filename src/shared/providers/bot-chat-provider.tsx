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
  createTask,
  getTask,
  getTasksByType,
  updateTask,
  type Task,
} from '@/shared/db';
import { type BotChatSession } from '@/shared/hooks/useBotChats';
import {
  convertOpenClawMessage,
  generateTitleFromContent,
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

// Helper: Convert Task to BotChatSession
function taskToBotChatSession(task: Task): BotChatSession {
  return {
    sessionKey: task.id,
    friendlyId: task.session_id,
    label: task.label || task.prompt,
    messages: [],
    lastMessage: task.last_message || '',
    messageCount: task.message_count || 0,
    updatedAt: task.remote_updated_at || new Date(task.updated_at).getTime(),
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
        // No config, try to load from local database
        const localBotTasks = await getTasksByType('bot');
        const localSessions = localBotTasks.map(taskToBotChatSession);
        setSessions(localSessions);
        return;
      }

      // Fetch from cloud
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
        // Fallback to local data
        const localBotTasks = await getTasksByType('bot');
        const localSessions = localBotTasks.map(taskToBotChatSession);
        setSessions(localSessions);
        return;
      }

      const sessionsData =
        (await sessionsResponse.json()) as OpenClawSessionsResponse;
      if (!sessionsData.success || !sessionsData.sessions) {
        // Fallback to local data
        const localBotTasks = await getTasksByType('bot');
        const localSessions = localBotTasks.map(taskToBotChatSession);
        setSessions(localSessions);
        return;
      }

      // Sync cloud sessions to local database
      const chatSessions: BotChatSession[] = await Promise.all(
        sessionsData.sessions.map(async (session) => {
          let lastMessagePreview = '新对话';
          let generatedLabel = session.label;
          let messageCount = 0;

          if (session.lastMessage) {
            const botMessage = convertOpenClawMessage(session.lastMessage);
            lastMessagePreview = getLastMessagePreview([botMessage]);
            messageCount = 1;

            // Generate label from message content if no label exists
            // Priority: existing label > user message content > assistant message content
            if (!generatedLabel && botMessage.content) {
              generatedLabel = generateTitleFromContent(botMessage.content);
            }
          }

          // Sync to local database
          const existingTask = await getTask(session.key);
          if (existingTask) {
            // Update existing task
            await updateTask(session.key, {
              label: generatedLabel,
              last_message: lastMessagePreview,
              message_count: messageCount,
              remote_updated_at: session.updatedAt,
            });
          } else {
            // Create new task
            await createTask({
              id: session.key,
              session_id: `bot_${session.key}`,
              task_index: 1,
              prompt: generatedLabel || 'Bot Chat',
              type: 'bot',
              label: generatedLabel,
              last_message: lastMessagePreview,
              message_count: messageCount,
              remote_updated_at: session.updatedAt,
            });
          }

          return {
            sessionKey: session.key,
            friendlyId: session.friendlyId,
            label: generatedLabel || undefined,
            messages: [], // We don't load full messages here anymore
            lastMessage: lastMessagePreview,
            messageCount: messageCount, // This might be inaccurate but is better than fetching all
            updatedAt: session.updatedAt || Date.now(),
          };
        })
      );

      // Also include local-only sessions (not in cloud)
      const localBotTasks = await getTasksByType('bot');
      const cloudKeys = new Set(sessionsData.sessions.map((s) => s.key));
      const localOnlySessions = localBotTasks
        .filter((task) => !cloudKeys.has(task.id))
        .map(taskToBotChatSession);

      // Merge and sort
      const allSessions = [...chatSessions, ...localOnlySessions];
      allSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      setSessions(allSessions);
    } catch {
      // Fallback to local data on error
      const localBotTasks = await getTasksByType('bot');
      const localSessions = localBotTasks.map(taskToBotChatSession);
      setSessions(localSessions);
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
