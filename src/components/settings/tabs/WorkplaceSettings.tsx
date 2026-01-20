import { useEffect, useState } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
import { getAppDataDir } from '@/shared/lib/paths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { API_PORT } from '@/config';
import type { DependencyStatus, WorkplaceSettingsProps } from '../types';

export function WorkplaceSettings({
  settings,
  onSettingsChange,
  defaultPaths,
}: WorkplaceSettingsProps) {
  const { t } = useLanguage();
  const [dependencies, setDependencies] = useState<DependencyStatus>({
    claudeCode: true,
    node: true,
    python: true,
    codex: true,
  });
  const [checkingDeps, setCheckingDeps] = useState(true);

  // Check dependencies on mount
  useEffect(() => {
    const checkDependencies = async () => {
      setCheckingDeps(true);
      try {
        const response = await fetch(
          `http://localhost:${API_PORT}/health/dependencies`
        );
        if (response.ok) {
          const data = await response.json();
          setDependencies({
            claudeCode: data.claudeCode ?? true,
            node: data.node ?? true,
            python: data.python ?? true,
            codex: data.codex ?? true,
          });
        }
      } catch {
        // If API fails, assume all installed
      }
      setCheckingDeps(false);
    };
    checkDependencies();
  }, []);

  // Get current code environment
  const currentCodeEnv = settings.sandboxEnabled ? 'codex' : 'local';

  const handleCodeEnvChange = (envId: string) => {
    if (envId === 'local') {
      onSettingsChange({
        ...settings,
        sandboxEnabled: false,
        defaultSandboxProvider: 'native',
      });
    } else if (envId === 'codex') {
      onSettingsChange({
        ...settings,
        sandboxEnabled: true,
        defaultSandboxProvider: 'codex-cli',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          {t.settings.workplaceDescription}
        </p>
      </div>

      {/* Agent Runtime - Claude Code */}
      <div className="flex flex-col gap-2">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.agentRuntime}
        </label>
        <p className="text-muted-foreground text-xs">
          {t.settings.agentRuntimeDescription}
        </p>
        <div className="mt-2">
          <div
            className={cn(
              'flex items-center justify-between rounded-lg border px-4 py-3',
              'border-primary bg-primary/5'
            )}
          >
            <div className="flex flex-col">
              <span className="text-primary text-sm font-medium">
                {t.settings.runtimeClaudeCode}
              </span>
              <span className="text-muted-foreground text-xs">
                {t.settings.runtimeClaudeCodeDescription}
              </span>
            </div>
            {checkingDeps ? (
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            ) : !dependencies.claudeCode ? (
              <div className="text-right">
                <p className="text-destructive text-xs font-medium">
                  {t.settings.installClaudeCode}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t.settings.installClaudeCodeHint}
                </p>
              </div>
            ) : (
              <span className="text-primary text-xs">✓</span>
            )}
          </div>
        </div>
      </div>

      {/* Code Environment */}
      <div className="border-border flex flex-col gap-2 border-t pt-4">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.codeEnvironment}
        </label>
        <p className="text-muted-foreground text-xs">
          {t.settings.codeEnvironmentDescription}
        </p>
        <div className="mt-2 flex flex-col gap-2">
          {/* Local Option */}
          <button
            onClick={() => handleCodeEnvChange('local')}
            className={cn(
              'flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 text-left transition-all',
              'focus:outline-none focus-visible:outline-none',
              currentCodeEnv === 'local'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50 hover:bg-accent/50'
            )}
          >
            <div className="flex flex-col">
              <span
                className={cn(
                  'text-sm font-medium',
                  currentCodeEnv === 'local'
                    ? 'text-primary'
                    : 'text-foreground'
                )}
              >
                {t.settings.envLocal}
              </span>
              <span className="text-muted-foreground text-xs">
                {t.settings.envLocalDescription}
              </span>
            </div>
            {currentCodeEnv === 'local' && (
              <div className="flex flex-col items-end gap-1">
                {checkingDeps ? (
                  <Loader2 className="text-muted-foreground size-4 animate-spin" />
                ) : (
                  <>
                    {!dependencies.node && (
                      <div className="text-right">
                        <span className="text-destructive text-xs">
                          {t.settings.installNode}
                        </span>
                      </div>
                    )}
                    {!dependencies.python && (
                      <div className="text-right">
                        <span className="text-destructive text-xs">
                          {t.settings.installPython}
                        </span>
                      </div>
                    )}
                    {dependencies.node && dependencies.python && (
                      <span className="text-primary text-xs">✓</span>
                    )}
                  </>
                )}
              </div>
            )}
          </button>

          {/* Codex Sandbox Option */}
          <button
            onClick={() => handleCodeEnvChange('codex')}
            className={cn(
              'flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 text-left transition-all',
              'focus:outline-none focus-visible:outline-none',
              currentCodeEnv === 'codex'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50 hover:bg-accent/50'
            )}
          >
            <div className="flex flex-col">
              <span
                className={cn(
                  'text-sm font-medium',
                  currentCodeEnv === 'codex'
                    ? 'text-primary'
                    : 'text-foreground'
                )}
              >
                {t.settings.envCodexSandbox}
              </span>
              <span className="text-muted-foreground text-xs">
                {t.settings.envCodexSandboxDescription}
              </span>
            </div>
            {currentCodeEnv === 'codex' && (
              <div className="flex flex-col items-end">
                {checkingDeps ? (
                  <Loader2 className="text-muted-foreground size-4 animate-spin" />
                ) : !dependencies.codex ? (
                  <div className="text-right">
                    <p className="text-destructive text-xs font-medium">
                      {t.settings.installCodex}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t.settings.installCodexHint}
                    </p>
                  </div>
                ) : (
                  <span className="text-primary text-xs">✓</span>
                )}
              </div>
            )}
          </button>
        </div>
      </div>

      {/* Working Directory */}
      <div className="border-border flex flex-col gap-2 border-t pt-4">
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
