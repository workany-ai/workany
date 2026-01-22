import { useEffect, useState } from 'react';
import { getSkillsDir } from '@/shared/lib/paths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileImage,
  FileText,
  FileType,
  FolderOpen,
  Layers,
  Loader2,
  Plus,
  Settings,
  Trash2,
  X,
} from 'lucide-react';

import { Switch } from '../components/Switch';
import { API_BASE_URL } from '../constants';
import type {
  SettingsTabProps,
  SkillFile,
  SkillInfo,
  SkillsSubTab,
} from '../types';

// Get file icon based on extension
function getSkillFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'md':
    case 'markdown':
      return FileType;
    case 'json':
      return FileText;
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx':
    case 'py':
      return FileCode2;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return FileImage;
    default:
      return File;
  }
}

// File tree item component
function SkillFileTreeItem({
  file,
  depth = 0,
}: {
  file: SkillFile;
  depth?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(depth === 0);
  const IconComponent = file.isDir ? FolderOpen : getSkillFileIcon(file.name);

  return (
    <div>
      <button
        onClick={() => file.isDir && setIsExpanded(!isExpanded)}
        className={cn(
          'flex w-full items-center gap-1 rounded-md py-1 text-left transition-colors',
          file.isDir ? 'hover:bg-accent/50 cursor-pointer' : 'cursor-default'
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {file.isDir && (
          <span className="text-muted-foreground shrink-0">
            {isExpanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </span>
        )}
        {!file.isDir && <span className="w-3" />}
        <IconComponent className="text-muted-foreground size-4 shrink-0" />
        <span className="truncate text-sm">{file.name}</span>
      </button>
      {file.isDir && isExpanded && file.children && (
        <div>
          {file.children.map((child) => (
            <SkillFileTreeItem
              key={child.path}
              file={child}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Helper function to open external URLs
const openExternalUrl = async (url: string) => {
  try {
    await openUrl(url);
  } catch {
    window.open(url, '_blank');
  }
};

export function SkillsSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<SkillsSubTab>('settings');
  const [showAddSkill, setShowAddSkill] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newSkill, setNewSkill] = useState({
    name: '',
    source: 'workany' as 'claude' | 'workany',
  });
  const { t } = useLanguage();

  const selectedSkill = skills.find((s) => s.id === activeSubTab);

  const isSkillConfigured = (skill: SkillInfo) => {
    return skill.files.length > 0;
  };

  const sortedSkills = [...skills].sort((a, b) => {
    const aConfigured = isSkillConfigured(a);
    const bConfigured = isSkillConfigured(b);
    if (a.enabled && aConfigured && !(b.enabled && bConfigured)) return -1;
    if (b.enabled && bConfigured && !(a.enabled && aConfigured)) return 1;
    if (aConfigured && !bConfigured) return -1;
    if (bConfigured && !aConfigured) return 1;
    return 0;
  });

  const loadSkillsFromPath = async (skillsPath: string) => {
    if (!skillsPath) {
      setSkills([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const filesResponse = await fetch(`${API_BASE_URL}/files/readdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: skillsPath, maxDepth: 3 }),
      });
      const filesData = await filesResponse.json();

      const allSkills: SkillInfo[] = [];

      if (filesData.success && filesData.files) {
        for (const folder of filesData.files) {
          if (folder.isDir) {
            allSkills.push({
              id: `workany-${folder.name}`,
              name: folder.name,
              source: 'workany',
              path: folder.path,
              files: folder.children || [],
              enabled: true,
            });
          }
        }
      }

      setSkills(allSkills);
    } catch (err) {
      console.error('[Skills] Failed to load skills:', err);
      setSkills([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSkillsFromPath(settings.skillsPath);
  }, [settings.skillsPath]);

  const handleSkillUpdate = (skillId: string, updates: Partial<SkillInfo>) => {
    const newSkills = skills.map((s) => {
      if (s.id !== skillId) return s;
      const updated = { ...s, ...updates };
      if (!isSkillConfigured(updated) && updated.enabled) {
        updated.enabled = false;
      }
      return updated;
    });
    setSkills(newSkills);
  };

  const handleAddSkill = async () => {
    if (!newSkill.name) return;

    try {
      const dirsResponse = await fetch(`${API_BASE_URL}/files/skills-dir`);
      const dirsData = await dirsResponse.json();
      const targetDir = dirsData.directories?.find(
        (d: { name: string; exists: boolean }) =>
          d.name === newSkill.source && d.exists
      );

      if (!targetDir) {
        console.error('[Skills] Target directory not found');
        return;
      }

      const skillPath = `${targetDir.path}/${newSkill.name}`;

      const createResponse = await fetch(`${API_BASE_URL}/sandbox/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: `mkdir -p "${skillPath}" && echo '# ${newSkill.name}\n\nSkill description here.' > "${skillPath}/README.md"`,
          workDir: targetDir.path,
        }),
      });

      if (createResponse.ok) {
        const newSkillInfo: SkillInfo = {
          id: `${newSkill.source}-${newSkill.name}`,
          name: newSkill.name,
          source: newSkill.source,
          path: skillPath,
          files: [
            { name: 'README.md', path: `${skillPath}/README.md`, isDir: false },
          ],
          enabled: false,
        };

        setSkills([...skills, newSkillInfo]);
        setActiveSubTab(newSkillInfo.id);
        setNewSkill({ name: '', source: 'workany' });
        setShowAddSkill(false);
      }
    } catch (err) {
      console.error('[Skills] Failed to add skill:', err);
    }
  };

  const handleDeleteSkill = async (skillId: string) => {
    const skill = skills.find((s) => s.id === skillId);
    if (!skill) return;

    try {
      await fetch(`${API_BASE_URL}/sandbox/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: `rm -rf "${skill.path}"`,
          workDir: skill.path.split('/').slice(0, -1).join('/'),
        }),
      });

      const newSkills = skills.filter((s) => s.id !== skillId);
      setSkills(newSkills);
      setActiveSubTab('settings');
    } catch (err) {
      console.error('[Skills] Failed to delete skill:', err);
    }
  };

  if (loading) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
        <Loader2 className="size-4 animate-spin" />
        {t.common.loading}
      </div>
    );
  }

  return (
    <div className="-m-6 flex h-[calc(100%+48px)]">
      {/* Left Panel */}
      <div className="border-border flex w-52 flex-col border-r">
        <div className="space-y-0.5 p-2">
          <button
            onClick={() => {
              setActiveSubTab('settings');
              setShowAddSkill(false);
            }}
            className={cn(
              'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-200',
              activeSubTab === 'settings' && !showAddSkill
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-foreground/70 hover:bg-accent/50 hover:text-foreground'
            )}
          >
            <Settings className="size-4" />
            <span className="flex-1 text-left">
              {t.settings.skillsSettings}
            </span>
          </button>
        </div>

        <div className="border-border border-t">
          <div className="text-muted-foreground flex items-center px-4 py-2 text-xs font-medium">
            {t.settings.skillsList}
          </div>
          <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
            {sortedSkills.length === 0 ? (
              <div className="text-muted-foreground p-2 text-center text-xs">
                {t.settings.skillsEmpty}
              </div>
            ) : (
              sortedSkills.map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => {
                    setActiveSubTab(skill.id);
                    setShowAddSkill(false);
                  }}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-200',
                    activeSubTab === skill.id && !showAddSkill
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-foreground/70 hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  <span className="bg-muted text-muted-foreground relative flex size-6 items-center justify-center rounded">
                    <Layers className="size-3.5" />
                    {isSkillConfigured(skill) && (
                      <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-emerald-500" />
                    )}
                  </span>
                  <span className="flex-1 truncate text-left">
                    {skill.name}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="border-border mt-auto flex items-center gap-1 border-t p-2">
          <button
            onClick={() => setShowAddSkill(true)}
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded transition-colors"
            title={t.settings.skillsAdd}
          >
            <Plus className="size-4" />
          </button>
          {selectedSkill && (
            <button
              onClick={() => handleDeleteSkill(selectedSkill.id)}
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-7 items-center justify-center rounded transition-colors"
              title={t.settings.skillsDelete}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 overflow-y-auto">
        {showAddSkill ? (
          <div className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-foreground text-base font-medium">
                {t.settings.skillsAdd}
              </h3>
              <button
                onClick={() => setShowAddSkill(false)}
                className="hover:bg-muted rounded p-1"
              >
                <X className="text-muted-foreground size-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  {t.settings.skillsName}
                </label>
                <input
                  type="text"
                  value={newSkill.name}
                  onChange={(e) =>
                    setNewSkill({ ...newSkill, name: e.target.value })
                  }
                  placeholder="my-skill"
                  className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  {t.settings.skillsSource}
                </label>
                <div className="text-muted-foreground flex h-10 items-center rounded-lg text-sm">
                  ~/.workany/skills
                </div>
              </div>

              <button
                onClick={handleAddSkill}
                disabled={!newSkill.name}
                className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4 h-10 w-full rounded-lg text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t.settings.add}
              </button>
            </div>
          </div>
        ) : activeSubTab === 'settings' ? (
          <div className="p-6">
            <div className="space-y-6">
              <div>
                <p className="text-muted-foreground text-sm">
                  {t.settings.skillsDescription}
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-foreground text-sm font-medium">
                    {t.settings.skillsEnabled}
                  </label>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t.settings.skillsEnabledDescription}
                  </p>
                </div>
                <Switch
                  checked={settings.skillsEnabled ?? true}
                  onChange={(checked) =>
                    onSettingsChange({ ...settings, skillsEnabled: checked })
                  }
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  {t.settings.skillsPath}
                </label>
                <p className="text-muted-foreground text-xs">
                  {t.settings.skillsPathDescription}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      try {
                        const selected = await openDialog({
                          directory: true,
                          multiple: false,
                          defaultPath: settings.skillsPath || undefined,
                        });
                        if (selected && typeof selected === 'string') {
                          onSettingsChange({
                            ...settings,
                            skillsPath: selected,
                          });
                        }
                      } catch (err) {
                        console.error(
                          '[Skills] Failed to open folder dialog:',
                          err
                        );
                      }
                    }}
                    className="border-input bg-background text-foreground hover:bg-accent relative h-10 max-w-md flex-1 cursor-pointer rounded-lg border pr-3 pl-10 text-left text-sm transition-colors"
                  >
                    <FolderOpen className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <span className="truncate">
                      {settings.skillsPath ||
                        `${settings.workDir || '~/.workany'}/skills`}
                    </span>
                  </button>
                  <button
                    onClick={async () => {
                      // Reset to workDir/skills
                      const workDir =
                        settings.workDir ||
                        (await getSkillsDir()).replace('/skills', '');
                      onSettingsChange({
                        ...settings,
                        skillsPath: `${workDir}/skills`,
                      });
                    }}
                    className="text-muted-foreground hover:text-foreground border-border hover:bg-accent h-10 cursor-pointer rounded-lg border px-3 text-sm transition-colors"
                  >
                    {t.common.reset}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : selectedSkill ? (
          <div className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-foreground text-base font-medium">
                {selectedSkill.name}
              </h3>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <div
                    className={cn(
                      'size-2 rounded-full',
                      isSkillConfigured(selectedSkill)
                        ? 'bg-emerald-500'
                        : 'bg-gray-300'
                    )}
                  />
                  <span className="text-muted-foreground text-xs">
                    {isSkillConfigured(selectedSkill)
                      ? t.settings.configured
                      : t.settings.notConfigured}
                  </span>
                </div>
                <Switch
                  checked={selectedSkill.enabled}
                  onChange={(checked) =>
                    handleSkillUpdate(selectedSkill.id, { enabled: checked })
                  }
                  disabled={!isSkillConfigured(selectedSkill)}
                />
              </div>
            </div>

            <div className="space-y-6">
              <div className="flex flex-col gap-2">
                <label className="text-foreground text-sm font-medium">
                  {t.settings.skillsSource}
                </label>
                <p className="text-muted-foreground text-xs">
                  {selectedSkill.path}
                </p>
              </div>

              <div className="space-y-3">
                <label className="text-foreground text-sm font-medium">
                  {t.settings.skillsFiles}
                </label>
                <div className="border-border bg-muted/30 max-h-[300px] overflow-y-auto rounded-lg border p-2">
                  {selectedSkill.files.length === 0 ? (
                    <p className="text-muted-foreground py-4 text-center text-sm">
                      {t.settings.skillsNoFiles}
                    </p>
                  ) : (
                    selectedSkill.files.map((file) => (
                      <SkillFileTreeItem key={file.path} file={file} />
                    ))
                  )}
                </div>
              </div>

              <button
                onClick={() => {
                  openExternalUrl(`file://${selectedSkill.path}`);
                }}
                className="border-border text-foreground hover:bg-accent flex h-10 items-center gap-2 rounded-lg border px-4 text-sm transition-colors"
              >
                <FolderOpen className="size-4" />
                {t.settings.skillsOpenFolder}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            {t.settings.skillsSelect}
          </div>
        )}
      </div>
    </div>
  );
}
