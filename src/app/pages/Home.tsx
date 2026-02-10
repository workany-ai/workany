import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { generateSessionId } from '@/shared/lib/session';
import { useLanguage } from '@/shared/providers/language-provider';
import { MessageSquare } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Logo } from '@/components/common/logo';
import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { ChatInput } from '@/components/shared/ChatInput';
import { ThinkingBlock } from '@/components/shared/ThinkingBlock';
import {
  ToolCallBlock,
  type ToolCallPart,
} from '@/components/shared/ToolCallBlock';

// ============================================================================
// BotMessageList — shared message rendering for bot chat
// ============================================================================

function BotMessageList({
  messages,
  isSendingBotMessage,
  messagesEndRef,
}: {
  messages: BotChatMessage[];
  isSendingBotMessage: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Build toolResult lookup by toolCallId
  const toolResultsByCallId = useMemo(() => {
    const map = new Map<string, BotChatMessage>();
    for (const msg of messages) {
      if (msg.role === 'toolResult' && msg.toolCallId) {
        map.set(msg.toolCallId, msg);
      }
    }
    return map;
  }, [messages]);

  return (
    <div className="space-y-4">
      {messages.map((message, index) => {
        // Skip toolResult messages — they're rendered as part of tool calls
        if (message.role === 'toolResult') return null;

        const isUser = message.role === 'user';

        // Extract thinking content from rawContent
        const thinkingContent =
          !isUser && message.rawContent
            ? message.rawContent
                .filter((p) => p.type === 'thinking' && p.thinking)
                .map((p) => p.thinking!)
                .join('\n')
            : '';

        // Extract tool calls from rawContent
        const toolCalls =
          !isUser && message.rawContent
            ? message.rawContent.filter((p) => p.type === 'toolCall')
            : [];

        if (isUser) {
          // User message — right-aligned, matching TaskDetail's UserMessage style
          return (
            <div key={index} className="flex min-w-0 gap-3">
              <div className="min-w-0 flex-1" />
              <div className="bg-accent/50 max-w-[85%] min-w-0 rounded-xl px-4 py-3">
                <p className="text-foreground text-sm break-words whitespace-pre-wrap">
                  {message.content}
                </p>
              </div>
            </div>
          );
        }

        // Assistant message
        return (
          <div key={index} className="flex flex-col gap-2">
            {/* Thinking block */}
            {thinkingContent && <ThinkingBlock content={thinkingContent} />}

            {/* Text content — rendered with Markdown + Logo, matching TaskDetail */}
            {message.content && (
              <div className="flex min-w-0 flex-col gap-3">
                <Logo />
                <div className="prose prose-sm text-foreground max-w-none min-w-0 flex-1 overflow-hidden">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      pre: ({ children }: any) => (
                        <pre className="bg-muted max-w-full overflow-x-auto rounded-lg p-4">
                          {children}
                        </pre>
                      ),
                      code: ({ className, children, ...props }: any) => {
                        const isInline = !className;
                        if (isInline) {
                          return (
                            <code
                              className="bg-muted rounded px-1.5 py-0.5 text-sm"
                              {...props}
                            >
                              {children}
                            </code>
                          );
                        }
                        return (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
                      },
                      a: ({ children, href }: any) => (
                        <a
                          href={href}
                          onClick={async (e) => {
                            e.preventDefault();
                            if (href) {
                              try {
                                const { openUrl } =
                                  await import('@tauri-apps/plugin-opener');
                                await openUrl(href);
                              } catch {
                                window.open(href, '_blank');
                              }
                            }
                          }}
                          className="text-primary cursor-pointer hover:underline"
                        >
                          {children}
                        </a>
                      ),
                      table: ({ children }: any) => (
                        <div className="overflow-x-auto">
                          <table className="border-border border-collapse border">
                            {children}
                          </table>
                        </div>
                      ),
                      th: ({ children }: any) => (
                        <th className="border-border bg-muted border px-3 py-2 text-left">
                          {children}
                        </th>
                      ),
                      td: ({ children }: any) => (
                        <td className="border-border border px-3 py-2">
                          {children}
                        </td>
                      ),
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {/* Tool calls */}
            {toolCalls.length > 0 && (
              <div className="mt-1 flex flex-col gap-2">
                {toolCalls.map((toolCall) => {
                  const resultMsg = toolCall.id
                    ? toolResultsByCallId.get(toolCall.id)
                    : undefined;

                  const hasResult = resultMsg !== undefined;
                  const isError = resultMsg?.isError ?? false;

                  let state: ToolCallPart['state'] = 'running';
                  if (hasResult) {
                    state = isError ? 'error' : 'done';
                  }

                  let errorText: string | undefined;
                  if (isError && resultMsg?.rawContent?.[0]?.type === 'text') {
                    errorText = resultMsg.rawContent[0].text || 'Unknown error';
                  }

                  const tool: ToolCallPart = {
                    name: toolCall.name || 'unknown',
                    state,
                    input: toolCall.arguments,
                    output: resultMsg?.details,
                    toolCallId: toolCall.id,
                    errorText,
                  };

                  return (
                    <ToolCallBlock
                      key={toolCall.id || toolCall.name}
                      tool={tool}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {isSendingBotMessage && (
        <div className="flex items-center gap-3 py-2">
          <Logo />
          <div className="flex gap-1">
            <div className="bg-foreground/30 h-2 w-2 animate-bounce rounded-full [animation-delay:-0.3s]" />
            <div className="bg-foreground/30 h-2 w-2 animate-bounce rounded-full [animation-delay:-0.15s]" />
            <div className="bg-foreground/30 h-2 w-2 animate-bounce rounded-full" />
          </div>
        </div>
      )}
      {/* Scroll anchor */}
      <div ref={messagesEndRef} />
    </div>
  );
}

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
  const { sessions: botChats } = useBotChats();

  // Bot chat state
  const [selectedBotChat, setSelectedBotChat] = useState<BotChatSession | null>(
    null
  );
  const [botMessages, setBotMessages] = useState<BotChatMessage[]>([]);
  const [isLoadingBotMessages, setIsLoadingBotMessages] = useState(false);
  const [isSendingBotMessage, setIsSendingBotMessage] = useState(false);

  // Refs for tracking state and scrolling
  const isSendingMessageRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);
  const selectedBotChatKeyRef = useRef<string | null>(null);
  const pendingMessageRef = useRef<string | null>(null); // Track pending message to prevent duplicates

  const navigate = useNavigate();
  const location = useLocation();

  // Subscribe to background tasks
  useEffect(() => {
    const unsubscribe = subscribeToBackgroundTasks(setBackgroundTasks);
    return unsubscribe;
  }, []);

  // Load tasks for sidebar
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

  // Handle task deletion
  const handleDeleteTask = async (taskId: string) => {
    try {
      await deleteTask(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  // Handle favorite toggle
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

  // Handle bot chat selection - load chat directly on home page
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
              .map((m: any) => ({
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
              }));
            console.log(
              '[Home] Loaded',
              messages.length,
              'messages from history'
            );
            setBotMessages(messages);
            lastMessageCountRef.current = messages.length;
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

  // Handle sending bot message
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

      // Add user message locally
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
        console.log('[Home] Received response, success:', data.success);

        // Only add assistant message if we're still processing this message
        if (pendingMessageRef.current === trimmedText && data.reply) {
          const assistantMessage: BotChatMessage = {
            role: 'assistant',
            content: data.reply,
            timestamp: Date.now(),
          };
          console.log(
            '[Home] Adding assistant message, length:',
            assistantMessage.content.length
          );
          setBotMessages((prev) => {
            const newMessages = [...prev, assistantMessage];
            console.log(
              '[Home] Messages after adding assistant:',
              newMessages.length
            );
            return newMessages;
          });
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
    [selectedBotChat]
  );

  // Check for selected bot chat in navigation state
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

  // Auto-scroll to bottom when messages change or loading starts
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

    // Otherwise create a new task
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
        />

        {/* Main Content - Bot Chat View */}
        <div className="bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-sm">
          {/* Header */}
          {/* Messages Area - Centered content like TaskDetail */}

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
                <div className="max-w-full min-w-0 space-y-4">
                  <BotMessageList
                    messages={botMessages}
                    isSendingBotMessage={isSendingBotMessage}
                    messagesEndRef={messagesEndRef}
                  />
                </div>
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
      />

      {/* Main Content */}
      <div className="bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-sm">
        {/* Content Area - Vertically Centered */}
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
              placeholder={t.home.inputPlaceholder}
              onSubmit={handleSubmit}
              className="w-full"
              autoFocus
            />
          </div>
        </div>
      </div>
    </div>
  );
}
