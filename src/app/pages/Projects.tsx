import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllProjects, deleteProject, getIssuesByProjectId, type Project } from '@/shared/db';
import { useLanguage } from '@/shared/providers/language-provider';
import { Plus, Trash2, MoreHorizontal, Pencil, FolderKanban } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ProjectsPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [issueCounts, setIssueCounts] = useState<Record<string, { open: number; total: number }>>({});

  useEffect(() => {
    getAllProjects().then(async (projects) => {
      setProjects(projects);
      const counts: Record<string, { open: number; total: number }> = {};
      for (const project of projects) {
        const issues = await getIssuesByProjectId(project.id);
        counts[project.id] = {
          total: issues.length,
          open: issues.filter((i) => i.status === 'open' || i.status === 'in_progress').length,
        };
      }
      setIssueCounts(counts);
    });
  }, []);

  const handleDelete = async (id: string) => {
    await deleteProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-foreground text-2xl font-semibold">{t.nav.projects}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{t.projects.description}</p>
          </div>
          <button
            onClick={() => navigate('/projects/new')}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <Plus className="size-4" />
            {t.projects.create}
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="bg-muted mb-4 flex size-16 items-center justify-center rounded-2xl">
              <FolderKanban className="text-muted-foreground size-8" />
            </div>
            <h3 className="text-foreground mb-2 text-lg font-medium">{t.projects.empty}</h3>
            <p className="text-muted-foreground mb-6 text-sm">{t.projects.emptyDescription}</p>
            <button
              onClick={() => navigate('/projects/new')}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              <Plus className="size-4" />
              {t.projects.create}
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const counts = issueCounts[project.id];
              return (
                <div
                  key={project.id}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="border-border hover:border-primary/30 hover:shadow-sm group cursor-pointer rounded-xl border p-4 transition-all"
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div className="bg-muted flex size-10 items-center justify-center rounded-xl">
                      <FolderKanban className="text-muted-foreground size-5" />
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="text-muted-foreground hover:text-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <MoreHorizontal className="size-5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`/projects/${project.id}`); }}>
                          <Pencil className="size-4" />
                          <span>{t.common.edit}</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-red-500 focus:text-red-500"
                          onClick={(e) => { e.stopPropagation(); handleDelete(project.id); }}
                        >
                          <Trash2 className="size-4" />
                          <span>{t.common.delete}</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <h3 className="text-foreground text-sm font-medium">{project.name}</h3>
                  {project.description && (
                    <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{project.description}</p>
                  )}
                  {counts && (
                    <div className="mt-3 flex items-center gap-3">
                      <span className="text-muted-foreground text-xs">
                        {counts.open} {t.projects.openIssues}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {counts.total} {t.projects.totalIssues}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
