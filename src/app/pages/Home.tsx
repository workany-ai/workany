import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createSession, getAllTasks, type Task } from '@/shared/db';
import { generateSessionId } from '@/shared/lib/session';
import { useLanguage } from '@/shared/providers/language-provider';
import type { MessageAttachment } from '@/shared/hooks/useAgent';

import { LeftSidebar, SidebarProvider } from '@/components/layout';
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
  const navigate = useNavigate();

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

  const handleSubmit = async (text: string, attachments?: MessageAttachment[]) => {
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
    console.log('[Home] Navigating with attachments:', attachments?.length || 0);

    navigate(`/task/${taskId}`, {
      state: {
        prompt,
        sessionId,
        taskIndex: 1,
        attachments,
      },
    });
  };

  return (
    <div className="bg-sidebar flex h-screen overflow-hidden">
      {/* Left Sidebar */}
      <LeftSidebar tasks={tasks} />

      {/* Main Content */}
      <div className="bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-sm">
        {/* Content Area - Vertically Centered */}
        <div className="flex flex-1 flex-col items-center justify-center overflow-auto px-4">
          <div className="flex w-full max-w-2xl flex-col items-center gap-6">
            {/* Title */}
            <h1 className="text-foreground text-center font-serif text-4xl font-normal tracking-tight md:text-5xl">
              {t.home.welcomeTitle}
            </h1>

            {/* Input Box - Using shared ChatInput component */}
            <ChatInput
              variant="home"
              placeholder={t.home.inputPlaceholder}
              onSubmit={handleSubmit}
              className="w-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
