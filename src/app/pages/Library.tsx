import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllTasks, type Task } from '@/shared/db';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { Search } from 'lucide-react';

function formatRelativeTime(
  dateStr: string,
  t: {
    justNow: string;
    minuteAgo: string;
    minutesAgo: string;
    hourAgo: string;
    hoursAgo: string;
    dayAgo: string;
    daysAgo: string;
  }
): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return t.justNow;
  if (diffMinutes < 60) return (diffMinutes === 1 ? t.minuteAgo : t.minutesAgo).replace('{count}', String(diffMinutes));
  if (diffHours < 24) return (diffHours === 1 ? t.hourAgo : t.hoursAgo).replace('{count}', String(diffHours));
  if (diffDays === 1) return t.dayAgo;
  return t.daysAgo.replace('{count}', String(diffDays));
}

export function LibraryPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());

  useEffect(() => {
    getAllTasks()
      .then(setTasks)
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return tasks;
    const query = searchQuery.toLowerCase();
    return tasks.filter((task) => task.prompt.toLowerCase().includes(query));
  }, [tasks, searchQuery]);

  const handleTaskClick = (taskId: string) => {
    if (selectMode) {
      setSelectedTasks((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(taskId)) newSet.delete(taskId);
        else newSet.add(taskId);
        return newSet;
      });
    } else {
      navigate(`/task/${taskId}`);
    }
  };

  const handleSelectToggle = () => {
    if (selectMode) {
      setSelectMode(false);
      setSelectedTasks(new Set());
    } else {
      setSelectMode(true);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="relative mb-6">
          <Search className="text-muted-foreground absolute top-1/2 left-4 size-5 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.library.searchPlaceholder}
            className="border-primary/30 bg-background text-foreground placeholder:text-muted-foreground focus:border-primary h-14 w-full rounded-xl border-2 pr-4 pl-12 text-lg transition-colors focus:outline-none"
          />
        </div>

        <div className="mb-2 flex items-center gap-3 px-1">
          <span className="text-muted-foreground text-sm">
            {(filteredTasks.length === 1
              ? t.library.chatsCount
              : t.library.chatsCountPlural
            ).replace('{count}', String(filteredTasks.length))}
          </span>
          <button onClick={handleSelectToggle} className="text-primary cursor-pointer text-sm font-medium hover:underline">
            {selectMode ? t.library.cancel : t.library.select}
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-muted-foreground flex items-center gap-3">
              <div className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              <span>{t.library.loading}</span>
            </div>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <h3 className="text-foreground mb-2 text-lg font-medium">
              {searchQuery ? t.library.noChatsFound : t.library.noChatsYet}
            </h3>
            <p className="text-muted-foreground text-sm">
              {searchQuery ? t.library.adjustSearch : t.library.startNewTask}
            </p>
          </div>
        ) : (
          <div className="border-border border-t">
            {filteredTasks.map((task) => (
              <button
                key={task.id}
                onClick={() => handleTaskClick(task.id)}
                className={cn(
                  'border-border hover:bg-accent/30 flex w-full cursor-pointer items-start gap-3 border-b px-1 py-5 text-left transition-colors',
                  selectMode && selectedTasks.has(task.id) && 'bg-accent/50'
                )}
              >
                {selectMode && (
                  <div className={cn(
                    'mt-1 flex size-5 shrink-0 items-center justify-center rounded border-2 transition-colors',
                    selectedTasks.has(task.id) ? 'bg-primary border-primary' : 'border-muted-foreground/50'
                  )}>
                    {selectedTasks.has(task.id) && (
                      <svg className="text-primary-foreground size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="text-foreground truncate text-base font-medium">{task.prompt || t.library.untitled}</h3>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    {t.library.lastMessage} {formatRelativeTime(task.updated_at || task.created_at, t.library)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
