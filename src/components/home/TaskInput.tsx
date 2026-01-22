import { useNavigate } from 'react-router-dom';
import { useAgent, type MessageAttachment } from '@/shared/hooks/useAgent';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { FileText, Globe, Palette, Smartphone } from 'lucide-react';
import { nanoid } from 'nanoid';

import { ChatInput } from '@/components/shared/ChatInput';

import { AgentMessages } from './AgentMessages';

interface QuickAction {
  icon: React.ReactNode;
  label: string;
  prompt?: string;
}

const quickActions: QuickAction[] = [
  {
    icon: <FileText className="size-4" />,
    label: 'Create slides',
    prompt: '帮我创建一个演示文稿',
  },
  {
    icon: <Globe className="size-4" />,
    label: 'Build website',
    prompt: '帮我构建一个网站',
  },
  {
    icon: <Smartphone className="size-4" />,
    label: 'Develop apps',
    prompt: '帮我开发一个应用',
  },
  {
    icon: <Palette className="size-4" />,
    label: 'Design',
    prompt: '帮我设计一个界面',
  },
  { icon: null, label: 'More' },
];

export function TaskInput() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { messages, isRunning, runAgent, stopAgent, setSessionInfo } =
    useAgent();

  const handleSubmit = async (
    text: string,
    attachments?: MessageAttachment[]
  ) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;

    // Generate session info
    const sessionId = nanoid(10);
    const taskIndex = 1;
    const taskId = `${sessionId}-task-${String(taskIndex).padStart(2, '0')}`;

    // Set session info before running agent
    setSessionInfo(sessionId, taskIndex);

    // Run the agent with prompt and attachments
    // When images are attached, runAgent will use direct execution (skip planning)
    await runAgent(text, taskId, { sessionId, taskIndex }, attachments);

    // Navigate to task detail page with attachments in state
    console.log(
      '[TaskInput] Navigating with attachments:',
      attachments?.length || 0
    );
    if (attachments && attachments.length > 0) {
      attachments.forEach((a, i) => {
        console.log(
          `[TaskInput] Attachment ${i}: type=${a.type}, hasData=${!!a.data}, dataLength=${a.data?.length || 0}`
        );
      });
    }
    navigate(`/task/${taskId}`, {
      state: {
        prompt: text,
        sessionId,
        taskIndex,
        attachments,
      },
    });
  };

  const handleQuickAction = async (action: QuickAction) => {
    if (action.prompt && !isRunning) {
      await handleSubmit(action.prompt);
    }
  };

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-6">
      {/* Title */}
      <h1 className="text-foreground font-serif text-4xl font-medium">
        {t.home.welcomeTitle}
      </h1>

      {/* Input Box - Using shared ChatInput component */}
      <ChatInput
        variant="home"
        placeholder={t.home.inputPlaceholder}
        isRunning={isRunning}
        onSubmit={handleSubmit}
        onStop={stopAgent}
        className="w-full"
      />

      {/* Quick Actions */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {quickActions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => handleQuickAction(action)}
            disabled={isRunning}
            className={cn(
              'border-border bg-background text-muted-foreground flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors',
              isRunning
                ? 'cursor-not-allowed opacity-50'
                : 'hover:bg-accent hover:text-foreground'
            )}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>

      {/* Agent Messages */}
      <AgentMessages messages={messages} isRunning={isRunning} />
    </div>
  );
}
