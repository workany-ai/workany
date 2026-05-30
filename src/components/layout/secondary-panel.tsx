import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Task, Agent, Team, Project } from '@/shared/db/types';
import {
  getAllTasks,
  deleteTask,
  updateTask,
  getAllAgents,
  getAllTeams,
  getAllProjects,
} from '@/shared/db/database';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  subscribeToBackgroundTasks,
  type BackgroundTask,
} from '@/shared/lib/background-tasks';
import {
  Bot,
  Calendar,
  FileText,
  FolderKanban,
  Globe,
  Loader2,
  MoreHorizontal,
  Plus,
  Smartphone,
  Sparkles,
  Star,
  Trash2,
  Users,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { useSidebar } from './sidebar-context';

function getTaskIcon(prompt: string) {
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes('website') || lowerPrompt.includes('网站')) return Globe;
  if (lowerPrompt.includes('app') || lowerPrompt.includes('应用')) return Smartphone;
  if (lowerPrompt.includes('design') || lowerPrompt.includes('设计')) return Sparkles;
  if (lowerPrompt.includes('doc') || lowerPrompt.includes('文档')) return FileText;
  return Calendar;
}

export function SecondaryPanel() {
  const { activeSection, secondaryOpen } = useSidebar();

  if (!secondaryOpen) return null;

  return (
    <div className="bg-sidebar flex h-full w-60 shrink-0 flex-col">
      {activeSection === 'chat' && <ChatPanel />}
      {activeSection === 'agents' && <AgentsPanel />}
      {activeSection === 'teams' && <TeamsPanel />}
      {activeSection === 'projects' && <ProjectsPanel />}
      {activeSection === 'library' && <LibraryPanel />}
    </div>
  );
}

