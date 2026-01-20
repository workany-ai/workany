/**
 * Setup Page - First-time dependency installation
 *
 * Checks if required CLI tools (Claude Code, Codex) are installed
 * and guides users through installation.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';

import { useLanguage } from '@/shared/providers/language-provider';
import { cn } from '@/shared/lib/utils';
import { saveSettingItem } from '@/shared/db/settings';

import { API_BASE_URL } from '@/config';

// Helper function to open external URLs
const openExternalUrl = async (url: string) => {
  try {
    await openUrl(url);
  } catch {
    window.open(url, '_blank');
  }
};

interface DependencyStatus {
  id: string;
  name: string;
  description: string;
  required: boolean;
  installed: boolean;
  version?: string;
  installUrl: string;
}

interface InstallCommands {
  npm?: string;
  brew?: string;
  manual?: string;
}

type InstallState = 'idle' | 'installing' | 'success' | 'error';

export function SetupPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [dependencies, setDependencies] = useState<DependencyStatus[]>([]);
  const [allRequiredInstalled, setAllRequiredInstalled] = useState(false);
  const [expandedDep, setExpandedDep] = useState<string | null>(null);
  const [installCommands, setInstallCommands] = useState<Record<string, InstallCommands>>({});
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({});
  const [installErrors, setInstallErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Check dependencies on mount
  useEffect(() => {
    checkDependencies();
  }, []);

  const checkDependencies = async () => {
    setLoading(true);
    setApiError(null);

    // Retry logic for API not ready
    const maxRetries = 5;
    const retryDelay = 1000;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(`${API_BASE_URL}/health/dependencies`);
        const data = await response.json();

        if (data.success) {
          setDependencies(data.dependencies);
          setAllRequiredInstalled(data.allRequiredInstalled);
          setRetryCount(0);

          // Load install commands for not-installed deps
          for (const dep of data.dependencies) {
            if (!dep.installed) {
              loadInstallCommands(dep.id);
            }
          }
          setLoading(false);
          return;
        }
      } catch (error) {
        console.error(`[Setup] Attempt ${attempt + 1}/${maxRetries} failed:`, error);
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          setRetryCount(attempt + 1);
        } else {
          setApiError(
            error instanceof Error
              ? error.message
              : 'Unable to connect to API service. Please restart the app.'
          );
        }
      }
    }
    setLoading(false);
  };

  const loadInstallCommands = async (depId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/health/dependencies/${depId}/install-commands`);
      const data = await response.json();
      if (data.success) {
        setInstallCommands((prev) => ({
          ...prev,
          [depId]: data.commands,
        }));
      }
    } catch (error) {
      console.error(`[Setup] Failed to load install commands for ${depId}:`, error);
    }
  };

  const handleInstall = async (depId: string, method: 'npm' | 'brew' | 'auto') => {
    setInstallStates((prev) => ({ ...prev, [depId]: 'installing' }));
    setInstallErrors((prev) => ({ ...prev, [depId]: '' }));

    try {
      const response = await fetch(`${API_BASE_URL}/health/dependencies/${depId}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method }),
      });

      const data = await response.json();

      if (data.success && data.installed) {
        setInstallStates((prev) => ({ ...prev, [depId]: 'success' }));
        // Refresh dependencies list
        setTimeout(checkDependencies, 1000);
      } else {
        setInstallStates((prev) => ({ ...prev, [depId]: 'error' }));
        setInstallErrors((prev) => ({
          ...prev,
          [depId]: data.error || data.message || 'Installation failed',
        }));
      }
    } catch (error) {
      setInstallStates((prev) => ({ ...prev, [depId]: 'error' }));
      setInstallErrors((prev) => ({
        ...prev,
        [depId]: error instanceof Error ? error.message : 'Installation failed',
      }));
    }
  };

  const handleContinue = async () => {
    // Mark setup as completed
    await saveSettingItem('setupCompleted', 'true');
    navigate('/');
  };

  const handleSkip = async () => {
    // Mark setup as completed even if skipped
    await saveSettingItem('setupCompleted', 'true');
    navigate('/');
  };

  if (loading) {
    return (
      <div className="bg-background flex min-h-svh items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="text-primary size-8 animate-spin" />
          <p className="text-muted-foreground">
            {retryCount > 0
              ? `${t.setup?.connecting || 'Connecting to service'}... (${retryCount}/5)`
              : t.setup?.checking || 'Checking dependencies...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background flex min-h-svh flex-col">
      {/* Header */}
      <div className="border-border border-b px-8 py-6">
        <h1 className="text-foreground text-2xl font-semibold">
          {t.setup?.title || 'Welcome to WorkAny'}
        </h1>
        <p className="text-muted-foreground mt-2">
          {t.setup?.subtitle || "Let's make sure you have all the required tools installed"}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {/* API Error */}
          {apiError && (
            <div className="border-border rounded-xl border bg-red-500/5 p-6">
              <div className="flex items-start gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                  <AlertCircle className="size-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-foreground font-medium">
                    {t.setup?.apiError || 'Unable to check dependencies'}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-sm">{apiError}</p>
                  <button
                    onClick={checkDependencies}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                  >
                    <RefreshCw className="size-4" />
                    {t.setup?.retry || 'Retry'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* No dependencies loaded yet */}
          {!apiError && dependencies.length === 0 && (
            <div className="border-border rounded-xl border p-6 text-center">
              <p className="text-muted-foreground">
                {t.setup?.noDeps || 'No dependencies to check'}
              </p>
            </div>
          )}

          {dependencies.map((dep) => {
            const isExpanded = expandedDep === dep.id;
            const commands = installCommands[dep.id];
            const installState = installStates[dep.id] || 'idle';
            const error = installErrors[dep.id];

            return (
              <div
                key={dep.id}
                className={cn(
                  'border-border rounded-xl border transition-all',
                  dep.installed ? 'bg-muted/30' : 'bg-background'
                )}
              >
                {/* Dependency Header */}
                <div className="flex items-center gap-4 p-4">
                  {/* Status Icon */}
                  <div
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-full',
                      dep.installed
                        ? 'bg-green-500/10 text-green-500'
                        : dep.required
                          ? 'bg-orange-500/10 text-orange-500'
                          : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {dep.installed ? (
                      <CheckCircle2 className="size-5" />
                    ) : (
                      <Terminal className="size-5" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground font-medium">{dep.name}</span>
                      {dep.required && !dep.installed && (
                        <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-500">
                          {t.setup?.required || 'Required'}
                        </span>
                      )}
                      {!dep.required && (
                        <span className="text-muted-foreground rounded bg-gray-500/10 px-1.5 py-0.5 text-[10px] font-medium">
                          {t.setup?.optional || 'Optional'}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-sm">{dep.description}</p>
                    {dep.installed && dep.version && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {t.setup?.version || 'Version'}: {dep.version}
                      </p>
                    )}
                  </div>

                  {/* Action */}
                  {dep.installed ? (
                    <Check className="size-5 shrink-0 text-green-500" />
                  ) : (
                    <button
                      onClick={() => setExpandedDep(isExpanded ? null : dep.id)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-5" />
                      ) : (
                        <ChevronRight className="size-5" />
                      )}
                    </button>
                  )}
                </div>

                {/* Install Options (Expanded) */}
                {!dep.installed && isExpanded && (
                  <div className="border-border border-t px-4 py-4">
                    {/* Install Buttons */}
                    <div className="mb-4 flex flex-wrap gap-2">
                      {/* Auto Install */}
                      <button
                        onClick={() => handleInstall(dep.id, 'auto')}
                        disabled={installState === 'installing'}
                        className={cn(
                          'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                          'bg-primary text-primary-foreground hover:bg-primary/90',
                          'disabled:cursor-not-allowed disabled:opacity-50'
                        )}
                      >
                        {installState === 'installing' ? (
                          <>
                            <Loader2 className="size-4 animate-spin" />
                            {t.setup?.installing || 'Installing...'}
                          </>
                        ) : (
                          <>
                            <Download className="size-4" />
                            {t.setup?.autoInstall || 'Auto Install'}
                          </>
                        )}
                      </button>

                      {/* Manual Install Link */}
                      <button
                        onClick={() => openExternalUrl(dep.installUrl)}
                        className={cn(
                          'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                          'border-border text-foreground hover:bg-accent border'
                        )}
                      >
                        <ExternalLink className="size-4" />
                        {t.setup?.manualInstall || 'Manual Install'}
                      </button>
                    </div>

                    {/* Install Commands */}
                    {commands && (
                      <div className="space-y-2">
                        <p className="text-muted-foreground text-xs">
                          {t.setup?.orRunCommand || 'Or run one of these commands:'}
                        </p>
                        <div className="space-y-1.5">
                          {commands.npm && (
                            <div className="flex items-center gap-2">
                              <code className="bg-muted flex-1 rounded px-3 py-1.5 font-mono text-xs">
                                {commands.npm}
                              </code>
                              <button
                                onClick={() => handleInstall(dep.id, 'npm')}
                                disabled={installState === 'installing'}
                                className="text-muted-foreground hover:text-foreground shrink-0 text-xs disabled:opacity-50"
                              >
                                {t.setup?.run || 'Run'}
                              </button>
                            </div>
                          )}
                          {commands.brew && (
                            <div className="flex items-center gap-2">
                              <code className="bg-muted flex-1 rounded px-3 py-1.5 font-mono text-xs">
                                {commands.brew}
                              </code>
                              <button
                                onClick={() => handleInstall(dep.id, 'brew')}
                                disabled={installState === 'installing'}
                                className="text-muted-foreground hover:text-foreground shrink-0 text-xs disabled:opacity-50"
                              >
                                {t.setup?.run || 'Run'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Error Message */}
                    {installState === 'error' && error && (
                      <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 p-3 text-red-500">
                        <AlertCircle className="mt-0.5 size-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">{error}</p>
                          <button
                            onClick={() => openExternalUrl(dep.installUrl)}
                            className="mt-1 inline-flex items-center gap-1 text-xs underline"
                          >
                            {t.setup?.tryManual || 'Try manual installation'}
                            <ExternalLink className="size-3" />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Success Message */}
                    {installState === 'success' && (
                      <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-500/10 p-3 text-green-500">
                        <CheckCircle2 className="size-4" />
                        <p className="text-sm">{t.setup?.installSuccess || 'Installed successfully!'}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="border-border border-t px-8 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          {/* Refresh Button */}
          <button
            onClick={checkDependencies}
            className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm transition-colors"
          >
            <RefreshCw className="size-4" />
            {t.setup?.refresh || 'Refresh'}
          </button>

          <div className="flex items-center gap-3">
            {/* Skip Button */}
            {!allRequiredInstalled && (
              <button
                onClick={handleSkip}
                className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm transition-colors"
              >
                {t.setup?.skipForNow || 'Skip for now'}
              </button>
            )}

            {/* Continue Button */}
            <button
              onClick={handleContinue}
              disabled={!allRequiredInstalled && dependencies.some((d) => d.required && !d.installed)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors',
                allRequiredInstalled
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}
            >
              {allRequiredInstalled
                ? t.setup?.continue || 'Continue'
                : t.setup?.installRequired || 'Install required tools'}
              <ArrowRight className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
