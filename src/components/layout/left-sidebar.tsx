import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ImageLogo from '@/assets/logo.png';
import type { Task } from '@/shared/db';
import { getSettings, type UserProfile } from '@/shared/db/settings';
import type { BotChatSession } from '@/shared/hooks/useBotChats';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  Calendar,
  ChevronsUpDown,
  FileText,
  Globe,
  ListTodo,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  RefreshCw,
  Settings,
  Smartphone,
  Sparkles,
  SquarePen,
  Star,
  Trash2,
  User,
} from 'lucide-react';

import { SettingsModal } from '@/components/settings';
import type { SettingsCategory } from '@/components/settings/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { useSidebar } from './sidebar-context';

interface LeftSidebarProps {
  tasks: Task[];
  currentTaskId?: string;
  onDeleteTask?: (taskId: string) => void;
  onToggleFavorite?: (taskId: string, favorite: boolean) => void;
  runningTaskIds?: string[];
  botChats?: BotChatSession[];
  currentBotChatKey?: string;
  onSelectBotChat?: (chatKey: string) => void;
  onRefreshBotChats?: () => void;
  onNewTask?: () => void;
}

function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  t: ReturnType<typeof useLanguage>['t'];
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
      />
      <div className="bg-background border-border relative w-[400px] max-w-[90vw] rounded-lg border p-6 shadow-xl">
        <h3 className="text-foreground text-lg font-semibold">
          {t.common.deleteTaskConfirm}
        </h3>
        <p className="text-muted-foreground mt-2 text-sm">
          {t.common.deleteTaskDescription}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => onOpenChange(false)}
            className="border-border hover:bg-accent rounded-lg border px-4 py-2 text-sm transition-colors"
          >
            {t.common.cancel}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm text-white transition-colors hover:bg-red-600"
          >
            {t.common.delete}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatSettingsButton({
  hasConfig,
  onRefresh,
  onOpenSettings,
}: {
  hasConfig: boolean;
  onRefresh?: () => void;
  onOpenSettings: () => void;
}) {
  const baseClassName =
    'text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 flex size-5 cursor-pointer items-center justify-center rounded transition-colors';

  return hasConfig ? (
    <button onClick={onRefresh} className={baseClassName} title="Refresh chats">
      <RefreshCw className="size-3" />
    </button>
  ) : (
    <button onClick={onOpenSettings} className={baseClassName} title="Settings">
      <Settings className="size-3" />
    </button>
  );
}

function getTaskIcon(prompt: string) {
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes('网站') || lowerPrompt.includes('website')) {
    return Globe;
  }
  if (lowerPrompt.includes('应用') || lowerPrompt.includes('app')) {
    return Smartphone;
  }
  if (lowerPrompt.includes('设计') || lowerPrompt.includes('design')) {
    return Sparkles;
  }
  if (lowerPrompt.includes('文档') || lowerPrompt.includes('doc')) {
    return FileText;
  }
  return Calendar;
}

