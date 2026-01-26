import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { FileText, FolderOpen, Shield, ShieldOff } from 'lucide-react';

import { API_BASE_URL } from '../constants';
import type { WorkplaceSettingsProps } from '../types';

// Helper function to open folder in system file manager
const openFolderInSystem = async (folderPath: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/files/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath, expandHome: true }),
    });
    const data = await response.json();
    if (!data.success) {
      console.error('[Workspace] Failed to open folder:', data.error);
    }
  } catch (err) {
    console.error('[Workspace] Error opening folder:', err);
  }
};

// Sandbox options (only codex and native, others hidden)
const sandboxOptions = [
  {
    id: 'codex',
    icon: Shield,
    nameKey: 'sandboxCodex',
    descKey: 'sandboxCodexDescription',
  },
  {
    id: 'native',
    icon: ShieldOff,
    nameKey: 'sandboxNative',
    descKey: 'sandboxNativeDescription',
  },
] as const;

export function WorkplaceSettings({
  settings,
  onSettingsChange,
  defaultPaths,
}: WorkplaceSettingsProps) {
  const { t } = useLanguage();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          {t.settings.workplaceDescription}
        </p>
      </div>

      {/* Default Sandbox */}
      <div className="flex flex-col gap-2">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.defaultSandbox}
        </label>
        <p className="text-muted-foreground text-xs">
          {t.settings.defaultSandboxDescription}
        </p>
        <div className="grid max-w-md grid-cols-2 gap-2">
          {sandboxOptions.map((option) => {
            const Icon = option.icon;
            const isSelected = settings.defaultSandboxProvider === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() =>
                  onSettingsChange({
                    ...settings,
                    sandboxEnabled: true, // Always enable sandbox when selecting a provider
                    defaultSandboxProvider: option.id,
                  })
                }
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-accent'
                )}
              >
                <Icon
                  className={cn(
                    'size-5 shrink-0',
                    isSelected ? 'text-primary' : 'text-muted-foreground'
                  )}
                />
                <div className="min-w-0">
                  <div
                    className={cn(
                      'text-sm font-medium',
                      isSelected ? 'text-primary' : 'text-foreground'
                    )}
                  >
                    {t.settings[option.nameKey as keyof typeof t.settings]}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    {t.settings[option.descKey as keyof typeof t.settings]}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Working Directory */}
      <div className="flex flex-col gap-2">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.workingDirectory}
        </label>
        <p className="text-muted-foreground text-xs">
          {t.settings.workingDirectoryDescription}
        </p>
        <div className="flex items-center gap-2">
          <div className="border-input bg-muted text-foreground flex h-10 max-w-md flex-1 items-center rounded-lg border px-3 text-sm">
            {settings.workDir || defaultPaths.workDir || 'Loading...'}
          </div>
          <button
            onClick={() => openFolderInSystem(settings.workDir || defaultPaths.workDir)}
            className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-2 transition-colors"
            title={t.settings.skillsOpenFolder}
          >
            <FolderOpen className="size-5" />
          </button>
        </div>
        <p className="text-muted-foreground text-xs">
          {t.settings.directoryStructure.replace('{path}', settings.workDir)}
        </p>
      </div>

      {/* Log File */}
      <div className="flex flex-col gap-2">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.logFile}
        </label>
        <p className="text-muted-foreground text-xs">
          {t.settings.logFileDescription}
        </p>
        <div className="flex items-center gap-2">
          <div className="border-input bg-muted text-foreground flex h-10 max-w-md flex-1 items-center rounded-lg border px-3 text-sm">
            {`${settings.workDir || defaultPaths.workDir}/logs/workany.log`}
          </div>
          <button
            onClick={() => openFolderInSystem(`${settings.workDir || defaultPaths.workDir}/logs/workany.log`)}
            className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-2 transition-colors"
            title={t.settings.logFileOpen}
          >
            <FileText className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
