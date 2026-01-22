/**
 * Data Settings - Export, Import, and Clear Data
 */

import { useState } from 'react';
import {
  deleteMessagesByTaskId,
  deleteTask,
  getAllFiles,
  getAllSessions,
  getAllTasks,
  getMessagesByTaskId,
} from '@/shared/db/database';
import {
  clearAllSettings,
  getSettings,
  saveSettings,
  type Settings,
} from '@/shared/db/settings';
import { getSessionsDir } from '@/shared/lib/paths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react';

// Check if running in Tauri environment
function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

interface ExportData {
  version: number;
  exportedAt: string;
  sessions: unknown[];
  tasks: unknown[];
  messages: unknown[];
  files: unknown[];
  settings?: Settings;
}

type OperationStatus = 'idle' | 'loading' | 'success' | 'error';

export function DataSettings() {
  const { t } = useLanguage();
  const [exportStatus, setExportStatus] = useState<OperationStatus>('idle');
  const [importStatus, setImportStatus] = useState<OperationStatus>('idle');
  const [clearStatus, setClearStatus] = useState<OperationStatus>('idle');
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Export all data
  const handleExport = async () => {
    setExportStatus('loading');
    setErrorMessage('');

    try {
      // Gather all data
      const sessions = await getAllSessions();
      const tasks = await getAllTasks();
      const files = await getAllFiles();
      const settings = getSettings();

      // Get messages for each task
      const allMessages: unknown[] = [];
      for (const task of tasks) {
        const messages = await getMessagesByTaskId(task.id);
        allMessages.push(...messages);
      }

      const exportData: ExportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        sessions,
        tasks,
        messages: allMessages,
        files,
        settings,
      };

      const jsonString = JSON.stringify(exportData, null, 2);
      const filename = `workany-backup-${new Date().toISOString().split('T')[0]}.json`;

      // Use Tauri native dialog
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');

      const filePath = await save({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: filename,
      });

      if (filePath) {
        await writeTextFile(filePath, jsonString);
        setExportStatus('success');
        setTimeout(() => setExportStatus('idle'), 2000);
      } else {
        // User cancelled
        setExportStatus('idle');
      }
    } catch (error) {
      console.error('[DataSettings] Export failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Export failed');
      setExportStatus('error');
      setTimeout(() => setExportStatus('idle'), 3000);
    }
  };

  // Import data from file
  const handleImport = async () => {
    setImportStatus('loading');
    setErrorMessage('');

    try {
      // Use Tauri native dialog
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');

      const filePath = await open({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        multiple: false,
      });

      if (!filePath) {
        // User cancelled
        setImportStatus('idle');
        return;
      }

      const content = await readTextFile(filePath as string);
      const data = JSON.parse(content) as ExportData;

      // Validate data format
      if (!data.version || !data.tasks) {
        throw new Error('Invalid data format');
      }

      // Import settings if included
      if (data.settings) {
        saveSettings(data.settings);
      }

      // Note: Full import would require database insert operations
      // For now, we just import settings
      // TODO: Implement full data import with database operations

      setImportStatus('success');
      setTimeout(() => {
        setImportStatus('idle');
        // Reload page to apply imported settings
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error('[DataSettings] Import failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Import failed');
      setImportStatus('error');
      setTimeout(() => setImportStatus('idle'), 3000);
    }
  };

  // Clear workspace files (sessions directory)
  const clearWorkspaceFiles = async () => {
    if (!isTauri()) return;

    try {
      const sessionsDir = await getSessionsDir();
      const { remove, exists } = await import('@tauri-apps/plugin-fs');

      // Check if sessions directory exists
      const dirExists = await exists(sessionsDir);
      if (dirExists) {
        // Remove the entire sessions directory recursively
        await remove(sessionsDir, { recursive: true });
        console.log('[DataSettings] Cleared workspace files:', sessionsDir);
      }
    } catch (error) {
      console.warn('[DataSettings] Failed to clear workspace files:', error);
      // Don't throw - continue with database cleanup even if file cleanup fails
    }
  };

  // Clear data
  const handleClear = async (clearSettings: boolean) => {
    setClearStatus('loading');
    setErrorMessage('');
    setShowClearDialog(false);

    try {
      // Clear workspace files first
      await clearWorkspaceFiles();

      // Get all tasks and delete them with their messages
      const tasks = await getAllTasks();
      for (const task of tasks) {
        await deleteMessagesByTaskId(task.id);
        await deleteTask(task.id);
      }

      // Clear settings if requested
      if (clearSettings) {
        await clearAllSettings();
      }

      setClearStatus('success');
      setTimeout(() => {
        setClearStatus('idle');
        // Reload page to reflect changes
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error('[DataSettings] Clear failed:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Clear failed');
      setClearStatus('error');
      setTimeout(() => setClearStatus('idle'), 3000);
    }
  };

  const getButtonContent = (
    status: OperationStatus,
    icon: React.ReactNode,
    label: string,
    loadingLabel: string
  ) => {
    if (status === 'loading') {
      return (
        <>
          <Loader2 className="size-4 animate-spin" />
          <span>{loadingLabel}</span>
        </>
      );
    }
    if (status === 'success') {
      return (
        <>
          <CheckCircle2 className="size-4 text-green-500" />
          <span>{t.settings.dataSuccess || 'Success'}</span>
        </>
      );
    }
    return (
      <>
        {icon}
        <span>{label}</span>
      </>
    );
  };

  return (
    <div className="space-y-6">
      {/* Description */}
      <p className="text-muted-foreground text-sm">
        {t.settings.dataDescription ||
          'Manage your data: export backups, import data, or clear all data.'}
      </p>

      {/* Export Data */}
      <div className="border-border rounded-lg border p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-foreground font-medium">
              {t.settings.dataExport || 'Export Data'}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {t.settings.dataExportDescription ||
                'Export all tasks, messages, and settings to a JSON file.'}
            </p>
          </div>
          <button
            onClick={handleExport}
            disabled={exportStatus === 'loading'}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'bg-primary text-primary-foreground hover:bg-primary/90',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {getButtonContent(
              exportStatus,
              <Download className="size-4" />,
              t.settings.dataExportButton || 'Export',
              t.settings.dataExporting || 'Exporting...'
            )}
          </button>
        </div>
      </div>

      {/* Import Data */}
      <div className="border-border rounded-lg border p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-foreground font-medium">
              {t.settings.dataImport || 'Import Data'}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {t.settings.dataImportDescription ||
                'Import data from a previously exported JSON file.'}
            </p>
          </div>
          <button
            onClick={handleImport}
            disabled={importStatus === 'loading'}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'border-border text-foreground hover:bg-accent border',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {getButtonContent(
              importStatus,
              <Upload className="size-4" />,
              t.settings.dataImportButton || 'Import',
              t.settings.dataImporting || 'Importing...'
            )}
          </button>
        </div>
      </div>

      {/* Clear Data */}
      <div className="border-border rounded-lg border border-red-500/20 bg-red-500/5 p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-foreground font-medium">
              {t.settings.dataClear || 'Clear Data'}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {t.settings.dataClearDescription ||
                'Permanently delete all data. This action cannot be undone.'}
            </p>
          </div>
          <button
            onClick={() => setShowClearDialog(true)}
            disabled={clearStatus === 'loading'}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              'bg-red-500/10 text-red-500 hover:bg-red-500/20',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {getButtonContent(
              clearStatus,
              <Trash2 className="size-4" />,
              t.settings.dataClearButton || 'Clear',
              t.settings.dataClearing || 'Clearing...'
            )}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 p-3 text-red-500">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="text-sm">{errorMessage}</span>
        </div>
      )}

      {/* Clear Confirmation Dialog */}
      {showClearDialog && (
        <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="border-border bg-background mx-4 w-full max-w-md rounded-xl border p-6 shadow-lg">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                <AlertTriangle className="size-5" />
              </div>
              <h3 className="text-foreground text-lg font-semibold">
                {t.settings.dataClearConfirmTitle || 'Clear Data'}
              </h3>
            </div>

            <p className="text-muted-foreground mb-6 text-sm">
              {t.settings.dataClearConfirmDescription ||
                'Choose what data you want to clear:'}
            </p>

            <div className="space-y-3">
              <button
                onClick={() => handleClear(false)}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-4 py-3 text-left transition-colors',
                  'border-border hover:bg-accent border'
                )}
              >
                <div>
                  <div className="text-foreground font-medium">
                    {t.settings.dataClearTasksOnly || 'Clear Tasks Only'}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {t.settings.dataClearTasksOnlyDescription ||
                      'Delete all tasks and messages, keep settings'}
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleClear(true)}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-4 py-3 text-left transition-colors',
                  'border border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
                )}
              >
                <div>
                  <div className="font-medium text-red-500">
                    {t.settings.dataClearAll || 'Clear All Data'}
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {t.settings.dataClearAllDescription ||
                      'Delete all tasks, messages, and settings'}
                  </div>
                </div>
              </button>
            </div>

            <button
              onClick={() => setShowClearDialog(false)}
              className="text-muted-foreground hover:text-foreground mt-4 w-full py-2 text-center text-sm transition-colors"
            >
              {t.settings.dataCancel || 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
