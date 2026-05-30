import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createSession } from '@/shared/db';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import { generateSessionId } from '@/shared/lib/session';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { ArrowUpRight, Cog, FileText, FolderOpen } from 'lucide-react';

import { ChatInput, type ChatMode } from '@/components/shared/ChatInput';

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
  const { t } = useLanguage();
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>(null);
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

  const handleSubmit = async (
    text: string,
    attachments?: MessageAttachment[],
    mode?: ChatMode
  ) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;

    const prompt = text.trim();
    const sessionId = generateSessionId(prompt);
    try {
      await createSession({ id: sessionId, prompt });
    } catch (error) {
      console.error('[Home] Failed to create session:', error);
    }

    const taskId = Date.now().toString();
    navigate(`/task/${taskId}`, {
      state: {
        prompt,
        sessionId,
        taskIndex: 1,
        attachments,
        mode,
      },
    });
  };

  const categories = t.home.examplePrompts.categories;
  const activeCategoryData = activeCategory ? categories[activeCategory] : null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-auto px-4">
      <div className="flex w-full max-w-2xl flex-col items-center gap-6">
        <h1 className="text-foreground text-center font-serif text-4xl font-normal tracking-tight md:text-5xl">
          {t.home.welcomeTitle}
        </h1>

        <ChatInput
          variant="home"
          placeholder={activeCategoryData?.placeholder ?? t.home.inputPlaceholder}
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

        {activeCategory && activeCategoryData ? (
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
  );
}
