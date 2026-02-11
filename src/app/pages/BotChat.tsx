import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '@/config';
import { deleteTask, getAllTasks, updateTask, type Task } from '@/shared/db';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import type { BotChatMessage } from '@/shared/hooks/useBotChats';
import {
  subscribeToBackgroundTasks,
  type BackgroundTask,
} from '@/shared/lib/background-tasks';
import type { BotMessage } from '@/shared/lib/bot-storage';
import {
  createNewBotSession,
  getBotSessionKey,
  getOpenClawConfig,
  loadBotMessages,
  messageToBotMessage,
  saveBotMessages,
} from '@/shared/lib/bot-storage';
import { cn } from '@/shared/lib/utils';
import { useBotChatContext } from '@/shared/providers/bot-chat-provider';
import { useLanguage } from '@/shared/providers/language-provider';
import { ArrowLeft, RefreshCw, Zap } from 'lucide-react';

import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { BotMessageList } from '@/components/shared/BotMessageList';
import { ChatInput } from '@/components/shared/ChatInput';

function convertToBotChatMessages(messages: BotMessage[]): BotChatMessage[] {
  return messages.map((m) => ({
    role: m.role as BotChatMessage['role'],
    content: m.content,
    timestamp: m.timestamp?.getTime(),
    rawContent: m.rawContent,
    toolCallId: m.toolCallId,
    toolName: m.toolName,
    details: m.details,
    isError: m.isError,
  }));
}

export function BotChatPage() {
  return (
    <SidebarProvider>
      <BotChatContent />
    </SidebarProvider>
  );
}

