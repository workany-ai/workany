import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  createTeam,
  getTeam,
  updateTeam,
  getAllAgents,
  getTeamMembers,
  addTeamMember,
  removeTeamMember,
  updateTeamMemberRole,
  type Agent,
  type TeamMember,
  type TeamMemberRole,
} from '@/shared/db';
import { useLanguage } from '@/shared/providers/language-provider';
import { ArrowLeft, Bot, Plus, Save, UserMinus } from 'lucide-react';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function TeamDetailPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { teamId } = useParams();
  const isNew = !teamId;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [savedTeamId, setSavedTeamId] = useState<string | null>(teamId || null);

  useEffect(() => {
    getAllAgents().then(setAllAgents);
    if (teamId) {
      getTeam(teamId).then((team) => {
        if (team) {
          setName(team.name);
          setDescription(team.description);
        }
      });
      getTeamMembers(teamId).then(setMembers);
    }
  }, [teamId]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (isNew && !savedTeamId) {
        const id = generateId();
        await createTeam({ id, name: name.trim(), description });
        setSavedTeamId(id);
        navigate(`/teams/${id}`, { replace: true });
      } else {
        const id = savedTeamId || teamId!;
        await updateTeam(id, { name: name.trim(), description });
      }
    } catch (error) {
      console.error('Failed to save team:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleAddMember = async (agentId: string) => {
    const id = savedTeamId || teamId;
    if (!id) return;
    const member = await addTeamMember(id, agentId, 'member');
    setMembers((prev) => [...prev, member]);
  };

  const handleRemoveMember = async (agentId: string) => {
    const id = savedTeamId || teamId;
    if (!id) return;
    await removeTeamMember(id, agentId);
    setMembers((prev) => prev.filter((m) => m.agent_id !== agentId));
  };

  const handleRoleChange = async (agentId: string, role: TeamMemberRole) => {
    const id = savedTeamId || teamId;
    if (!id) return;
    await updateTeamMemberRole(id, agentId, role);
    setMembers((prev) => prev.map((m) => (m.agent_id === agentId ? { ...m, role } : m)));
  };

  const memberAgentIds = new Set(members.map((m) => m.agent_id));
  const availableAgents = allAgents.filter((a) => !memberAgentIds.has(a.id));

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => navigate('/teams')}
            className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-8 items-center justify-center rounded-lg transition-colors"
          >
            <ArrowLeft className="size-4" />
          </button>
          <h1 className="text-foreground text-xl font-semibold">
            {isNew ? t.teams.create : t.teams.edit}
          </h1>
        </div>

        <div className="space-y-6">
          {/* Team Info */}
          <div className="space-y-3">
            <div>
              <label className="text-foreground mb-1.5 block text-sm font-medium">{t.teams.name}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.teams.namePlaceholder}
                className="border-border bg-background focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
              />
            </div>
            <div>
              <label className="text-foreground mb-1.5 block text-sm font-medium">{t.teams.teamDescription}</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.teams.descriptionPlaceholder}
                rows={3}
                className="border-border bg-background focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
              />
            </div>
          </div>

          {/* Members */}
          {(teamId || savedTeamId) && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-foreground text-sm font-medium">{t.teams.members}</h3>
              </div>

              {members.length > 0 && (
                <div className="border-border mb-4 divide-y rounded-lg border">
                  {members.map((member) => {
                    const agent = allAgents.find((a) => a.id === member.agent_id);
                    return (
                      <div key={member.id} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="bg-muted flex size-8 items-center justify-center rounded-lg">
                          {agent?.avatar ? (
                            <img src={agent.avatar} alt={agent.name} className="size-full rounded-lg object-cover" />
                          ) : (
                            <Bot className="text-muted-foreground size-4" />
                          )}
                        </div>
                        <span className="text-foreground flex-1 text-sm">{agent?.name || member.agent_id}</span>
                        <select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member.agent_id, e.target.value as TeamMemberRole)}
                          className="border-border bg-background rounded-md border px-2 py-1 text-xs"
                        >
                          <option value="lead">{t.teams.roleLead}</option>
                          <option value="member">{t.teams.roleMember}</option>
                          <option value="reviewer">{t.teams.roleReviewer}</option>
                        </select>
                        <button
                          onClick={() => handleRemoveMember(member.agent_id)}
                          className="text-muted-foreground hover:text-red-500 transition-colors"
                        >
                          <UserMinus className="size-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {availableAgents.length > 0 && (
                <div>
                  <p className="text-muted-foreground mb-2 text-xs">{t.teams.addMember}</p>
                  <div className="flex flex-wrap gap-2">
                    {availableAgents.map((agent) => (
                      <button
                        key={agent.id}
                        onClick={() => handleAddMember(agent.id)}
                        className="border-border hover:border-primary/30 hover:bg-accent flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors"
                      >
                        <Plus className="size-3" />
                        {agent.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {availableAgents.length === 0 && members.length === 0 && (
                <p className="text-muted-foreground text-sm">{t.teams.noAgentsAvailable}</p>
              )}
            </div>
          )}

          {/* Save */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              onClick={() => navigate('/teams')}
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
        </div>
      </div>
    </div>
  );
}
