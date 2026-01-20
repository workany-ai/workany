import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ImageLogo from '@/assets/logo.png';
import type { Task } from '@/shared/db';
import { getSettings, type UserProfile } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  Calendar,
  ChevronsUpDown,
  FileText,
  Globe,
  ListTodo,
  PanelLeft,
  PanelLeftOpen,
  Settings,
  Smartphone,
  Sparkles,
  SquarePen,
  User,
} from 'lucide-react';

import { SettingsModal } from '@/components/settings';
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
}

// Get icon for task based on prompt content
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

export function LeftSidebar({ tasks, currentTaskId }: LeftSidebarProps) {
  const navigate = useNavigate();
  const { leftOpen, toggleLeft } = useSidebar();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile>({
    nickname: 'Guest User',
    avatar: '',
  });
  const { t } = useLanguage();

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
    navigate('/');
  };

  const handleSelectTask = (taskId: string) => {
    navigate(`/task/${taskId}`);
  };

  const handleSettings = () => {
    setSettingsOpen(true);
  };

  // Hover state for showing task list popup
  const [showTasksPopup, setShowTasksPopup] = useState(false);
  // Hover state for logo expand button
  const [logoHovered, setLogoHovered] = useState(false);

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

            {/* Navigation Items */}
            <nav className="flex shrink-0 flex-col gap-1 px-3">
              <NavItem
                icon={SquarePen}
                label={t.nav.newTask}
                collapsed={false}
                onClick={handleNewTask}
              />
            </nav>

            {/* Tasks Section */}
            <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden px-3">
              <div className="flex shrink-0 items-center justify-between px-2 py-1.5">
                <span className="text-sidebar-foreground/50 text-xs font-medium tracking-wider">
                  {t.nav.allTasks}
                </span>
              </div>

              <div className="scrollbar-hide mt-1 flex-1 space-y-0.5 overflow-y-auto">
                {tasks.slice(0, 10).map((task) => {
                  const TaskIcon = getTaskIcon(task.prompt);
                  return (
                    <button
                      key={task.id}
                      onClick={() => handleSelectTask(task.id)}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-all duration-200',
                        currentTaskId === task.id
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                      )}
                    >
                      <TaskIcon className="size-4 shrink-0" />
                      <span className="truncate text-sm">{task.prompt}</span>
                    </button>
                  );
                })}
                {tasks.length > 10 && (
                  <button
                    onClick={() => navigate('/library')}
                    className="text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-colors"
                  >
                    <span className="text-sm">{t.common.more}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Bottom Section - Avatar with Dropdown */}
            <div className="border-sidebar-border mt-auto shrink-0 border-t p-3">
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
                  <PanelLeftOpen className="text-sidebar-foreground size-5" />
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
                          {tasks.slice(0, 10).map((task) => {
                            const TaskIcon = getTaskIcon(task.prompt);
                            return (
                              <button
                                key={task.id}
                                onClick={() => handleSelectTask(task.id)}
                                className={cn(
                                  'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                                  currentTaskId === task.id
                                    ? 'bg-accent text-accent-foreground'
                                    : 'text-foreground/80 hover:bg-accent/50'
                                )}
                              >
                                <TaskIcon className="text-muted-foreground size-5 shrink-0" />
                                <span className="truncate text-sm">
                                  {task.prompt}
                                </span>
                              </button>
                            );
                          })}
                          {tasks.length > 10 && (
                            <button
                              onClick={() => navigate('/library')}
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
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
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