function BotChatContent() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [sessionKey, setSessionKey] = useState<string>('');
  const loadedSessionKeysRef = useRef<Set<string>>(new Set());
  const initialPromptHandledRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Sidebar state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const { sessions: botChats, refreshSessions } = useBotChatContext();

  useEffect(() => {
    const unsubscribe = subscribeToBackgroundTasks(setBackgroundTasks);
    return unsubscribe;
  }, []);

  useEffect(() => {
    async function loadTasks() {
      try {
        const allTasks = await getAllTasks();
        setTasks(allTasks);
      } catch (error) {
        console.error('Failed to load tasks:', error);
      }
    }
    loadTasks();
  }, []);

  const handleDeleteTask = async (taskId: string) => {
    try {
      await deleteTask(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const handleToggleFavorite = async (taskId: string, favorite: boolean) => {
    try {
      await updateTask(taskId, { favorite });
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, favorite } : t))
      );
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  };

  const handleNewTask = () => navigate('/');

  const loadChatHistory = useCallback(async () => {
    if (!sessionKey) return;

    setIsLoadingHistory(true);
    try {
      const openclawConfig = getOpenClawConfig();
      const response = await fetch(`${API_BASE_URL}/openclaw/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionKey,
          gatewayUrl: openclawConfig.gatewayUrl,
          authToken: openclawConfig.authToken,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.messages) {
          const historyMessages: BotMessage[] = data.messages
            .filter(
              (m: any) =>
                m.role === 'user' ||
                m.role === 'assistant' ||
                m.role === 'toolResult'
            )
            .map((m: any, index: number) =>
              messageToBotMessage(m, index, sessionKey)
            );
          setMessages(historyMessages);
          saveBotMessages(historyMessages);
        }
      }
    } catch (error) {
      console.error('[BotChat] Failed to load history:', error);
      const localMessages = loadBotMessages();
      if (localMessages.length > 0) {
        setMessages(localMessages);
      }
    } finally {
      setIsLoadingHistory(false);
    }
  }, [sessionKey]);

  useEffect(() => {
    const initialPrompt = (location.state as any)?.initialPrompt;

    let key: string;
    if (initialPrompt && !initialPromptHandledRef.current) {
      key = createNewBotSession();
      console.log('[BotChat] Created new session for initialPrompt:', key);
      initialPromptHandledRef.current = true;
      window.history.replaceState({}, document.title);
    } else {
      key = getBotSessionKey();
    }

    setSessionKey(key);

    const localMessages = loadBotMessages();
    if (localMessages.length > 0) {
      setMessages(localMessages);
    }
  }, [location.state]);

  useEffect(() => {
    if (!sessionKey || loadedSessionKeysRef.current.has(sessionKey)) {
      return;
    }
    loadedSessionKeysRef.current.add(sessionKey);
  }, [sessionKey]);

  useEffect(() => {
    const initialPrompt = (location.state as any)?.initialPrompt;
    if (
      initialPrompt &&
      sessionKey &&
      !isLoading &&
      !isLoadingHistory &&
      messages.length === 0
    ) {
      handleSubmit(initialPrompt);
    }
  }, [
    sessionKey,
    isLoading,
    isLoadingHistory,
    messages.length,
    location.state,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  // Auto-scroll
  useEffect(() => {
    if (messages.length > lastMessageCountRef.current || isLoading) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      lastMessageCountRef.current = messages.length;
    }
  }, [messages.length, isLoading]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  const handleSubmit = async (
    text: string,
    _attachments?: MessageAttachment[]
  ) => {
    if (!text.trim() || isLoading) return;

    const userMessage: BotMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    saveBotMessages(newMessages);
    setIsLoading(true);

    // Start polling history
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    pollingIntervalRef.current = setInterval(() => {
      loadChatHistory();
    }, 1000);

    try {
      const openclawConfig = getOpenClawConfig();
      const response = await fetch(`${API_BASE_URL}/openclaw/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: sessionKey,
          gatewayUrl: openclawConfig.gatewayUrl,
          authToken: openclawConfig.authToken,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      await response.json();
      // We rely on polling/history load for the assistant message
      await loadChatHistory();
    } catch (error) {
      console.error('[BotChat] Error:', error);
      const errorMessage: BotMessage = {
        id: `error_${Date.now()}`,
        role: 'assistant',
        content:
          t.common.botChatError ||
          '抱歉，发生了错误。请确保 OpenClaw Gateway 正在运行。',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }
  };

  const handleRefresh = () => loadChatHistory();

  const handleNewChat = () => {
    const newSessionKey = createNewBotSession();
    setSessionKey(newSessionKey);
    setMessages([]);
    loadedSessionKeysRef.current.add(newSessionKey);
  };

  const handleBack = () => navigate('/');

  return (
    <div className="bg-sidebar flex h-screen overflow-hidden">
      {/* Left Sidebar - Hidden for bot chat */}
      {/* Left Sidebar */}
      <LeftSidebar
        tasks={tasks}
        onDeleteTask={handleDeleteTask}
        onToggleFavorite={handleToggleFavorite}
        runningTaskIds={backgroundTasks
          .filter((t) => t.isRunning)
          .map((t) => t.taskId)}
        botChats={botChats}
        currentBotChatKey={sessionKey}
        onSelectBotChat={setSessionKey}
        onRefreshBotChats={refreshSessions}
        onNewTask={handleNewTask}
      />

      {/* Main Content */}
      <div className="bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-sm">
        {/* Messages Area */}

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoadingHistory ? (
            <div className="flex h-full items-center justify-center">
              <div className="bg-foreground/10 border-t-foreground h-8 w-8 animate-spin rounded-full border-2 border-transparent" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="bg-primary/10 text-primary mx-auto mb-4 flex size-12 items-center justify-center rounded-full">
                  <Zap className="size-6" />
                </div>
                <h3 className="text-foreground mb-2 text-lg font-semibold">
                  {t.common.botChatWelcome || '开始与 Bot 对话'}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {t.common.botChatWelcomeHint ||
                    '输入消息开始与 OpenClaw Bot 聊天'}
                </p>
              </div>
            </div>
          ) : (
            <BotMessageList
              messages={convertToBotChatMessages(messages)}
              isLoading={isLoading}
              messagesEndRef={messagesEndRef}
            />
          )}
        </div>

        {/* Input Area */}
        <div className="border-border border-t p-4">
          <div className="mx-auto max-w-3xl">
            <ChatInput
              variant="reply"
              placeholder={t.common.botChatInputPlaceholder || '输入消息...'}
              onSubmit={handleSubmit}
              isRunning={isLoading}
              disabled={isLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
