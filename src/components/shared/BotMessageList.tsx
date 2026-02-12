import { useMemo } from 'react';
import type { BotChatMessage } from '@/shared/hooks/useBotChats';
import type { ToolStreamEntry } from '@/shared/hooks/useOpenClawWebSocket';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Logo } from '@/components/common/logo';
import { BotLoadingIndicator } from '@/components/shared/BotLoadingIndicator';
import { ThinkingBlock } from '@/components/shared/ThinkingBlock';
import {
  ToolCallBlock,
  type ToolCallPart,
} from '@/components/shared/ToolCallBlock';

const markdownComponents = {
  pre: ({ children }: any) => (
    <pre className="bg-muted max-w-full overflow-x-auto rounded-lg p-4">
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }: any) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="bg-muted rounded px-1.5 py-0.5 text-sm" {...props}>
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
            const { openUrl } = await import('@tauri-apps/plugin-opener');
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
      <table className="border-border border-collapse border">{children}</table>
    </div>
  ),
  th: ({ children }: any) => (
    <th className="border-border bg-muted border px-3 py-2 text-left">
      {children}
    </th>
  ),
  td: ({ children }: any) => (
    <td className="border-border border px-3 py-2">{children}</td>
  ),
};

interface BotMessageListProps {
  messages: BotChatMessage[];
  isLoading: boolean;
  messagesEndRef?: React.RefObject<HTMLDivElement | null>;
  /** Streaming message text (from delta events) */
  streamingMessage?: string | null;
  /** Active tool calls from agent events */
  toolStream?: Map<string, ToolStreamEntry>;
}

export function BotMessageList({
  messages,
  isLoading,
  messagesEndRef,
  streamingMessage,
  toolStream,
}: BotMessageListProps) {
  const toolResultsByCallId = useMemo(() => {
    const map = new Map<string, BotChatMessage>();
    for (const msg of messages) {
      if (msg.role === 'toolResult' && msg.toolCallId) {
        map.set(msg.toolCallId, msg);
      }
    }
    return map;
  }, [messages]);

  // Convert tool stream to array for display
  const activeToolCalls = useMemo(() => {
    if (!toolStream || toolStream.size === 0) return [];
    return Array.from(toolStream.values());
  }, [toolStream]);

  return (
    <div className="space-y-4">
      {messages.map((message, index) => {
        if (message.role === 'toolResult') return null;

        const isUser = message.role === 'user';

        // Filter rawContent to only include valid types (exclude debug/metadata)
        const validTypes = new Set([
          'text',
          'thinking',
          'toolCall',
          'toolResult',
        ]);
        const filteredRawContent =
          message.rawContent?.filter((p) => p.type && validTypes.has(p.type)) ||
          [];

        const thinkingContent =
          !isUser && filteredRawContent.length > 0
            ? filteredRawContent
                .filter((p) => p.type === 'thinking' && p.thinking)
                .map((p) => p.thinking!)
                .join('\n')
            : '';

        const toolCalls =
          !isUser && filteredRawContent.length > 0
            ? filteredRawContent.filter((p) => p.type === 'toolCall')
            : [];

        if (isUser) {
          return (
            <div key={index} className="flex min-w-0 gap-3">
              <div className="min-w-0 flex-1" />
              <div className="bg-accent/50 max-w-[85%] min-w-0 rounded-xl px-4 py-3">
                <p className="text-foreground text-sm wrap-break-word whitespace-pre-wrap">
                  {message.content}
                </p>
              </div>
            </div>
          );
        }

        return (
          <div key={index} className="flex flex-col gap-2">
            {thinkingContent && <ThinkingBlock content={thinkingContent} />}
            {message.content && (
              <div className="flex min-w-0 flex-col gap-3">
                <Logo />
                <div className="prose prose-sm text-foreground max-w-none min-w-0 flex-1 overflow-hidden">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
              </div>
            )}
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

      {/* Streaming message display (delta state) */}
      {streamingMessage && (
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 flex-col gap-3">
            <Logo />
            <div className="prose prose-sm text-foreground max-w-none min-w-0 flex-1 overflow-hidden">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {streamingMessage}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}

      {/* Active tool calls from agent events */}
      {activeToolCalls.length > 0 && (
        <div className="flex flex-col gap-2">
          {activeToolCalls.map((tool) => {
            const state: ToolCallPart['state'] =
              tool.phase === 'result' ? 'done' : 'running';

            const toolPart: ToolCallPart = {
              name: tool.name,
              state,
              input: tool.args,
              output: tool.output ? JSON.parse(tool.output) : undefined,
              toolCallId: tool.toolCallId,
            };

            return <ToolCallBlock key={tool.toolCallId} tool={toolPart} />;
          })}
        </div>
      )}

      {/* Show loading indicator when no streaming message */}
      {isLoading && !streamingMessage && activeToolCalls.length === 0 && (
        <BotLoadingIndicator />
      )}

      {messagesEndRef && <div ref={messagesEndRef} />}
    </div>
  );
}
