import { useEffect, useState } from 'react';
import { getPathSeparator } from '@/shared/lib/paths';
import { useLanguage } from '@/shared/providers/language-provider';
import { FileText, FolderOpen } from 'lucide-react';

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

export function WorkplaceSettings({
  settings,
  defaultPaths,
}: WorkplaceSettingsProps) {
  const { t } = useLanguage();
  const [pathSep, setPathSep] = useState('/');

  // Load platform-aware path separator
  useEffect(() => {
    getPathSeparator().then(setPathSep);
  }, []);

  // Get the log file path using the correct separator
  const getLogFilePath = (workDir: string) => {
    return `${workDir}${pathSep}logs${pathSep}workany.log`;
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          {t.settings.workplaceDescription}
        </p>
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
            {getLogFilePath(settings.workDir || defaultPaths.workDir)}
          </div>
          <button
            onClick={() => openFolderInSystem(getLogFilePath(settings.workDir || defaultPaths.workDir))}
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
