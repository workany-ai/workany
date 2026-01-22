import { getAppDataDir } from '@/shared/lib/paths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { FolderOpen, Shield, ShieldOff } from 'lucide-react';

import type { WorkplaceSettingsProps } from '../types';

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
          <div className="relative max-w-md flex-1">
            <FolderOpen className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              type="text"
              value={settings.workDir}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  workDir: e.target.value,
                })
              }
              placeholder={defaultPaths.workDir || 'Loading...'}
              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border pr-3 pl-10 text-sm focus:border-transparent focus:ring-2 focus:outline-none"
            />
          </div>
          <button
            onClick={async () => {
              const workDir = await getAppDataDir();
              onSettingsChange({
                ...settings,
                workDir,
              });
            }}
            className="text-muted-foreground hover:text-foreground border-border hover:bg-accent h-10 cursor-pointer rounded-lg border px-3 text-sm transition-colors"
          >
            {t.common.reset}
          </button>
        </div>
        <p className="text-muted-foreground text-xs">
          {t.settings.directoryStructure.replace('{path}', settings.workDir)}
        </p>
      </div>
    </div>
  );
}
