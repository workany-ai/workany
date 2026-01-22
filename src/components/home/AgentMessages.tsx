import type { AgentMessage } from '@/shared/hooks/useAgent';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  AlertCircle,
  Box,
  CheckCircle,
  FileText,
  Globe,
  Monitor,
  Search,
  Terminal,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AgentMessagesProps {
  messages: AgentMessage[];
  isRunning: boolean;
}

// Detect execution environment from tool name
function getExecutionEnv(toolName: string): 'sandbox' | 'local' | null {
  if (toolName.includes('sandbox')) {
    return 'sandbox';
  }
  if (toolName === 'Bash') {
    return 'local';
  }
  return null;
}

// Get display name for tool (simplify sandbox tool names)
function getToolDisplayName(toolName: string): string {
  if (toolName.startsWith('mcp__sandbox__')) {
    // mcp__sandbox__sandbox_run_script -> run_script
    return toolName.replace('mcp__sandbox__sandbox_', '');
  }
  return toolName;
}

function getToolIcon(toolName: string) {
  // Check for sandbox tools
  if (toolName.includes('sandbox_run')) {
    return <Box className="size-4" />;
  }

  switch (toolName) {
    case 'Bash':
      return <Terminal className="size-4" />;
    case 'Read':
    case 'Edit':
    case 'Write':
      return <FileText className="size-4" />;
    case 'Glob':
    case 'Grep':
      return <Search className="size-4" />;
    case 'WebSearch':
      return <Globe className="size-4" />;
    default:
      return <Terminal className="size-4" />;
  }
}

export function AgentMessages({ messages, isRunning }: AgentMessagesProps) {
  const { t } = useLanguage();

  if (messages.length === 0 && !isRunning) {
    return null;
  }

  return (
    <div className="mt-6 w-full max-w-3xl space-y-3">
      {messages.map((message, index) => (
        <div
          key={index}
          className="animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          {message.type === 'text' &&
            message.content &&
            // Skip rendering if content is plan JSON (already rendered by PlanApproval)
            !message.content.trim().startsWith('{"type":"plan"') &&
            !message.content.trim().startsWith('{"type": "plan"') && (
              <div className="bg-card text-card-foreground prose prose-sm dark:prose-invert max-w-none rounded-lg p-4">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ children, href }) => (
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
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )}

          {message.type === 'tool_use' &&
            (() => {
              const toolName = message.name || '';
              const execEnv = getExecutionEnv(toolName);
              const displayName = getToolDisplayName(toolName);

              return (
                <div className="bg-muted text-muted-foreground flex items-center gap-2 rounded-lg p-3 text-sm">
                  {getToolIcon(toolName)}
                  <span className="font-medium">{displayName}</span>
                  {execEnv && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        execEnv === 'sandbox'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                      }`}
                    >
                      {execEnv === 'sandbox' ? (
                        <>
                          <Box className="size-3" />
                          沙盒
                        </>
                      ) : (
                        <>
                          <Monitor className="size-3" />
                          本地
                        </>
                      )}
                    </span>
                  )}
                  {message.input !== undefined && message.input !== null && (
                    <span className="max-w-md truncate text-xs opacity-70">
                      {typeof message.input === 'string'
                        ? message.input
                        : JSON.stringify(
                            message.input as Record<string, unknown>
                          ).slice(0, 100)}
                    </span>
                  )}
                </div>
              );
            })()}

          {message.type === 'result' && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
              <CheckCircle className="size-4" />
              <span>
                完成 ({message.subtype})
                {message.cost && ` · $${message.cost.toFixed(4)}`}
                {message.duration &&
                  ` · ${(message.duration / 1000).toFixed(1)}s`}
              </span>
            </div>
          )}

          {message.type === 'error' && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              <AlertCircle className="size-4" />
              <span>{message.message}</span>
            </div>
          )}
        </div>
      ))}

      {isRunning && (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <div className="bg-primary size-2 animate-pulse rounded-full" />
          <span>{t.task.thinking}</span>
        </div>
      )}
    </div>
  );
}
