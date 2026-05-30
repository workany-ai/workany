import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllAgents, deleteAgent, type Agent } from '@/shared/db';
import { useLanguage } from '@/shared/providers/language-provider';
import { Bot, Plus, Trash2, MoreHorizontal, Pencil } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function AgentsPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    getAllAgents().then(setAgents).catch(console.error);
  }, []);

  const handleDelete = async (id: string) => {
    await deleteAgent(id);
    setAgents((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-foreground text-2xl font-semibold">{t.nav.agents}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{t.agents.description}</p>
          </div>
          <button
            onClick={() => navigate('/agents/new')}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <Plus className="size-4" />
            {t.agents.create}
          </button>
        </div>

        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="bg-muted mb-4 flex size-16 items-center justify-center rounded-2xl">
              <Bot className="text-muted-foreground size-8" />
            </div>
            <h3 className="text-foreground mb-2 text-lg font-medium">{t.agents.empty}</h3>
            <p className="text-muted-foreground mb-6 text-sm">{t.agents.emptyDescription}</p>
            <button
              onClick={() => navigate('/agents/new')}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              <Plus className="size-4" />
              {t.agents.create}
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <div
                key={agent.id}
                onClick={() => navigate(`/agents/${agent.id}`)}
                className="border-border hover:border-primary/30 hover:shadow-sm group cursor-pointer rounded-xl border p-4 transition-all"
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className="bg-muted flex size-10 items-center justify-center rounded-xl">
                    {agent.avatar ? (
                      <img src={agent.avatar} alt={agent.name} className="size-full rounded-xl object-cover" />
                    ) : (
                      <Bot className="text-muted-foreground size-5" />
                    )}
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
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`/agents/${agent.id}`); }}>
                        <Pencil className="size-4" />
                        <span>{t.common.edit}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-red-500 focus:text-red-500"
                        onClick={(e) => { e.stopPropagation(); handleDelete(agent.id); }}
                      >
                        <Trash2 className="size-4" />
                        <span>{t.common.delete}</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <h3 className="text-foreground text-sm font-medium">{agent.name}</h3>
                {agent.soul_md && (
                  <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{agent.soul_md}</p>
                )}
                <div className="mt-3 flex items-center gap-2">
                  {agent.model_name && (
                    <span className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs">{agent.model_name}</span>
                  )}
                  {agent.is_default && (
                    <span className="bg-primary/10 text-primary rounded-md px-2 py-0.5 text-xs">Default</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
