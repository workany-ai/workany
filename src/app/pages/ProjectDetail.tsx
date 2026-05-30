import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  createProject,
  getProject,
  updateProject,
  getAllTeams,
  getAllAgents,
  getIssuesByProjectId,
  createIssue,
  updateIssue,
  deleteIssue,
  type Agent,
  type Team,
  type Issue,
} from '@/shared/db';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  MoreHorizontal,
  Plus,
  Save,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const statusIcons = {
  open: Circle,
  in_progress: Loader2,
  done: CheckCircle2,
  closed: XCircle,
};

const statusColors = {
  open: 'text-blue-500',
  in_progress: 'text-amber-500',
  done: 'text-green-500',
  closed: 'text-muted-foreground',
};

const priorityColors = {
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  medium: 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400',
  high: 'bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-400',
  urgent: 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400',
};

export function ProjectDetailPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const isNew = !projectId;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [teamId, setTeamId] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(projectId || null);

  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);

  // Issue dialog
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [issueTitle, setIssueTitle] = useState('');
  const [issueDescription, setIssueDescription] = useState('');
  const [issuePriority, setIssuePriority] = useState<Issue['priority']>('medium');
  const [issueAgentId, setIssueAgentId] = useState('');

  useEffect(() => {
    getAllTeams().then(setTeams);
    getAllAgents().then(setAgents);
    if (projectId) {
      getProject(projectId).then((project) => {
        if (project) {
          setName(project.name);
          setDescription(project.description);
          setTeamId(project.team_id || '');
        }
      });
      getIssuesByProjectId(projectId).then(setIssues);
    }
  }, [projectId]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (isNew && !savedProjectId) {
        const id = generateId();
        await createProject({
          id,
          name: name.trim(),
          description,
          team_id: teamId || undefined,
        });
        setSavedProjectId(id);
        navigate(`/projects/${id}`, { replace: true });
      } else {
        const id = savedProjectId || projectId!;
        await updateProject(id, {
          name: name.trim(),
          description,
          team_id: teamId || null,
        });
      }
    } catch (error) {
      console.error('Failed to save project:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateIssue = async () => {
    const pid = savedProjectId || projectId;
    if (!pid || !issueTitle.trim()) return;
    const issue = await createIssue({
      id: generateId(),
      project_id: pid,
      title: issueTitle.trim(),
      description: issueDescription,
      priority: issuePriority,
      assigned_agent_id: issueAgentId || undefined,
    });
    setIssues((prev) => [issue, ...prev]);
    setIssueDialogOpen(false);
    setIssueTitle('');
    setIssueDescription('');
    setIssuePriority('medium');
    setIssueAgentId('');
  };

  const handleStatusChange = async (issueId: string, status: Issue['status']) => {
    await updateIssue(issueId, { status });
    setIssues((prev) => prev.map((i) => (i.id === issueId ? { ...i, status } : i)));
  };

  const handleDeleteIssue = async (issueId: string) => {
    await deleteIssue(issueId);
    setIssues((prev) => prev.filter((i) => i.id !== issueId));
  };

  const handleAssignAgent = async (issueId: string, agentId: string | null) => {
    await updateIssue(issueId, { assigned_agent_id: agentId });
    setIssues((prev) => prev.map((i) => (i.id === issueId ? { ...i, assigned_agent_id: agentId } : i)));
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => navigate('/projects')}
            className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-8 items-center justify-center rounded-lg transition-colors"
          >
            <ArrowLeft className="size-4" />
          </button>
          <h1 className="text-foreground text-xl font-semibold">
            {isNew ? t.projects.create : name || t.projects.edit}
          </h1>
        </div>

        <div className="space-y-6">
          {/* Project Info */}
          <div className="space-y-3">
            <div>
              <label className="text-foreground mb-1.5 block text-sm font-medium">{t.projects.name}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.projects.namePlaceholder}
                className="border-border bg-background focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
              />
            </div>
            <div>
              <label className="text-foreground mb-1.5 block text-sm font-medium">{t.projects.projectDescription}</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.projects.descriptionPlaceholder}
                rows={3}
                className="border-border bg-background focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
              />
            </div>
            {teams.length > 0 && (
              <div>
                <label className="text-foreground mb-1.5 block text-sm font-medium">{t.projects.team}</label>
                <select
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                  className="border-border bg-background focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
                >
                  <option value="">{t.projects.noTeam}</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Save */}
          <div className="flex justify-end gap-3">
            <button
              onClick={() => navigate('/projects')}
              className="border-border hover:bg-accent rounded-lg border px-4 py-2 text-sm transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            >
              <Save className="size-4" />
              {saving ? t.common.loading : t.common.save}
            </button>
          </div>

          {/* Issues Section */}
          {(projectId || savedProjectId) && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-foreground text-base font-medium">{t.projects.issues}</h3>
                <button
                  onClick={() => setIssueDialogOpen(true)}
                  className="text-primary hover:bg-primary/10 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                >
                  <Plus className="size-4" />
                  {t.projects.createIssue}
                </button>
              </div>

              {issues.length === 0 ? (
                <div className="border-border rounded-lg border py-8 text-center">
                  <p className="text-muted-foreground text-sm">{t.projects.noIssues}</p>
                </div>
              ) : (
                <div className="border-border divide-border divide-y rounded-lg border">
                  {issues.map((issue) => {
                    const StatusIcon = statusIcons[issue.status];
                    const assignedAgent = agents.find((a) => a.id === issue.assigned_agent_id);
                    return (
                      <div key={issue.id} className="flex items-center gap-3 px-4 py-3">
                        <StatusIcon className={cn('size-4 shrink-0', statusColors[issue.status])} />
                        <div className="min-w-0 flex-1">
                          <p className="text-foreground truncate text-sm font-medium">{issue.title}</p>
                          {issue.description && (
                            <p className="text-muted-foreground mt-0.5 truncate text-xs">{issue.description}</p>
                          )}
                        </div>
                        <span className={cn('rounded-md px-2 py-0.5 text-xs', priorityColors[issue.priority])}>
                          {issue.priority}
                        </span>
                        {assignedAgent && (
                          <div className="bg-muted flex size-6 items-center justify-center rounded-full" title={assignedAgent.name}>
                            {assignedAgent.avatar ? (
                              <img src={assignedAgent.avatar} alt={assignedAgent.name} className="size-full rounded-full object-cover" />
                            ) : (
                              <Bot className="size-3" />
                            )}
                          </div>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="text-muted-foreground hover:text-foreground">
                              <MoreHorizontal className="size-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleStatusChange(issue.id, 'open')}>
                              <Circle className="size-4 text-blue-500" />
                              <span>Open</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleStatusChange(issue.id, 'in_progress')}>
                              <Clock className="size-4 text-amber-500" />
                              <span>In Progress</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleStatusChange(issue.id, 'done')}>
                              <CheckCircle2 className="size-4 text-green-500" />
                              <span>Done</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {agents.map((agent) => (
                              <DropdownMenuItem key={agent.id} onClick={() => handleAssignAgent(issue.id, agent.id)}>
                                <Bot className="size-4" />
                                <span>{t.projects.assignTo} {agent.name}</span>
                              </DropdownMenuItem>
                            ))}
                            {issue.assigned_agent_id && (
                              <DropdownMenuItem onClick={() => handleAssignAgent(issue.id, null)}>
                                <Bot className="text-muted-foreground size-4" />
                                <span>{t.projects.unassign}</span>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-500 focus:text-red-500"
                              onClick={() => handleDeleteIssue(issue.id)}
                            >
                              <Trash2 className="size-4" />
                              <span>{t.common.delete}</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create Issue Dialog */}
      <Dialog open={issueDialogOpen} onOpenChange={setIssueDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t.projects.createIssue}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="mb-1 block text-sm font-medium">{t.projects.issueTitle}</label>
              <input
                type="text"
                value={issueTitle}
                onChange={(e) => setIssueTitle(e.target.value)}
                placeholder={t.projects.issueTitlePlaceholder}
                autoFocus
                className="border-border bg-background focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t.projects.issueDescription}</label>
              <textarea
                value={issueDescription}
                onChange={(e) => setIssueDescription(e.target.value)}
                placeholder={t.projects.issueDescriptionPlaceholder}
                rows={3}
                className="border-border bg-background focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">{t.projects.priority}</label>
                <select
                  value={issuePriority}
                  onChange={(e) => setIssuePriority(e.target.value as Issue['priority'])}
                  className="border-border bg-background w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t.projects.assignAgent}</label>
                <select
                  value={issueAgentId}
                  onChange={(e) => setIssueAgentId(e.target.value)}
                  className="border-border bg-background w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">{t.projects.unassigned}</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={() => setIssueDialogOpen(false)}
              className="border-border hover:bg-accent rounded-lg border px-4 py-2 text-sm transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              onClick={handleCreateIssue}
              disabled={!issueTitle.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {t.common.add}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
