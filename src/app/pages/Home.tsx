import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createSession,
  deleteTask,
  getAllTasks,
  updateTask,
  type Task,
} from '@/shared/db';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import {
  subscribeToBackgroundTasks,
  type BackgroundTask,
} from '@/shared/lib/background-tasks';
import { generateSessionId } from '@/shared/lib/session';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { ArrowUpRight, Cog, FileText, FolderOpen } from 'lucide-react';

import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { ChatInput, type CategoryTag } from '@/components/shared/ChatInput';

type CategoryKey = 'organizeFiles' | 'generateDocs' | 'automateTasks';

const categoryIcons: Record<CategoryKey, React.ReactNode> = {
  organizeFiles: <FolderOpen className="size-4" />,
  generateDocs: <FileText className="size-4" />,
  automateTasks: <Cog className="size-4" />,
};

const categoryKeys: CategoryKey[] = [
  'organizeFiles',
  'generateDocs',
  'automateTasks',
];

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
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>(
    null
  );
  const navigate = useNavigate();

  const handleCategoryClick = (key: CategoryKey) => {
    setActiveCategory((prev) => (prev === key ? null : key));
    setPendingPrompt('');
  };

  const handlePromptClick = (prompt: string) => {
    setPendingPrompt(prompt);
  };

  const handleCloseCategory = () => {
    setActiveCategory(null);
    setPendingPrompt('');
  };

  const handlePendingConsumed = useCallback(() => {
    setPendingPrompt('');
  }, []);

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

  const handleSubmit = async (
    text: string,
    attachments?: MessageAttachment[]
  ) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;

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

  const categories = t.home.examplePrompts.categories;
  const activeCategoryData = activeCategory
    ? categories[activeCategory]
    : null;

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

            {/* Input Box */}
            <ChatInput
              variant="home"
              placeholder={
                activeCategoryData?.placeholder ?? t.home.inputPlaceholder
              }
              onSubmit={handleSubmit}
              className="w-full"
              autoFocus
              externalValue={pendingPrompt}
              onExternalValueConsumed={handlePendingConsumed}
              categoryTag={
                activeCategory && activeCategoryData
                  ? {
                      icon: categoryIcons[activeCategory],
                      label: activeCategoryData.label,
                      onClose: handleCloseCategory,
                    }
                  : undefined
              }
            />

            {/* Category Buttons / Prompt List */}
            {activeCategory && activeCategoryData ? (
              /* Expanded: show prompts for selected category */
              <div className="w-full">
                <div className="border-border divide-border divide-y rounded-xl border">
                  {activeCategoryData.prompts.map((prompt, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => handlePromptClick(prompt)}
                      className="text-foreground hover:bg-accent group flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm transition-colors first:rounded-t-xl last:rounded-b-xl"
                    >
                      <span className="truncate">{prompt}</span>
                      <ArrowUpRight className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Default: show category buttons */
              <div className="flex flex-wrap items-center justify-center gap-3">
                {categoryKeys.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleCategoryClick(key)}
                    className={cn(
                      'border-border bg-background text-muted-foreground flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors',
                      'hover:bg-accent hover:text-foreground'
                    )}
                  >
                    {categoryIcons[key]}
                    <span>{categories[key].label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
