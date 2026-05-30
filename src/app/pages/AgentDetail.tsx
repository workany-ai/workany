import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createAgent, getAgent, updateAgent } from '@/shared/db';
import { useLanguage } from '@/shared/providers/language-provider';
import { ArrowLeft, Bot, Save } from 'lucide-react';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function AgentDetailPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { agentId } = useParams();
  const isNew = !agentId;

  const [name, setName] = useState('');
  const [soulMd, setSoulMd] = useState('');
  const [modelProvider, setModelProvider] = useState('');
  const [modelName, setModelName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (agentId) {
      getAgent(agentId).then((agent) => {
        if (agent) {
          setName(agent.name);
          setSoulMd(agent.soul_md);
          setModelProvider(agent.model_provider || '');
          setModelName(agent.model_name || '');
          setAvatar(agent.avatar || '');
        }
      });
    }
  }, [agentId]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (isNew) {
        await createAgent({
          id: generateId(),
          name: name.trim(),
          soul_md: soulMd,
          model_provider: modelProvider || undefined,
          model_name: modelName || undefined,
          avatar: avatar || undefined,
        });
      } else {
        await updateAgent(agentId!, {
          name: name.trim(),
          soul_md: soulMd,
          model_provider: modelProvider || null,
          model_name: modelName || null,
          avatar: avatar || null,
        });
      }
      navigate('/agents');
    } catch (error) {
      console.error('Failed to save agent:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => navigate('/agents')}
            className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-8 items-center justify-center rounded-lg transition-colors"
          >
            <ArrowLeft className="size-4" />
          </button>
          <h1 className="text-foreground text-xl font-semibold">
            {isNew ? t.agents.create : t.agents.edit}
          </h1>
        </div>

        <div className="space-y-6">
          {/* Avatar & Name */}
          <div className="flex items-start gap-4">
            <div className="bg-muted flex size-16 shrink-0 items-center justify-center rounded-2xl">
              {avatar ? (
                <img src={avatar} alt={name} className="size-full rounded-2xl object-cover" />
              ) : (
                <Bot className="text-muted-foreground size-8" />
              )}
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <label className="text-foreground mb-1.5 block text-sm font-medium">{t.agents.name}</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.agents.namePlaceholder}
                  className="border-border bg-background focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
                />
              </div>
              <div>
                <label className="text-foreground mb-1.5 block text-sm font-medium">{t.agents.avatarUrl}</label>
                <input
                  type="text"
                  value={avatar}
                  onChange={(e) => setAvatar(e.target.value)}
                  placeholder="https://..."
                  className="border-border bg-background focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Soul.md */}
          <div>
            <label className="text-foreground mb-1.5 block text-sm font-medium">{t.agents.soulMd}</label>
            <p className="text-muted-foreground mb-2 text-xs">{t.agents.soulMdDescription}</p>
            <textarea
              value={soulMd}
              onChange={(e) => setSoulMd(e.target.value)}
              placeholder={t.agents.soulMdPlaceholder}
              rows={12}
              className="border-border bg-background focus:border-primary w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none transition-colors"
            />
          </div>

          {/* Model Configuration */}
          <div className="space-y-3">
            <h3 className="text-foreground text-sm font-medium">{t.agents.modelConfig}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">{t.agents.modelProvider}</label>
                <input
                  type="text"
                  value={modelProvider}
                  onChange={(e) => setModelProvider(e.target.value)}
                  placeholder={t.agents.modelProviderPlaceholder}
                  className="border-border bg-background focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
                />
              </div>
              <div>
                <label className="text-muted-foreground mb-1 block text-xs">{t.agents.modelName}</label>
                <input
                  type="text"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder={t.agents.modelNamePlaceholder}
                  className="border-border bg-background focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              onClick={() => navigate('/agents')}
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