export function LeftSidebar({
  tasks,
  currentTaskId,
  onDeleteTask,
  onToggleFavorite,
  runningTaskIds = [],
  botChats = [],
  currentBotChatKey,
  onSelectBotChat,
  onRefreshBotChats,
  onNewTask,
}: LeftSidebarProps) {
  const navigate = useNavigate();
  const { leftOpen, toggleLeft, leftActiveTab, setLeftActiveTab } = useSidebar();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialCategory, setSettingsInitialCategory] = useState<
    SettingsCategory | undefined
  >(undefined);
  const [profile, setProfile] = useState<UserProfile>({
    nickname: 'Guest User',
    avatar: '',
  });
  const { t } = useLanguage();

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);

  // Loading state for task switching
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);

  const handleDeleteClick = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTaskToDelete(taskId);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (taskToDelete && onDeleteTask) {
      onDeleteTask(taskToDelete);
      // If deleting current task, navigate to home
      if (taskToDelete === currentTaskId) {
        navigate('/');
      }
    }
    setTaskToDelete(null);
  };

  const handleToggleFavorite = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleFavorite) {
      onToggleFavorite(task.id, !task.favorite);
    }
  };

  // Load profile from settings
  useEffect(() => {
    const settings = getSettings();
    setProfile(settings.profile);
  }, []);

  // Reload profile when settings modal closes
  useEffect(() => {
    if (!settingsOpen) {
      const settings = getSettings();
      setProfile(settings.profile);
    }
  }, [settingsOpen]);

  const handleNewTask = () => {
    if (onNewTask) {
      onNewTask();
    } else {
      navigate('/');
    }
  };

  const handleSelectTask = (taskId: string) => {
    // Skip if already on this task or already loading
    if (taskId === currentTaskId || loadingTaskId) return;

    // Show loading state immediately
    setLoadingTaskId(taskId);

    // Use requestAnimationFrame to ensure UI updates before navigation
    requestAnimationFrame(() => {
      navigate(`/task/${taskId}`);
      // Clear loading state after a short delay (navigation should complete)
      setTimeout(() => setLoadingTaskId(null), 100);
    });
  };

  const handleSettings = () => {
    setSettingsOpen(true);
  };

  // Hover state for showing task list popup
  const [showTasksPopup, setShowTasksPopup] = useState(false);
  // Hover state for logo expand button
  const [logoHovered, setLogoHovered] = useState(false);
  // Pagination state for visible items
  const [visibleTaskCount, setVisibleTaskCount] = useState(10);
  const [visibleChatCount, setVisibleChatCount] = useState(10);

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'border-sidebar-border bg-sidebar flex h-full shrink-0 flex-col border-none transition-all duration-300',
          leftOpen ? 'w-72' : 'w-14'
        )}
      >
        {leftOpen ? (
          <>
            {/* Expanded State */}
            {/* Logo & Toggle */}
            <div className="flex shrink-0 items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-xl">
                  <img
                    src={ImageLogo}
                    alt="WorkAny"
                    className="text-primary size-9"
                  />
                </div>
                <span className="text-sidebar-foreground font-mono text-lg font-medium tracking-wide">
                  WorkAny
                </span>
              </div>
              <button
                onClick={toggleLeft}
                className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors duration-200"
              >
                <PanelLeft className="size-4" />
              </button>
            </div>

            {/* Tab Navigation */}
            <div className="mx-3 mb-3 flex shrink-0 gap-1 rounded-xl bg-sidebar-accent/30 p-1">
              <button
                onClick={() => setLeftActiveTab('local')}
                className={cn(
                  'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                  leftActiveTab === 'local'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-sidebar-foreground/60 hover:text-sidebar-foreground'
                )}
              >
                <ListTodo className="size-4" />
                <span>{t.nav.tabLocal}</span>
              </button>
              <button
                onClick={() => setLeftActiveTab('bot')}
                className={cn(
                  'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                  leftActiveTab === 'bot'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-sidebar-foreground/60 hover:text-sidebar-foreground'
                )}
              >
                <MessageSquare className="size-4" />
                <span>{t.nav.tabBot}</span>
              </button>
            </div>

            {/* Tab Content */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3">
              {/* Local Tab Content */}
              {leftActiveTab === 'local' && (
                <>
                  {/* New Task Button */}
                  <NavItem
                    icon={SquarePen}
                    label={t.nav.newTask}
                    collapsed={false}
                    onClick={handleNewTask}
                  />

                  {/* History Section */}
                  <div className="mt-4">
                    <div className="mb-2 flex shrink-0 items-center justify-between px-2 py-1.5">
                      <span className="text-sidebar-foreground/50 text-xs font-medium tracking-wider">
                        {t.nav.history}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {tasks.length > 0 ? (
                        <>
                          {tasks.slice(0, visibleTaskCount).map((task) => {
                            const TaskIcon = getTaskIcon(task.prompt);
                            const isRunningInBackground = runningTaskIds.includes(
                              task.id
                            );
                            const isLoading = loadingTaskId === task.id;
                            return (
                              <div
                                key={task.id}
                                className={cn(
                                  'group relative flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-all duration-200',
                                  currentTaskId === task.id || isLoading
                                    ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                                  isLoading && 'opacity-70'
                                )}
                                onClick={() => handleSelectTask(task.id)}
                              >
                                <div className="relative shrink-0">
                                  {isLoading ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <TaskIcon className="size-4" />
                                  )}
                                  {/* Running indicator */}
                                  {isRunningInBackground && !isLoading && (
                                    <span className="absolute -top-0.5 -right-0.5 flex size-2">
                                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
                                      <span className="relative inline-flex size-2 rounded-full bg-green-500" />
                                    </span>
                                  )}
                                </div>
                                <span className="min-w-0 flex-1 truncate text-sm">
                                  {task.prompt}
                                </span>
                              </div>
                            );
                          })}
                          {tasks.length > visibleTaskCount && (
                            <button
                              onClick={() => setVisibleTaskCount(prev => prev + 5)}
                              className="text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-colors"
                            >
                              <span className="text-sm">{t.common.more}</span>
                            </button>
                          )}
                        </>
                      ) : (
                        <div className="py-4 text-center">
                          <p className="text-sidebar-foreground/40 text-xs">
                            {t.nav.noTasksYet}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Bot Tab Content */}
              {leftActiveTab === 'bot' && (
                <>
                  {/* New Chat Button */}
                  <NavItem
                    icon={MessageSquare}
                    label={t.nav.newChat}
                    collapsed={false}
                    onClick={() => {
                      if (onSelectBotChat) {
                        onSelectBotChat('');
                      }
                    }}
                  />

                  {/* History Section */}
                  <div className="mt-4 flex shrink-0 flex-col overflow-hidden">
                    <div className="mb-2 flex shrink-0 items-center justify-between px-2 py-1.5">
                      <span className="text-sidebar-foreground/50 text-xs font-medium tracking-wider">
                        {t.nav.history}
                      </span>
                      <ChatSettingsButton
                        hasConfig={!!localStorage.getItem('openclaw_config')}
                        onRefresh={onRefreshBotChats}
                        onOpenSettings={() => {
                          setSettingsInitialCategory('openclaw');
                          setSettingsOpen(true);
                        }}
                      />
                    </div>
                    <div className="flex-1 space-y-0.5 overflow-y-auto">
                      {botChats && botChats.length > 0 ? (
                        <>
                          {botChats.slice(0, visibleChatCount).map((chat) => (
                            <div
                              key={chat.sessionKey}
                              className={cn(
                                'group relative flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-all duration-200',
                                currentBotChatKey === chat.sessionKey
                                  ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                              )}
                              onClick={() =>
                                onSelectBotChat && onSelectBotChat(chat.sessionKey)
                              }
                            >
                              <div className="relative shrink-0">
                                <MessageSquare className="size-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm">
                                  {chat.label || chat.friendlyId || '新对话'}
                                </p>
                                <p className="text-sidebar-foreground/40 truncate text-xs">
                                  {chat.lastMessage ||
                                    `${chat.messageCount} 条消息`}
                                </p>
                              </div>
                            </div>
                          ))}
                          {botChats.length > visibleChatCount && (
                            <button
                              onClick={() => setVisibleChatCount(prev => prev + 5)}
                              className="text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-colors"
                            >
                              <span className="text-sm">{t.common.more}</span>
                            </button>
                          )}
                        </>
                      ) : (
                        <div className="py-4 text-center">
                          <p className="text-sidebar-foreground/40 text-xs">
                            {t.nav.noChatsYet || '暂无聊天'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Bottom Section - Avatar with Dropdown */}
            <div className="border-sidebar-border mt-auto shrink-0 border-none p-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="hover:bg-sidebar-accent group flex w-full cursor-pointer items-center gap-3 rounded-lg p-2 transition-colors duration-200">
                    <div className="bg-sidebar-accent flex size-9 items-center justify-center overflow-hidden rounded-lg">
                      {profile.avatar ? (
                        <img
                          src={profile.avatar}
                          alt={profile.nickname}
                          className="size-full object-cover"
                        />
                      ) : (
                        <User className="text-sidebar-foreground/70 size-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="text-sidebar-foreground truncate text-sm font-medium">
                        {profile.nickname || 'Guest User'}
                      </p>
                    </div>
                    <ChevronsUpDown className="text-sidebar-foreground/40 group-hover:text-sidebar-foreground/60 size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                  side="right"
                  align="end"
                  sideOffset={8}
                >
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-3 px-2 py-2 text-left">
                      <div className="bg-muted flex size-9 items-center justify-center overflow-hidden rounded-lg">
                        {profile.avatar ? (
                          <img
                            src={profile.avatar}
                            alt={profile.nickname}
                            className="size-full object-cover"
                          />
                        ) : (
                          <User className="text-muted-foreground size-5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {profile.nickname || 'Guest User'}
                        </p>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={handleSettings}
                    >
                      <Settings className="size-4" />
                      <span>{t.nav.settings}</span>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        ) : (
          <>
            {/* Collapsed State - Icon-only vertical bar */}
            {/* Logo with hover expand */}
            <div className="flex shrink-0 items-center justify-center p-3">
              <button
                onClick={toggleLeft}
                onMouseEnter={() => setLogoHovered(true)}
                onMouseLeave={() => setLogoHovered(false)}
                className="hover:bg-sidebar-accent relative flex size-9 cursor-pointer items-center justify-center rounded-xl transition-all duration-200"
              >
                {logoHovered ? (
                  // <PanelLeftOpen className="text-sidebar-foreground size-5" />
                  <img src={ImageLogo} alt="WorkAny" className="size-9" />
                ) : (
                  <img src={ImageLogo} alt="WorkAny" className="size-9" />
                )}
              </button>
            </div>

            {/* Top Navigation Icons - Same as expanded */}
            <div className="flex shrink-0 flex-col items-center gap-1 px-2">
              {/* New Task */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleNewTask}
                    className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-10 cursor-pointer items-center justify-center rounded-xl transition-colors duration-200"
                  >
                    <SquarePen className="size-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t.nav.newTask}</TooltipContent>
              </Tooltip>

              {/* Tasks - With hover popup */}
              <div
                className="relative"
                onMouseEnter={() => setShowTasksPopup(true)}
                onMouseLeave={() => setShowTasksPopup(false)}
              >
                <button
                  className={cn(
                    'flex size-10 cursor-pointer items-center justify-center rounded-xl transition-colors duration-200',
                    currentTaskId
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                  )}
                >
                  <ListTodo className="size-5" />
                </button>

                {/* Tasks Popup Panel */}
                {showTasksPopup && (
                  <>
                    {/* Invisible bridge to prevent losing hover when moving to popup */}
                    <div className="absolute top-0 left-full z-50 h-full w-3" />
                    <div className="bg-background border-border/60 absolute top-0 left-full z-50 ml-2 max-h-[70vh] w-80 overflow-hidden rounded-xl border shadow-xl">
                      {/* Popup Header */}
                      <div className="border-border/50 bg-muted/30 border-b px-4 py-3">
                        <h3 className="text-foreground text-sm font-medium">
                          {t.nav.allTasks}
                        </h3>
                      </div>

                      {/* Tasks List */}
                      <div className="max-h-[calc(70vh-48px)] overflow-y-auto p-2">
                        {tasks.length === 0 ? (
                          <div className="py-8 text-center">
                            <p className="text-muted-foreground text-sm">
                              {t.nav.noTasksYet}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            {tasks.slice(0, visibleTaskCount).map((task) => {
                              const TaskIcon = getTaskIcon(task.prompt);
                              const isRunningInBackground =
                                runningTaskIds.includes(task.id);
                              const isLoading = loadingTaskId === task.id;
                              return (
                                <div
                                  key={task.id}
                                  className={cn(
                                    'group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                                    currentTaskId === task.id || isLoading
                                      ? 'bg-accent text-accent-foreground'
                                      : 'text-foreground/80 hover:bg-accent/50',
                                    isLoading && 'opacity-70'
                                  )}
                                  onClick={() => handleSelectTask(task.id)}
                                >
                                  <div className="relative shrink-0">
                                    {isLoading ? (
                                      <Loader2 className="text-muted-foreground size-5 animate-spin" />
                                    ) : (
                                      <TaskIcon className="text-muted-foreground size-5" />
                                    )}
                                    {/* Running indicator */}
                                    {isRunningInBackground && !isLoading && (
                                      <span className="absolute -top-0.5 -right-0.5 flex size-2">
                                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
                                        <span className="relative inline-flex size-2 rounded-full bg-green-500" />
                                      </span>
                                    )}
                                  </div>
                                  <span className="min-w-0 flex-1 truncate text-sm">
                                    {task.prompt}
                                  </span>
                                  {/* Running indicator for running tasks, dropdown menu for completed tasks */}
                                  {isRunningInBackground ? (
                                    <div className="flex size-6 shrink-0 items-center justify-center">
                                      <Loader2 className="text-primary size-4 animate-spin" />
                                    </div>
                                  ) : (
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <button
                                          onClick={(e) => e.stopPropagation()}
                                          className="flex size-6 shrink-0 items-center justify-center rounded transition-all"
                                        >
                                          {/* Show star when favorited (hide on hover), show menu icon on hover */}
                                          {task.favorite ? (
                                            <>
                                              <Star className="size-4 fill-amber-400 text-amber-400 group-hover:hidden" />
                                              <MoreHorizontal className="text-muted-foreground hover:text-foreground hidden size-4 group-hover:block" />
                                            </>
                                          ) : (
                                            <MoreHorizontal className="text-muted-foreground hover:text-foreground size-4 opacity-0 group-hover:opacity-100" />
                                          )}
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent
                                        align="end"
                                        sideOffset={4}
                                        className="min-w-[140px]"
                                      >
                                        <DropdownMenuItem
                                          className="cursor-pointer"
                                          onClick={(e) =>
                                            handleToggleFavorite(task, e)
                                          }
                                        >
                                          <Star
                                            className={cn(
                                              'size-4',
                                              task.favorite &&
                                                'fill-amber-400 text-amber-400'
                                            )}
                                          />
                                          <span>
                                            {task.favorite
                                              ? t.common.unfavorite
                                              : t.common.favorite}
                                          </span>
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          className="cursor-pointer text-red-500 focus:text-red-500"
                                          onClick={(e) =>
                                            handleDeleteClick(task.id, e)
                                          }
                                        >
                                          <Trash2 className="size-4" />
                                          <span>{t.common.delete}</span>
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  )}
                                </div>
                              );
                            })}
                            {tasks.length > visibleTaskCount && (
                              <button
                                onClick={() => setVisibleTaskCount(prev => prev + 5)}
                                className="text-muted-foreground hover:text-foreground hover:bg-accent/50 flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors"
                              >
                                <span className="text-sm">{t.common.more}</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Bottom - User Avatar with Dropdown */}
            <div className="flex shrink-0 flex-col items-center gap-1 px-2 pb-6">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="bg-sidebar-accent hover:ring-sidebar-foreground/20 flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-lg transition-all hover:ring-2">
                    {profile.avatar ? (
                      <img
                        src={profile.avatar}
                        alt={profile.nickname}
                        className="size-full object-cover"
                      />
                    ) : (
                      <User className="text-sidebar-foreground/70 size-4" />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="min-w-56 rounded-lg"
                  side="right"
                  align="end"
                  sideOffset={8}
                >
                  {/* User Info Header */}
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-3 px-2 py-2 text-left">
                      <div className="bg-muted flex size-9 items-center justify-center overflow-hidden rounded-lg">
                        {profile.avatar ? (
                          <img
                            src={profile.avatar}
                            alt={profile.nickname}
                            className="size-full object-cover"
                          />
                        ) : (
                          <User className="text-muted-foreground size-5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {profile.nickname || 'Guest User'}
                        </p>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={handleSettings}
                    >
                      <Settings className="size-4" />
                      <span>{t.nav.settings}</span>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </aside>

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setSettingsInitialCategory(undefined);
        }}
        initialCategory={settingsInitialCategory}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleConfirmDelete}
        t={t}
      />
    </TooltipProvider>
  );
}

// Navigation Item Component
function NavItem({
  icon: Icon,
  label,
  collapsed,
  onClick,
  active,
  shortcut,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  collapsed: boolean;
  onClick?: () => void;
  active?: boolean;
  shortcut?: string;
}) {
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={cn(
              'mx-auto flex size-10 cursor-pointer items-center justify-center rounded-lg transition-all duration-200',
              active
                ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
            )}
          >
            <Icon className="size-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <div className="flex items-center gap-2">
            <span>{label}</span>
            {shortcut && (
              <span className="text-muted-foreground text-xs">{shortcut}</span>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-sm'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
      )}
    >
      <Icon className="size-5" />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && (
        <span className="text-sidebar-foreground/40 text-xs">{shortcut}</span>
      )}
    </button>
  );
}