// ============ Chat Panel ============
function ChatPanel() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { taskId } = useParams();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToBackgroundTasks(setBackgroundTasks);
    return unsubscribe;
  }, []);

  useEffect(() => {
    getAllTasks().then(setTasks).catch(console.error);
  }, []);

  // Refresh tasks when navigating back
  useEffect(() => {
    getAllTasks().then(setTasks).catch(console.error);
  }, [taskId]);

  const handleDeleteTask = async (id: string) => {
    await deleteTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (id === taskId) navigate('/');
  };

  const handleToggleFavorite = async (task: Task) => {
    const fav = !task.favorite;
    await updateTask(task.id, { favorite: fav });
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, favorite: fav } : t)));
  };

  const runningIds = backgroundTasks.filter((t) => t.isRunning).map((t) => t.taskId);

  return (
    <>
      <PanelHeader title={t.nav.allTasks} />
      <div className="scrollbar-hide flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {tasks.length === 0 ? (
          <p className="text-muted-foreground px-2 py-8 text-center text-sm">{t.nav.noTasksYet}</p>
        ) : (
          tasks.map((task) => {
            const TaskIcon = getTaskIcon(task.prompt);
            const isRunning = runningIds.includes(task.id);
            const isActive = taskId === task.id;
            return (
              <div
                key={task.id}
                className={cn(
                  'group relative flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-all',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                )}
                onClick={() => navigate(`/task/${task.id}`)}
              >
                <div className="relative shrink-0">
                  <TaskIcon className="size-4" />
                  {isRunning && (
                    <span className="absolute -top-0.5 -right-0.5 flex size-2">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex size-2 rounded-full bg-green-500" />
                    </span>
                  )}
                </div>
                <span className="min-w-0 flex-1 truncate text-sm">{task.prompt}</span>
                {isRunning ? (
                  <Loader2 className="text-primary size-4 shrink-0 animate-spin" />
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="flex size-6 shrink-0 items-center justify-center rounded"
                      >
                        {task.favorite ? (
                          <>
                            <Star className="size-4 fill-amber-400 text-amber-400 group-hover:hidden" />
                            <MoreHorizontal className="text-sidebar-foreground/40 hidden size-4 group-hover:block" />
                          </>
                        ) : (
                          <MoreHorizontal className="text-sidebar-foreground/40 size-4 opacity-0 group-hover:opacity-100" />
                        )}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={4} className="min-w-[140px]">
                      <DropdownMenuItem className="cursor-pointer" onClick={() => handleToggleFavorite(task)}>
                        <Star className={cn('size-4', task.favorite && 'fill-amber-400 text-amber-400')} />
                        <span>{task.favorite ? t.common.unfavorite : t.common.favorite}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="cursor-pointer text-red-500 focus:text-red-500"
                        onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
                      >
                        <Trash2 className="size-4" />
                        <span>{t.common.delete}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

// ============ Agents Panel ============
function AgentsPanel() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    getAllAgents().then(setAgents).catch(console.error);
  }, []);

  return (
    <>
      <PanelHeader
        title={t.nav.agents}
        onAdd={() => navigate('/agents/new')}
      />
      <div className="scrollbar-hide flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {agents.length === 0 ? (
          <EmptyState label={t.nav.noAgentsYet} />
        ) : (
          agents.map((agent) => (
            <div
              key={agent.id}
              className="text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-colors"
              onClick={() => navigate(`/agents/${agent.id}`)}
            >
              <div className="bg-sidebar-accent flex size-7 items-center justify-center rounded-lg">
                {agent.avatar ? (
                  <img src={agent.avatar} alt={agent.name} className="size-full rounded-lg object-cover" />
                ) : (
                  <Bot className="size-4" />
                )}
              </div>
              <span className="min-w-0 flex-1 truncate text-sm">{agent.name}</span>
              {agent.is_default && (
                <span className="text-muted-foreground text-xs">default</span>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ============ Teams Panel ============
function TeamsPanel() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    getAllTeams().then(setTeams).catch(console.error);
  }, []);

  return (
    <>
      <PanelHeader
        title={t.nav.teams}
        onAdd={() => navigate('/teams/new')}
      />
      <div className="scrollbar-hide flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {teams.length === 0 ? (
          <EmptyState label={t.nav.noTeamsYet} />
        ) : (
          teams.map((team) => (
            <div
              key={team.id}
              className="text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-colors"
              onClick={() => navigate(`/teams/${team.id}`)}
            >
              <div className="bg-sidebar-accent flex size-7 items-center justify-center rounded-lg">
                <Users className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{team.name}</p>
                {team.description && (
                  <p className="text-muted-foreground truncate text-xs">{team.description}</p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ============ Projects Panel ============
function ProjectsPanel() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    getAllProjects().then(setProjects).catch(console.error);
  }, []);

  return (
    <>
      <PanelHeader
        title={t.nav.projects}
        onAdd={() => navigate('/projects/new')}
      />
      <div className="scrollbar-hide flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {projects.length === 0 ? (
          <EmptyState label={t.nav.noProjectsYet} />
        ) : (
          projects.map((project) => (
            <div
              key={project.id}
              className="text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-colors"
              onClick={() => navigate(`/projects/${project.id}`)}
            >
              <div className="bg-sidebar-accent flex size-7 items-center justify-center rounded-lg">
                <FolderKanban className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{project.name}</p>
                {project.description && (
                  <p className="text-muted-foreground truncate text-xs">{project.description}</p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ============ Library Panel ============
function LibraryPanel() {
  const { t } = useLanguage();
  return (
    <>
      <PanelHeader title={t.nav.library} />
      <div className="flex flex-1 items-center justify-center px-2">
        <p className="text-muted-foreground text-center text-sm">{t.nav.libraryHint}</p>
      </div>
    </>
  );
}

// ============ Shared Components ============
function PanelHeader({ title, onAdd }: { title: string; onAdd?: () => void }) {
  return (
    <div className="flex shrink-0 items-center justify-between px-4 py-3">
      <span className="text-sidebar-foreground text-sm font-medium">{title}</span>
      {onAdd && (
        <button
          onClick={onAdd}
          className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-6 items-center justify-center rounded-md transition-colors"
        >
          <Plus className="size-4" />
        </button>
      )}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <p className="text-muted-foreground px-2 py-8 text-center text-sm">{label}</p>
  );
}
