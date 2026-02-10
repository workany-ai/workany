/**
 * Bot Chat Page
 *
 * Dedicated page for OpenClaw Bot chat, separate from local tasks.
 * Maintains persistent session and chat history.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '@/config';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
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
import { useLanguage } from '@/shared/providers/language-provider';
import { ArrowLeft, RefreshCw, Zap } from 'lucide-react';
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
// Components
// ============================================================================

function BotChatMessageList({
  messages,
  isLoading,
}: {
  messages: BotMessage[];
  isLoading: boolean;
}) {
  // Build toolResult lookup by toolCallId
  const toolResultsByCallId = useMemo(() => {
    const map = new Map<string, BotMessage>();
    for (const msg of messages) {
      if (msg.role === 'toolResult' && msg.toolCallId) {
        map.set(msg.toolCallId, msg);
      }
    }
    return map;
  }, [messages]);

  return (
    <div className="space-y-4">
      {messages.map((message) => {
        // Skip toolResult messages — rendered as part of tool calls
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
            <div key={message.id} className="flex min-w-0 gap-3">
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
          <div key={message.id} className="flex flex-col gap-2">
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
      {isLoading && (
        <div className="flex items-center gap-3 py-2">
          <Logo />
          <div className="flex gap-1">
            <div className="bg-foreground/30 h-2 w-2 animate-bounce rounded-full [animation-delay:-0.3s]" />
            <div className="bg-foreground/30 h-2 w-2 animate-bounce rounded-full [animation-delay:-0.15s]" />
            <div className="bg-foreground/30 h-2 w-2 animate-bounce rounded-full" />
          </div>
        </div>
      )}
    </div>
  );
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
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [sessionKey, setSessionKey] = useState<string>('');
  const loadedSessionKeysRef = useRef<Set<string>>(new Set());

  // Load chat history from Gateway
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

  // Initialize session key on mount
  useEffect(() => {
    const key = getBotSessionKey();
    setSessionKey(key);

    const localMessages = loadBotMessages();
    if (localMessages.length > 0) {
      setMessages(localMessages);
    }
  }, []);

  // Load history for new sessions
  useEffect(() => {
    if (!sessionKey || loadedSessionKeysRef.current.has(sessionKey)) {
      return;
    }
    loadChatHistory();
    loadedSessionKeysRef.current.add(sessionKey);
  }, [sessionKey, loadChatHistory]);

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

      const data = await response.json();

      if (data.reply) {
        const assistantMessage: BotMessage = {
          id: `assistant_${Date.now()}`,
          role: 'assistant',
          content: data.reply,
          timestamp: new Date(),
        };
        const updatedMessages = [...newMessages, assistantMessage];
        setMessages(updatedMessages);
        saveBotMessages(updatedMessages);
      } else if (data.error) {
        throw new Error(data.error);
      }
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
      const updatedMessages = [...newMessages, errorMessage];
      setMessages(updatedMessages);
      saveBotMessages(updatedMessages);
    } finally {
      setIsLoading(false);
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
      <LeftSidebar
        tasks={[]}
        onDeleteTask={() => {}}
        onToggleFavorite={() => {}}
        runningTaskIds={[]}
      />

      {/* Main Content */}
      <div className="bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-sm">
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-5" />
            </button>
            <div className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
              <Zap className="size-4" />
            </div>
            <div>
              <h2 className="text-foreground text-lg font-semibold">
                {t.common.botChatTitle || 'Bot 聊天'}
              </h2>
              <p className="text-muted-foreground text-xs">
                {t.common.botChatDescription || '与 OpenClaw Bot 对话'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={isLoadingHistory}
              className="text-muted-foreground hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              title="刷新历史"
            >
              <RefreshCw
                className={cn('size-4', isLoadingHistory && 'animate-spin')}
              />
            </button>
            <button
              onClick={handleNewChat}
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
              title="新建对话"
            >
              新建对话
            </button>
          </div>
        </div>

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
            <BotChatMessageList messages={messages} isLoading={isLoading} />
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
