import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '@/config';
import {
  createSession,
  deleteTask,
  getAllTasks,
  updateTask,
  type Task,
} from '@/shared/db';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import {
  useBotChats,
  type BotChatMessage,
  type BotChatSession,
} from '@/shared/hooks/useBotChats';
import {
  subscribeToBackgroundTasks,
  type BackgroundTask,
} from '@/shared/lib/background-tasks';
import { convertOpenClawMessage } from '@/shared/lib/bot-message-utils';
import { generateSessionId } from '@/shared/lib/session';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { MessageSquare, SquarePen, X, Zap } from 'lucide-react';

import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { BotMessageList } from '@/components/shared/BotMessageList';
import { ChatInput } from '@/components/shared/ChatInput';

export function HomePage() {
  return (
    <SidebarProvider>
      <HomeContent />
    </SidebarProvider>
  );
}

function HomeContent() {
  const { t } = useLanguage();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const { sessions: botChats, refreshSessions } = useBotChats();

  // Bot chat state
  const [selectedBotChat, setSelectedBotChat] = useState<BotChatSession | null>(
    null
  );
  const [botMessages, setBotMessages] = useState<BotChatMessage[]>([]);
  const [isLoadingBotMessages, setIsLoadingBotMessages] = useState(false);
  const [isSendingBotMessage, setIsSendingBotMessage] = useState(false);

  const [taskMode, setTaskMode] = useState<'local' | 'bot'>('local');

  // State for showing all bot chats (covers main content)
  const [showAllChatsPanel, setShowAllChatsPanel] = useState(false);

  const isSendingMessageRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);
  const selectedBotChatKeyRef = useRef<string | null>(null);
  const pendingMessageRef = useRef<string | null>(null);

  const navigate = useNavigate();
  const location = useLocation();

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

  const handleSelectBotChat = useCallback(
    async (chatKey: string) => {
      console.log(
        '[Home] handleSelectBotChat called with chatKey:',
        chatKey,
        'isSending:',
        isSendingMessageRef.current,
        'pendingMessage:',
        pendingMessageRef.current
      );

      // Don't reload if we're sending a message (prevents duplicate messages)
      if (isSendingMessageRef.current) {
        console.log('[Home] Skipping load - sending message');
        return;
      }

      // Use a ref to track current message count for the "already loaded" check
      if (selectedBotChatKeyRef.current === chatKey) {
        console.log('[Home] Skipping load - already viewing this chat');
        return;
      }

      const chat = botChats.find((c) => c.sessionKey === chatKey);
      if (!chat) {
        console.log('[Home] Chat not found:', chatKey);
        return;
      }

      // Clear any pending message state when switching chats
      pendingMessageRef.current = null;
      selectedBotChatKeyRef.current = chatKey;
      setSelectedBotChat(chat);
      setIsLoadingBotMessages(true);

      try {
        const openClawConfig = localStorage.getItem('openclaw_config');
        if (!openClawConfig) {
          console.error('[Home] No OpenClaw config found');
          return;
        }

        const config = JSON.parse(openClawConfig);
        console.log('[Home] Fetching history for chatKey:', chatKey);
        const response = await fetch(`${API_BASE_URL}/openclaw/history`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionKey: chatKey,
            gatewayUrl: config.gatewayUrl,
            authToken: config.authToken,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.messages) {
            const messages: BotChatMessage[] = data.messages
              .filter(
                (m: any) =>
                  m.role === 'user' ||
                  m.role === 'assistant' ||
                  m.role === 'toolResult'
              )
              .map(convertOpenClawMessage);
            console.log(
              '[Home] Loaded',
              messages.length,
              'messages from history'
            );
            setBotMessages(messages);
            lastMessageCountRef.current = messages.length;
            // Scroll to bottom after loading messages
            setTimeout(() => {
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 100);
          }
        }
      } catch (error) {
        console.error('[Home] Failed to load bot chat messages:', error);
      } finally {
        setIsLoadingBotMessages(false);
      }
    },
    [botChats]
  );

  /**
   * Poll for new assistant messages (Home version)
   */
  const pollForAssistantMessage = useCallback(
    async (
      sessionKey: string,
      config: { gatewayUrl: string; authToken: string },
      existingMessageCount: number,
      maxAttempts = 60,
      pollDelay = 1000
    ): Promise<BotChatMessage | null> => {
      for (let attempts = 0; attempts < maxAttempts; attempts++) {
        await new Promise((resolve) => setTimeout(resolve, pollDelay));

        try {
          const response = await fetch(`${API_BASE_URL}/openclaw/history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionKey,
              gatewayUrl: config.gatewayUrl,
              authToken: config.authToken,
            }),
          });

          if (!response.ok) continue;

          const data = await response.json();
          if (!data.success || !data.messages) continue;

          const assistantMessages = data.messages.filter(
            (m: any) => m.role === 'assistant'
          );

          // Check for new assistant messages
          if (assistantMessages.length > existingMessageCount) {
            const lastMessage = assistantMessages.sort(
              (a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0)
            )[0];

            if (lastMessage?.content?.length > 0) {
              return convertOpenClawMessage(lastMessage);
            }
          }
        } catch (error) {
          console.warn('[Home] Polling error:', error);
        }
      }

      return null;
    },
    []
  );

  const handleSendBotMessage = useCallback(
    async (text: string) => {
      const trimmedText = text.trim();
      if (!trimmedText || !selectedBotChat) return;

      // Check if this exact message is already being processed
      if (
        isSendingMessageRef.current &&
        pendingMessageRef.current === trimmedText
      ) {
        console.log('[Home] Skipping - already sending this message');
        return;
      }

      // Mark as sending and store pending message
      isSendingMessageRef.current = true;
      pendingMessageRef.current = trimmedText;

      // Add user message locally (immediately)
      const userMessage: BotChatMessage = {
        role: 'user',
        content: trimmedText,
        timestamp: Date.now(),
      };
      console.log('[Home] Adding user message:', userMessage);
      setBotMessages((prev) => {
        const newMessages = [...prev, userMessage];
        console.log('[Home] Messages after adding user:', newMessages.length);
        return newMessages;
      });
      setIsSendingBotMessage(true);

      // Count existing assistant messages before sending
      let existingAssistantCount = 0;
      try {
        const openClawConfig = localStorage.getItem('openclaw_config');
        if (openClawConfig) {
          const config = JSON.parse(openClawConfig);
          const historyResponse = await fetch(
            `${API_BASE_URL}/openclaw/history`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionKey: selectedBotChat.sessionKey,
                gatewayUrl: config.gatewayUrl,
                authToken: config.authToken,
              }),
            }
          );
          if (historyResponse.ok) {
            const historyData = await historyResponse.json();
            existingAssistantCount =
              historyData.messages?.filter((m: any) => m.role === 'assistant')
                .length ?? 0;
          }
        }
      } catch {
        // Ignore errors in counting
      }

      try {
        const openClawConfig = localStorage.getItem('openclaw_config');
        if (!openClawConfig) {
          throw new Error('No OpenClaw config found');
        }

        const config = JSON.parse(openClawConfig);
        console.log(
          '[Home] Sending to API, sessionKey:',
          selectedBotChat.sessionKey
        );
        const response = await fetch(`${API_BASE_URL}/openclaw/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: trimmedText,
            sessionId: selectedBotChat.sessionKey,
            gatewayUrl: config.gatewayUrl,
            authToken: config.authToken,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to send message');
        }

        const data = await response.json();
        console.log('[Home] Received response, status:', data.status);

        // Handle async response - poll for result
        if (data.status === 'accepted') {
          console.log('[Home] Message accepted, polling for response...');
          const assistantMessage = await pollForAssistantMessage(
            selectedBotChat.sessionKey,
            config,
            existingAssistantCount
          );

          if (assistantMessage && pendingMessageRef.current === trimmedText) {
            console.log(
              '[Home] Adding assistant message, length:',
              assistantMessage.content.length
            );
            setBotMessages((prev) => [...prev, assistantMessage]);
          } else if (!assistantMessage) {
            throw new Error('Response timeout');
          }
        } else if (pendingMessageRef.current === trimmedText && data.message) {
          // Fallback for sync response
          const assistantMessage = convertOpenClawMessage(data.message);
          console.log(
            '[Home] Adding assistant message, length:',
            assistantMessage.content.length
          );
          setBotMessages((prev) => [...prev, assistantMessage]);
        } else if (data.reply) {
          // Backward compatibility
          const assistantMessage: BotChatMessage = {
            role: 'assistant',
            content: data.reply,
            timestamp: Date.now(),
          };
          setBotMessages((prev) => [...prev, assistantMessage]);
        } else if (data.error) {
          throw new Error(data.error);
        }
      } catch (error) {
        console.error('[Home] Bot chat error:', error);
        // Add error message
        const errorMessage: BotChatMessage = {
          role: 'assistant',
          content: '抱歉，发生了错误。请确保 OpenClaw Gateway 正在运行。',
          timestamp: Date.now(),
        };
        setBotMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsSendingBotMessage(false);
        // Clear all flags
        isSendingMessageRef.current = false;
        pendingMessageRef.current = null;
        console.log('[Home] Message sending complete, all refs cleared');
      }
    },
    [selectedBotChat, pollForAssistantMessage]
  );

  const handleNewTask = useCallback(() => {
    setSelectedBotChat(null);
    setBotMessages([]);
    selectedBotChatKeyRef.current = null;
    pendingMessageRef.current = null;
    lastMessageCountRef.current = 0;
    navigate('/');
  }, [navigate]);

  useEffect(() => {
    if (
      location.state &&
      (location.state as any).selectedBotChatKey &&
      botChats.length > 0
    ) {
      const sessionKey = (location.state as any).selectedBotChatKey;
      const session = botChats.find((s) => s.sessionKey === sessionKey);
      if (session) {
        handleSelectBotChat(sessionKey);
        // Clear state to prevent re-selection on reload
        window.history.replaceState({}, document.title);
      }
    }
  }, [location.state, botChats, handleSelectBotChat]);

  useEffect(() => {
    if (
      botMessages.length > 0 &&
      (botMessages.length !== lastMessageCountRef.current ||
        isSendingBotMessage)
    ) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      lastMessageCountRef.current = botMessages.length;
    }
  }, [botMessages, isSendingBotMessage]);

  const handleSubmit = async (
    text: string,
    attachments?: MessageAttachment[]
  ) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;

    // If bot chat is selected, send as bot message
    if (selectedBotChat) {
      handleSendBotMessage(text);
      return;
    }

    // Bot mode: navigate to /bot with the prompt
    if (taskMode === 'bot') {
      const openClawConfig = localStorage.getItem('openclaw_config');
      if (!openClawConfig) {
        // Not configured, switch back to local and alert
        setTaskMode('local');
        return;
      }
      navigate('/bot', { state: { initialPrompt: text.trim() } });
      return;
    }

    // Otherwise create a new local task
    const prompt = text.trim();

    // Create a new session
    const sessionId = generateSessionId(prompt);
    try {
      await createSession({ id: sessionId, prompt });
      console.log('[Home] Created new session:', sessionId);
    } catch (error) {
      console.error('[Home] Failed to create session:', error);
    }

    // Generate task ID and navigate with attachments
    const taskId = Date.now().toString();
    console.log(
      '[Home] Navigating with attachments:',
      attachments?.length || 0
    );

    navigate(`/task/${taskId}`, {
      state: {
        prompt,
        sessionId,
        taskIndex: 1,
        attachments,
      },
    });
  };

  // If a bot chat is selected, show bot chat view
  if (selectedBotChat) {
    return (
      <div className="bg-sidebar flex h-screen overflow-hidden">
        {/* Left Sidebar */}
        <LeftSidebar
          tasks={tasks}
          onDeleteTask={handleDeleteTask}
          onToggleFavorite={handleToggleFavorite}
          runningTaskIds={backgroundTasks
            .filter((t) => t.isRunning)
            .map((t) => t.taskId)}
          botChats={botChats}
          currentBotChatKey={selectedBotChat.sessionKey}
          onSelectBotChat={handleSelectBotChat}
          onRefreshBotChats={refreshSessions}
          onShowAllBotChats={() => setShowAllChatsPanel(true)}
          onNewTask={handleNewTask}
        />

        {/* Main Content - Bot Chat View */}
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
                          selectedBotChat?.sessionKey === chat.sessionKey
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
              {/* Messages Area - Centered content like TaskDetail */}
              <div className="relative flex flex-1 justify-center overflow-x-hidden overflow-y-auto">
                <div className="w-full max-w-[800px] px-6 pt-4 pb-24">
                  {isLoadingBotMessages ? (
                    <div className="flex min-h-[200px] items-center justify-center py-12">
                      <div className="text-muted-foreground flex items-center gap-3">
                        <div className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        <span>加载中...</span>
                      </div>
                    </div>
                  ) : botMessages.length === 0 ? (
                    <div className="flex min-h-[200px] items-center justify-center py-12">
                      <div className="text-center">
                        <div className="bg-primary/10 text-primary mx-auto mb-4 flex size-12 items-center justify-center rounded-full">
                          <MessageSquare className="size-6" />
                        </div>
                        <h3 className="text-foreground mb-2 text-lg font-semibold">
                          开始对话
                        </h3>
                        <p className="text-muted-foreground text-sm">
                          输入消息开始与 Bot 聊天
                        </p>
                      </div>
                    </div>
                  ) : (
                    <BotMessageList
                      messages={botMessages}
                      isLoading={isSendingBotMessage}
                      messagesEndRef={messagesEndRef}
                    />
                  )}
                </div>
              </div>

              {/* Reply Input - Centered like TaskDetail */}
              <div className="border-border/50 bg-background relative flex shrink-0 justify-center border-none">
                <div className="w-full max-w-[800px] px-4 py-3">
                  <ChatInput
                    variant="reply"
                    placeholder="输入消息..."
                    onSubmit={handleSendBotMessage}
                    isRunning={isSendingBotMessage}
                    disabled={isSendingBotMessage}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // Default home view
  return (
    <div className="bg-sidebar flex h-screen overflow-hidden">
      {/* Left Sidebar */}
      <LeftSidebar
        tasks={tasks}
        onDeleteTask={handleDeleteTask}
        onToggleFavorite={handleToggleFavorite}
        runningTaskIds={backgroundTasks
          .filter((t) => t.isRunning)
          .map((t) => t.taskId)}
        botChats={botChats}
        onSelectBotChat={handleSelectBotChat}
        onRefreshBotChats={refreshSessions}
        onShowAllBotChats={() => setShowAllChatsPanel(true)}
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
                      className="text-foreground/80 hover:bg-accent/50 flex w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-3 transition-colors"
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
          /* Normal Home View */
          <div className="flex flex-1 flex-col items-center justify-center overflow-auto px-4">
            <div className="flex w-full max-w-2xl flex-col items-center gap-6">
              {/* Title */}
              <h1 className="text-foreground text-center font-serif text-4xl font-normal tracking-tight md:text-5xl">
                {t.home.welcomeTitle}
              </h1>

              {/* Description */}
              <p className="text-muted-foreground text-center text-sm">
                {t.home.welcomeSubtitle}
              </p>

              {/* Input Box - Using shared ChatInput component */}
              <ChatInput
                variant="home"
                placeholder={
                  taskMode === 'bot'
                    ? t.home.botInputPlaceholder || 'Ask Bot anything...'
                    : t.home.inputPlaceholder
                }
                onSubmit={handleSubmit}
                className="w-full"
                autoFocus
                bottomContent={
                  <div className="bg-muted/50 flex items-center gap-1 rounded-lg p-1">
                    <button
                      onClick={() => setTaskMode('local')}
                      className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                        taskMode === 'local'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <SquarePen className="size-3.5" />
                      {t.nav.localTask}
                    </button>
                    <button
                      onClick={() => {
                        const openClawConfig =
                          localStorage.getItem('openclaw_config');
                        if (!openClawConfig) {
                          alert(
                            t.common.configureOpenClawFirst ||
                              'Please configure OpenClaw first in Settings'
                          );
                          return;
                        }
                        setTaskMode('bot');
                      }}
                      className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                        taskMode === 'bot'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Zap className="size-3.5" />
                      {t.nav.botTask}
                    </button>
                  </div>
                }
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
