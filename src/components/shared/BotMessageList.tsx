import { useMemo } from 'react';
import type { BotChatMessage } from '@/shared/hooks/useBotChats';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Logo } from '@/components/common/logo';
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
}

export function BotMessageList({
  messages,
  isLoading,
  messagesEndRef,
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
      {messagesEndRef && <div ref={messagesEndRef} />}
    </div>
  );
}
