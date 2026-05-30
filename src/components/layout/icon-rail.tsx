import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ImageLogo from '@/assets/logo.png';
import { getSettings, type UserProfile } from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  Bot,
  FolderKanban,
  MessageSquare,
  BookOpen,
  Settings,
  SquarePen,
  User,
  Users,
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

import { useSidebar, type ActiveSection } from './sidebar-context';

const navItems: { key: ActiveSection; icon: typeof MessageSquare; path: string }[] = [
  { key: 'chat', icon: MessageSquare, path: '/' },
  { key: 'agents', icon: Bot, path: '/agents' },
  { key: 'teams', icon: Users, path: '/teams' },
  { key: 'projects', icon: FolderKanban, path: '/projects' },
  { key: 'library', icon: BookOpen, path: '/library' },
];

export function IconRail() {
  const navigate = useNavigate();
  const { activeSection, setActiveSection, secondaryOpen, setSecondaryOpen } = useSidebar();
  const { t } = useLanguage();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile>({ nickname: 'Guest User', avatar: '' });

  useEffect(() => {
    const settings = getSettings();
    setProfile(settings.profile);
  }, []);

  useEffect(() => {
    if (!settingsOpen) {
      const settings = getSettings();
      setProfile(settings.profile);
    }
  }, [settingsOpen]);

  const handleNavClick = (item: typeof navItems[0]) => {
    if (activeSection === item.key) {
      setSecondaryOpen(!secondaryOpen);
    } else {
      setActiveSection(item.key);
      setSecondaryOpen(true);
      navigate(item.path);
    }
  };

  const handleNewTask = () => {
    setActiveSection('chat');
    navigate('/');
  };

  const navLabels: Record<ActiveSection, string> = {
    chat: t.nav.chat,
    agents: t.nav.agents,
    teams: t.nav.teams,
    projects: t.nav.projects,
    library: t.nav.library,
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div className="bg-sidebar border-sidebar-border flex h-full w-14 shrink-0 flex-col items-center border-r py-3">
        {/* Logo */}
        <div className="mb-2 flex items-center justify-center">
          <img src={ImageLogo} alt="WorkAny" className="size-8" />
        </div>

        {/* New Task */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleNewTask}
              className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground mt-1 flex size-10 cursor-pointer items-center justify-center rounded-xl transition-colors"
            >
              <SquarePen className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t.nav.newTask}</TooltipContent>
        </Tooltip>

        {/* Separator */}
        <div className="bg-sidebar-border my-2 h-px w-8" />

        {/* Navigation Items */}
        <div className="flex flex-col items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.key;
            return (
              <Tooltip key={item.key}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => handleNavClick(item)}
                    className={cn(
                      'flex size-10 cursor-pointer items-center justify-center rounded-xl transition-colors',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                    )}
                  >
                    <Icon className="size-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{navLabels[item.key]}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Settings */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground mb-2 flex size-10 cursor-pointer items-center justify-center rounded-xl transition-colors"
            >
              <Settings className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t.nav.settings}</TooltipContent>
        </Tooltip>

        {/* User Avatar */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="bg-sidebar-accent hover:ring-sidebar-foreground/20 flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-lg transition-all hover:ring-2">
              {profile.avatar ? (
                <img src={profile.avatar} alt={profile.nickname} className="size-full object-cover" />
              ) : (
                <User className="text-sidebar-foreground/70 size-4" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56 rounded-lg" side="right" align="end" sideOffset={8}>
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-3 px-2 py-2 text-left">
                <div className="bg-muted flex size-9 items-center justify-center overflow-hidden rounded-lg">
                  {profile.avatar ? (
                    <img src={profile.avatar} alt={profile.nickname} className="size-full object-cover" />
                  ) : (
                    <User className="text-muted-foreground size-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{profile.nickname || 'Guest User'}</p>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem className="cursor-pointer" onClick={() => setSettingsOpen(true)}>
                <Settings className="size-4" />
                <span>{t.nav.settings}</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </TooltipProvider>
  );
}
