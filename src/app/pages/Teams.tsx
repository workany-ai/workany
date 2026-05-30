import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllTeams, deleteTeam, getTeamMembers, type Team } from '@/shared/db';
import { useLanguage } from '@/shared/providers/language-provider';
import { Plus, Trash2, MoreHorizontal, Pencil, Users } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function TeamsPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [teams, setTeams] = useState<Team[]>([]);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    getAllTeams().then(async (teams) => {
      setTeams(teams);
      const counts: Record<string, number> = {};
      for (const team of teams) {
        const members = await getTeamMembers(team.id);
        counts[team.id] = members.length;
      }
      setMemberCounts(counts);
    });
  }, []);

  const handleDelete = async (id: string) => {
    await deleteTeam(id);
    setTeams((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-foreground text-2xl font-semibold">{t.nav.teams}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{t.teams.description}</p>
          </div>
          <button
            onClick={() => navigate('/teams/new')}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <Plus className="size-4" />
            {t.teams.create}
          </button>
        </div>

        {teams.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="bg-muted mb-4 flex size-16 items-center justify-center rounded-2xl">
              <Users className="text-muted-foreground size-8" />
            </div>
            <h3 className="text-foreground mb-2 text-lg font-medium">{t.teams.empty}</h3>
            <p className="text-muted-foreground mb-6 text-sm">{t.teams.emptyDescription}</p>
            <button
              onClick={() => navigate('/teams/new')}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              <Plus className="size-4" />
              {t.teams.create}
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <div
                key={team.id}
                onClick={() => navigate(`/teams/${team.id}`)}
                className="border-border hover:border-primary/30 hover:shadow-sm group cursor-pointer rounded-xl border p-4 transition-all"
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className="bg-muted flex size-10 items-center justify-center rounded-xl">
                    <Users className="text-muted-foreground size-5" />
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
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`/teams/${team.id}`); }}>
                        <Pencil className="size-4" />
                        <span>{t.common.edit}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-red-500 focus:text-red-500"
                        onClick={(e) => { e.stopPropagation(); handleDelete(team.id); }}
                      >
                        <Trash2 className="size-4" />
                        <span>{t.common.delete}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <h3 className="text-foreground text-sm font-medium">{team.name}</h3>
                {team.description && (
                  <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{team.description}</p>
                )}
                <div className="mt-3">
                  <span className="text-muted-foreground text-xs">
                    {memberCounts[team.id] || 0} {t.teams.members}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
