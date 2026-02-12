import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '@/config';
import { deleteTask, getAllTasks, updateTask, type Task } from '@/shared/db';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import type { BotChatMessage } from '@/shared/hooks/useBotChats';
import {
  extractText,
  useOpenClawWebSocket,
  type AgentEventPayload,
  type ChatEventPayload,
} from '@/shared/hooks/useOpenClawWebSocket';
import {
  subscribeToBackgroundTasks,
  type BackgroundTask,
} from '@/shared/lib/background-tasks';
import { convertOpenClawMessage } from '@/shared/lib/bot-message-utils';
import type { BotMessage } from '@/shared/lib/bot-storage';
import {
  createNewBotSession,
  getBotSessionKey,
  getOpenClawConfig,
  loadBotMessages,
  messageToBotMessage,
  saveBotMessages,
  updateBotSessionKey,
} from '@/shared/lib/bot-storage';
import { cn } from '@/shared/lib/utils';
import { useBotChatContext } from '@/shared/providers/bot-chat-provider';
import { useLanguage } from '@/shared/providers/language-provider';
import { MessageSquare, X, Zap } from 'lucide-react';

import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { BotLoadingIndicator } from '@/components/shared/BotLoadingIndicator';
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
  const initialPromptHandledRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);

  // Track pending user messages (user message sent but not yet acknowledged)
  const pendingUserMessageRef = useRef<BotMessage | null>(null);

  // Safety timeout for loading state
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sidebar state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const { sessions: botChats, refreshSessions } = useBotChatContext();

  // State for showing all bot chats (covers main content)
  const [showAllChatsPanel, setShowAllChatsPanel] = useState(false);

  // Get OpenClaw config for WebSocket (memoized to prevent unnecessary re-subscriptions)
  const openclawConfig = useMemo(() => getOpenClawConfig(), []);

  // Helper to safely set loading state with timeout
  const setLoadingWithTimeout = useCallback((loading: boolean) => {
    // Clear existing timeout
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }

    setIsLoading(loading);

    // Set safety timeout when starting to load
    if (loading) {
      loadingTimeoutRef.current = setTimeout(() => {
        console.warn('[BotChat] Loading timeout - clearing loading state');
        setIsLoading(false);
        // Show timeout error message
        setMessages((prev) => {
          if (prev.length > 0 && prev[prev.length - 1].role === 'user') {
            const timeoutMessage: BotMessage = {
              id: `timeout_${Date.now()}`,
              role: 'assistant',
              content: '请求超时，请检查 OpenClaw Gateway 是否正常运行。',
              timestamp: new Date(),
            };
            return [...prev, timeoutMessage];
          }
          return prev;
        });
      }, 60000); // 60 seconds timeout
    }
  }, []);

  // Handle WebSocket chat events (following moltbot protocol)
  // Note: delta state is handled by the hook's chatStream state
  const handleChatEvent = useCallback(
    (payload: ChatEventPayload) => {
      console.log('[BotChat] Chat event:', payload.state, 'seq:', payload.seq);

      switch (payload.state) {
        case 'delta': {
          // Delta is handled by the hook's chatStream state
          // Just log for debugging
          console.log('[BotChat] Delta text length:', extractText(payload.message)?.length);
          break;
        }

        case 'final': {
          // Completed - add final message to history
          if (payload.message) {
            const converted = convertOpenClawMessage(payload.message);
            const assistantMessage: BotMessage = {
              id: `assistant_${Date.now()}`,
              role: converted.role,
              content: converted.content,
              timestamp: new Date(converted.timestamp || Date.now()),
              rawContent: converted.rawContent,
              toolCallId: converted.toolCallId,
              toolName: converted.toolName,
              details: converted.details,
              isError: converted.isError,
            };

            setMessages((prev) => {
              // If we have a pending user message, include it
              if (pendingUserMessageRef.current) {
                const updated = [
                  ...prev,
                  pendingUserMessageRef.current,
                  assistantMessage,
                ];
                pendingUserMessageRef.current = null;
                saveBotMessages(updated);
                return updated;
              }
              const updated = [...prev, assistantMessage];
              saveBotMessages(updated);
              return updated;
            });
          }

          setLoadingWithTimeout(false);
          refreshSessions();
          break;
        }

        case 'error': {
          // Error - show error message
          const errorMessage: BotMessage = {
            id: `error_${Date.now()}`,
            role: 'assistant',
            content:
              payload.errorMessage ||
              '抱歉，发生了错误。请确保 OpenClaw Gateway 正在运行。',
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, errorMessage]);
          setLoadingWithTimeout(false);
          pendingUserMessageRef.current = null;
          break;
        }

        case 'aborted': {
          // Aborted - clear state
          setLoadingWithTimeout(false);
          pendingUserMessageRef.current = null;
          break;
        }
      }
    },
    [refreshSessions]
  );

  // Handle agent events (tool calls)
  const handleAgentEvent = useCallback((payload: AgentEventPayload) => {
    console.log(
      '[BotChat] Agent event:',
      payload.stream,
      'phase:',
      payload.data?.phase
    );
    // Tool events are handled by the hook's toolStream state
  }, []);

  // WebSocket connection - hook manages chatStream and toolStream states
  const {
    isConnected: wsConnected,
    chatStream,
    toolStream,
    subscribe,
    unsubscribe,
  } = useOpenClawWebSocket({
    autoConnect: true,
    onChatEvent: handleChatEvent,
    onAgentEvent: handleAgentEvent,
    onError: (error) => {
      console.error('[BotChat] WebSocket error:', error);
    },
  });

  // Cleanup loading timeout on unmount
  useEffect(() => {
    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, []);

  // Subscribe to session events when sessionKey changes
  useEffect(() => {
    console.log('[BotChat] Subscribe effect triggered:', {
      sessionKey,
      wsConnected,
      hasConfig: !!openclawConfig,
    });

    if (sessionKey && openclawConfig && wsConnected) {
      console.log('[BotChat] Calling subscribe with sessionKey:', sessionKey);
      subscribe(sessionKey, openclawConfig);
    } else {
      console.log('[BotChat] Skipping subscribe - missing requirements');
    }

    return () => {
      if (sessionKey) {
        console.log('[BotChat] Unsubscribing from session:', sessionKey);
        unsubscribe(sessionKey);
      }
    };
  }, [sessionKey, openclawConfig, wsConnected, subscribe, unsubscribe]);

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

  // Handle session selection from sidebar
  const handleSelectBotChat = useCallback(
    (chatKey: string) => {
      if (chatKey === sessionKey) return;

      console.log('[BotChat] Switching to session:', chatKey);
      // Update localStorage so getBotSessionKey() returns the correct key
      updateBotSessionKey(chatKey);
      // Clear messages before loading new history
      setMessages([]);
      // Update session key (this will trigger loadChatHistory)
      setSessionKey(chatKey);
    },
    [sessionKey]
  );

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

  // Track the session key created from initialPrompt (to skip history loading for it)
  const newSessionKeyRef = useRef<string | null>(null);
  const isInitializedRef = useRef(false);

  // Initialize session key only once on mount
  useEffect(() => {
    // Skip if already initialized
    if (isInitializedRef.current) return;

    const initialPrompt = (location.state as any)?.initialPrompt;

    if (initialPrompt && !initialPromptHandledRef.current) {
      const key = createNewBotSession();
      console.log('[BotChat] Created new session for initialPrompt:', key);
      initialPromptHandledRef.current = true;
      newSessionKeyRef.current = key;
      setSessionKey(key);
      window.history.replaceState({}, document.title);
    } else {
      // Only use stored sessionKey if no sessionKey is set
      const storedKey = getBotSessionKey();
      setSessionKey(storedKey);
    }

    isInitializedRef.current = true;
  }, [location.state]);

  // Track previous session key to detect switches
  const prevSessionKeyRef = useRef<string>('');

  // Handle session changes - load history from server
  useEffect(() => {
    if (!sessionKey) return;

    // Update previous session key
    prevSessionKeyRef.current = sessionKey;

    // New session from initialPrompt doesn't need history loading
    if (newSessionKeyRef.current === sessionKey) {
      setMessages([]);
      setIsLoadingHistory(false);
      return;
    }

    // Always load history when sessionKey changes
    loadChatHistory();
  }, [sessionKey, loadChatHistory]);

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

    // Immediately add user message to UI
    setMessages((prev) => [...prev, userMessage]);

    // Store as pending in case WebSocket event arrives before we finish
    pendingUserMessageRef.current = userMessage;
    setLoadingWithTimeout(true);

    try {
      const openclawConfig = getOpenClawConfig();

      // Send message (async - returns immediately)
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

      const data = await response.json();

      if (data.status === 'accepted') {
        console.log(
          '[BotChat] Message accepted, waiting for WebSocket event...'
        );
        // The response will come via WebSocket event
        // Clear pending message since we've already added it
        pendingUserMessageRef.current = null;
      } else if (data.message) {
        // Fallback for sync response (backward compatibility)
        const botChatMessage = convertOpenClawMessage(data.message);
        const assistantMessage: BotMessage = {
          id: `assistant_${Date.now()}`,
          role: botChatMessage.role,
          content: botChatMessage.content,
          timestamp: new Date(botChatMessage.timestamp || Date.now()),
          rawContent: botChatMessage.rawContent,
          toolCallId: botChatMessage.toolCallId,
          toolName: botChatMessage.toolName,
          details: botChatMessage.details,
          isError: botChatMessage.isError,
        };
        setMessages((prev) => {
          const updated = [...prev, assistantMessage];
          saveBotMessages(updated);
          return updated;
        });
        setLoadingWithTimeout(false);
        pendingUserMessageRef.current = null;
      } else if (data.reply) {
        // Fallback for older API response
        const assistantMessage: BotMessage = {
          id: `assistant_${Date.now()}`,
          role: 'assistant',
          content: data.reply,
          timestamp: new Date(),
        };
        setMessages((prev) => {
          const updated = [...prev, assistantMessage];
          saveBotMessages(updated);
          return updated;
        });
        setLoadingWithTimeout(false);
        pendingUserMessageRef.current = null;
      } else if (data.error) {
        throw new Error(data.error);
      }

      // Refresh sessions list to update sidebar
      refreshSessions();
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
      setLoadingWithTimeout(false);
      pendingUserMessageRef.current = null;
    }
  };

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
        onSelectBotChat={handleSelectBotChat}
        onRefreshBotChats={refreshSessions}
        onShowAllBotChats={() => setShowAllChatsPanel(true)}
        onNewTask={handleNewTask}
      />

      {/* Main Content */}
      <div className="bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-sm">
        {showAllChatsPanel ? (
          /* All Bot Chats Panel - covers main content */
          <>
            {/* Panel Header */}
            <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-3">
              <h3 className="text-foreground text-sm font-medium">
                {t.nav.allChats}
              </h3>
              <button
                onClick={() => setShowAllChatsPanel(false)}
                className="text-muted-foreground hover:text-foreground flex size-6 cursor-pointer items-center justify-center rounded transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Chat List */}
            <div className="flex-1 overflow-y-auto p-4">
              {botChats && botChats.length > 0 ? (
                <div className="mx-auto max-w-2xl space-y-1">
                  {botChats.map((chat) => (
                    <div
                      key={chat.sessionKey}
                      className={cn(
                        'group flex w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-3 transition-colors',
                        sessionKey === chat.sessionKey
                          ? 'bg-accent text-accent-foreground'
                          : 'text-foreground/80 hover:bg-accent/50'
                      )}
                      onClick={() => {
                        handleSelectBotChat(chat.sessionKey);
                        setShowAllChatsPanel(false);
                      }}
                    >
                      <div className="relative shrink-0">
                        <MessageSquare className="text-muted-foreground size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {chat.label || chat.friendlyId || '新对话'}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {chat.lastMessage || `${chat.messageCount} 条消息`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-muted-foreground text-sm">
                    {t.nav.noChatsYet || '暂无聊天'}
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Normal Chat View */
          <>
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-6">
              {isLoadingHistory ? (
                <div className="p-4">
                  <BotLoadingIndicator />
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
                  streamingMessage={chatStream}
                  toolStream={toolStream}
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
          </>
        )}
      </div>
    </div>
  );
}
