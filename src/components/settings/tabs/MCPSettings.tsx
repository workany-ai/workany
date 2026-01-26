import { useEffect, useState } from 'react';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  ChevronDown,
  FileJson,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';

import { Switch } from '../components/Switch';
import { API_BASE_URL } from '../constants';
import type {
  MCPConfig,
  MCPServerStdio,
  MCPServerUI,
  SettingsTabProps,
} from '../types';

// MCP Card component
function MCPCard({
  server,
  onConfigure,
  onDelete,
}: {
  server: MCPServerUI;
  onConfigure: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="border-border bg-background hover:border-foreground/20 relative flex flex-col rounded-xl border p-4 transition-colors">
      <div className="mb-2">
        <span className="text-foreground text-sm font-medium">
          {server.name}
        </span>
      </div>

      <p className="text-muted-foreground mb-4 flex-1 text-xs">
        {server.type === 'stdio'
          ? t.settings.mcpTypeStdio
          : server.type === 'sse'
            ? t.settings.mcpTypeSse || 'SSE'
            : t.settings.mcpTypeHttp}
      </p>

      <div className="border-border flex items-center justify-end border-t pt-3">
        <div className="flex items-center gap-1">
          <button
            onClick={onConfigure}
            className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1.5 transition-colors"
            title={t.settings.mcpGoToConfigure}
          >
            <Settings2 className="size-4" />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1.5 transition-colors"
            >
              <MoreHorizontal className="size-4" />
            </button>
            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                />
                <div className="border-border bg-popover absolute right-0 bottom-full z-20 mb-1 min-w-max rounded-lg border py-1 shadow-lg">
                  <button
                    onClick={() => {
                      onDelete();
                      setShowMenu(false);
                    }}
                    className="hover:bg-destructive/10 text-destructive flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm whitespace-nowrap transition-colors"
                  >
                    <Trash2 className="size-3.5 shrink-0" />
                    {t.settings.mcpDeleteServer}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type MainTab = 'installed' | 'settings';

interface KeyValuePair {
  id: string;
  key: string;
  value: string;
}

interface ConfigDialogState {
  open: boolean;
  mode: 'add' | 'edit';
  serverName: string;
  transportType: 'stdio' | 'http' | 'sse';
  command: string;
  args: string[];
  env: KeyValuePair[];
  url: string;
  headers: KeyValuePair[];
  editServerId?: string;
}

const initialConfigDialog: ConfigDialogState = {
  open: false,
  mode: 'add',
  serverName: '',
  transportType: 'stdio',
  command: '',
  args: [],
  env: [],
  url: '',
  headers: [],
};

export function MCPSettings({ settings, onSettingsChange }: SettingsTabProps) {
  const [servers, setServers] = useState<MCPServerUI[]>([]);
  const [mainTab, setMainTab] = useState<MainTab>('installed');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [mcpDirs, setMcpDirs] = useState<{ user: string; app: string }>({
    user: '',
    app: '',
  });

  // Import by JSON dialog
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importJson, setImportJson] = useState('');

  // Config dialog (for both add and edit)
  const [configDialog, setConfigDialog] =
    useState<ConfigDialogState>(initialConfigDialog);

  const { t } = useLanguage();

  // Filter and sort servers
  const filteredServers = servers
    .filter((server) => {
      if (
        searchQuery &&
        !server.name.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aConfigured = a.type === 'stdio' ? !!a.command : !!a.url;
      const bConfigured = b.type === 'stdio' ? !!b.command : !!b.url;
      if (aConfigured && !bConfigured) return -1;
      if (bConfigured && !aConfigured) return 1;
      return 0;
    });

  // Load MCP config from all sources
  useEffect(() => {
    async function loadMCPConfig() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE_URL}/mcp/all-configs`);
        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || 'Failed to load config');
        }

        const serverList: MCPServerUI[] = [];
        const dirs: { user: string; app: string } = { user: '', app: '' };

        for (const configInfo of result.configs as {
          name: string;
          path: string;
          exists: boolean;
          servers: Record<
            string,
            MCPServerStdio | { url: string; headers?: Record<string, string> }
          >;
        }[]) {
          if (configInfo.name === 'claude') {
            dirs.user = configInfo.path;
          } else if (configInfo.name === 'workany') {
            dirs.app = configInfo.path;
          }

          if (!configInfo.exists) continue;

          for (const [id, serverConfig] of Object.entries(configInfo.servers)) {
            const hasUrl = 'url' in serverConfig;
            const cfg = serverConfig as {
              type?: 'http' | 'sse';
              url?: string;
              headers?: Record<string, string>;
            };
            // Determine type: use explicit type if provided, otherwise default based on config
            let serverType: 'stdio' | 'http' | 'sse' = 'stdio';
            if (hasUrl) {
              serverType = cfg.type || 'http';
            }
            serverList.push({
              id: `${configInfo.name}-${id}`,
              name: id,
              type: serverType,
              enabled: true,
              command: hasUrl
                ? undefined
                : (serverConfig as MCPServerStdio).command,
              args: hasUrl ? undefined : (serverConfig as MCPServerStdio).args,
              url: hasUrl ? cfg.url : undefined,
              headers: hasUrl ? cfg.headers : undefined,
              autoExecute: true,
              source: configInfo.name as 'workany' | 'claude',
            });
          }
        }

        setMcpDirs(dirs);
        setServers(serverList);
      } catch (err) {
        console.error('[MCP] Failed to load MCP config:', err);
        setError(t.settings.mcpLoadError);
        setServers([]);
      } finally {
        setLoading(false);
      }
    }

    loadMCPConfig();
  }, []);

  // Save MCP config via API
  const saveMCPConfig = async (serverList: MCPServerUI[]) => {
    try {
      const mcpServers: Record<string, unknown> = {};
      for (const server of serverList) {
        if (server.source === 'claude') continue;
        if (server.type === 'http' || server.type === 'sse') {
          const serverConfig: Record<string, unknown> = {
            url: server.url || '',
          };
          // Only add type field for sse (http is default)
          if (server.type === 'sse') {
            serverConfig.type = 'sse';
          }
          if (server.headers && Object.keys(server.headers).length > 0) {
            serverConfig.headers = server.headers;
          }
          mcpServers[server.name] = serverConfig;
        } else {
          const serverConfig: Record<string, unknown> = {
            command: server.command || '',
          };
          if (server.args && server.args.length > 0) {
            serverConfig.args = server.args;
          }
          mcpServers[server.name] = serverConfig;
        }
      }

      const config: MCPConfig = {
        mcpServers: mcpServers as MCPConfig['mcpServers'],
      };

      const response = await fetch(`${API_BASE_URL}/mcp/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to save config');
      }
    } catch (err) {
      console.error('[MCP] Failed to save MCP config:', err);
    }
  };

  // Open folder in system file manager
  const openFolderInSystem = async (folderPath: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/files/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath, expandHome: true }),
      });
      const data = await response.json();
      if (!data.success) {
        console.error('[MCP] Failed to open folder:', data.error);
      }
    } catch (err) {
      console.error('[MCP] Error opening folder:', err);
    }
  };

  // Handle import by JSON
  const handleImportJson = () => {
    try {
      const parsed = JSON.parse(importJson);
      const mcpServers = parsed.mcpServers || parsed;

      if (!mcpServers || typeof mcpServers !== 'object') {
        console.error('[MCP] Invalid JSON format');
        return;
      }

      const newServers: MCPServerUI[] = [...servers];

      for (const [name, config] of Object.entries(mcpServers)) {
        const cfg = config as Record<string, unknown>;
        const existingIndex = newServers.findIndex(
          (s) => s.name === name && s.source === 'workany'
        );

        // Determine type: use explicit type if provided, otherwise default based on config
        let serverType: 'stdio' | 'http' | 'sse' = 'stdio';
        if (cfg.url) {
          serverType = (cfg.type as 'http' | 'sse') || 'http';
        }

        const serverData: MCPServerUI = {
          id: `workany-${name}`,
          name,
          type: serverType,
          enabled: true,
          command: cfg.command as string | undefined,
          args: cfg.args as string[] | undefined,
          url: cfg.url as string | undefined,
          headers: cfg.headers as Record<string, string> | undefined,
          autoExecute: true,
          source: 'workany',
        };

        if (existingIndex >= 0) {
          newServers[existingIndex] = serverData;
        } else {
          newServers.push(serverData);
        }
      }

      setServers(newServers);
      saveMCPConfig(newServers);
      setShowImportDialog(false);
      setImportJson('');
    } catch (err) {
      console.error('[MCP] Failed to parse JSON:', err);
    }
  };

  // Helper to convert object to KeyValuePair array
  const objectToKeyValuePairs = (
    obj: Record<string, string> | undefined
  ): KeyValuePair[] => {
    if (!obj) return [];
    return Object.entries(obj).map(([key, value], index) => ({
      id: `kv-${Date.now()}-${index}`,
      key,
      value,
    }));
  };

  // Helper to convert KeyValuePair array to object
  const keyValuePairsToObject = (
    pairs: KeyValuePair[]
  ): Record<string, string> => {
    const obj: Record<string, string> = {};
    for (const pair of pairs) {
      if (pair.key.trim()) {
        obj[pair.key] = pair.value;
      }
    }
    return obj;
  };

  // Handle configure server (open config dialog for editing)
  const handleConfigureServer = (server: MCPServerUI) => {
    setConfigDialog({
      open: true,
      mode: 'edit',
      serverName: server.name,
      transportType: server.type,
      command: server.command || '',
      args: server.args || [],
      env: [],
      url: server.url || '',
      headers: objectToKeyValuePairs(server.headers),
      editServerId: server.id,
    });
  };

  // Handle save config dialog
  const handleSaveConfigDialog = () => {
    if (!configDialog.serverName) return;

    const newServers = [...servers];
    const headersObj = keyValuePairsToObject(configDialog.headers);
    const hasHeaders = Object.keys(headersObj).length > 0;

    const isUrlType = configDialog.transportType !== 'stdio';

    if (configDialog.mode === 'edit' && configDialog.editServerId) {
      const index = newServers.findIndex(
        (s) => s.id === configDialog.editServerId
      );
      if (index >= 0) {
        newServers[index] = {
          ...newServers[index],
          name: configDialog.serverName,
          type: configDialog.transportType,
          command:
            configDialog.transportType === 'stdio'
              ? configDialog.command
              : undefined,
          args:
            configDialog.transportType === 'stdio'
              ? configDialog.args
              : undefined,
          url: isUrlType ? configDialog.url : undefined,
          headers: isUrlType && hasHeaders ? headersObj : undefined,
        };
      }
    } else {
      const fullId = `workany-${configDialog.serverName}`;
      if (
        newServers.some(
          (s) => s.id === fullId || s.name === configDialog.serverName
        )
      ) {
        console.error('[MCP] Server name already exists');
        return;
      }

      newServers.push({
        id: fullId,
        name: configDialog.serverName,
        type: configDialog.transportType,
        enabled: true,
        command:
          configDialog.transportType === 'stdio'
            ? configDialog.command
            : undefined,
        args:
          configDialog.transportType === 'stdio'
            ? configDialog.args
            : undefined,
        url: isUrlType ? configDialog.url : undefined,
        headers: isUrlType && hasHeaders ? headersObj : undefined,
        autoExecute: true,
        source: 'workany',
      });
    }

    setServers(newServers);
    saveMCPConfig(newServers);
    setConfigDialog(initialConfigDialog);
  };

  // Handle delete server
  const handleDeleteServer = (serverId: string) => {
    const server = servers.find((s) => s.id === serverId);
    if (!server || server.source === 'claude') return;

    const newServers = servers.filter((s) => s.id !== serverId);
    setServers(newServers);
    saveMCPConfig(newServers);
  };

  // Argument handlers
  const handleAddArg = () => {
    setConfigDialog({
      ...configDialog,
      args: [...configDialog.args, ''],
    });
  };

  const handleUpdateArg = (index: number, value: string) => {
    const newArgs = [...configDialog.args];
    newArgs[index] = value;
    setConfigDialog({ ...configDialog, args: newArgs });
  };

  const handleRemoveArg = (index: number) => {
    const newArgs = configDialog.args.filter((_, i) => i !== index);
    setConfigDialog({ ...configDialog, args: newArgs });
  };

  // Env handlers
  const handleAddEnv = () => {
    setConfigDialog({
      ...configDialog,
      env: [
        ...configDialog.env,
        { id: `env-${Date.now()}`, key: '', value: '' },
      ],
    });
  };

  const handleUpdateEnv = (id: string, key: string, value: string) => {
    setConfigDialog({
      ...configDialog,
      env: configDialog.env.map((item) =>
        item.id === id ? { ...item, key, value } : item
      ),
    });
  };

  const handleRemoveEnv = (id: string) => {
    setConfigDialog({
      ...configDialog,
      env: configDialog.env.filter((item) => item.id !== id),
    });
  };

  // Header handlers
  const handleAddHeader = () => {
    setConfigDialog({
      ...configDialog,
      headers: [
        ...configDialog.headers,
        { id: `header-${Date.now()}`, key: '', value: '' },
      ],
    });
  };

  const handleUpdateHeader = (id: string, key: string, value: string) => {
    setConfigDialog({
      ...configDialog,
      headers: configDialog.headers.map((item) =>
        item.id === id ? { ...item, key, value } : item
      ),
    });
  };

  const handleRemoveHeader = (id: string) => {
    setConfigDialog({
      ...configDialog,
      headers: configDialog.headers.filter((item) => item.id !== id),
    });
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
    <>
      <div className="-m-6 flex h-[calc(100%+48px)] flex-col">
        {/* Tab Bar */}
        <div className="border-border shrink-0 border-b px-6">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setMainTab('installed')}
              className={cn(
                'relative py-4 text-sm font-medium transition-colors',
                mainTab === 'installed'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t.settings.skillsInstalled}
              {mainTab === 'installed' && (
                <span className="bg-foreground absolute bottom-0 left-0 h-0.5 w-full" />
              )}
            </button>
            <button
              onClick={() => setMainTab('settings')}
              className={cn(
                'relative py-4 text-sm font-medium transition-colors',
                mainTab === 'settings'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t.settings.title}
              {mainTab === 'settings' && (
                <span className="bg-foreground absolute bottom-0 left-0 h-0.5 w-full" />
              )}
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {mainTab === 'installed' ? (
            <div className="flex h-full flex-col">
              {/* Filter Bar */}
              <div className="bg-background sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 px-6 pt-6 pb-4">
                <div className="flex items-center gap-3">
                  {/* Search Input */}
                  <div className="relative">
                    <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t.settings.mcpSearch}
                      className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-9 w-64 rounded-lg border py-2 pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Add Button with Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowAddMenu(!showAddMenu)}
                    className="bg-foreground text-background hover:bg-foreground/90 flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors"
                  >
                    <Plus className="size-4" />
                    {t.settings.add}
                    <ChevronDown className="size-4" />
                  </button>
                  {showAddMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowAddMenu(false)}
                      />
                      <div className="border-border bg-popover absolute top-full right-0 z-20 mt-1 min-w-[180px] rounded-xl border py-1 shadow-lg">
                        <button
                          onClick={() => {
                            setShowImportDialog(true);
                            setShowAddMenu(false);
                          }}
                          className="hover:bg-accent flex w-full items-center gap-3 px-3 py-2 text-left transition-colors"
                        >
                          <FileJson className="text-muted-foreground size-4 shrink-0" />
                          <span className="text-foreground text-sm">
                            {t.settings.mcpImportByJson}
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            setConfigDialog({
                              ...initialConfigDialog,
                              open: true,
                            });
                            setShowAddMenu(false);
                          }}
                          className="hover:bg-accent flex w-full items-center gap-3 px-3 py-2 text-left transition-colors"
                        >
                          <Settings2 className="text-muted-foreground size-4 shrink-0" />
                          <span className="text-foreground text-sm">
                            {t.settings.mcpDirectConfig}
                          </span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* MCP Grid */}
              <div className="min-h-0 flex-1 overflow-y-auto p-6">
                {error ? (
                  <div className="flex h-32 items-center justify-center text-sm text-red-500">
                    {error}
                  </div>
                ) : filteredServers.length === 0 ? (
                  <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
                    {searchQuery
                      ? t.settings.mcpNoResults
                      : t.settings.mcpNoServers}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {filteredServers.map((server) => (
                      <MCPCard
                        key={server.id}
                        server={server}
                        onConfigure={() => handleConfigureServer(server)}
                        onDelete={() => handleDeleteServer(server.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Settings Tab Content */
            <div className="space-y-4 p-6">
              {/* Global Enable Switch */}
              <div className="border-border bg-background rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-foreground text-sm font-medium">
                      {t.settings.mcpEnabled}
                    </h3>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {t.settings.mcpEnabledDescription}
                    </p>
                  </div>
                  <Switch
                    checked={settings.mcpEnabled !== false}
                    onChange={(checked) =>
                      onSettingsChange({ ...settings, mcpEnabled: checked })
                    }
                  />
                </div>
              </div>

              {/* MCP Config File */}
              <div
                className={cn(
                  'border-border bg-background rounded-xl border p-4 transition-opacity',
                  settings.mcpEnabled === false && 'opacity-50'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-foreground text-sm font-medium">
                      {t.settings.mcpConfigPath}
                    </h3>
                    <code className="bg-muted text-muted-foreground mt-2 block truncate rounded px-2 py-1 text-xs">
                      {mcpDirs.app || '~/.workany/mcp.json'}
                    </code>
                  </div>
                  <div className="ml-4 flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => openFolderInSystem(mcpDirs.app)}
                      className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-2 transition-colors"
                    >
                      <FileJson className="size-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Import Dialog - Using Radix Dialog */}
      <DialogPrimitive.Root
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/60" />
          <DialogPrimitive.Content className="bg-background border-border fixed top-1/2 left-1/2 z-[100] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-6 shadow-2xl focus:outline-none">
            <DialogPrimitive.Title className="text-foreground text-lg font-semibold">
              {t.settings.mcpImportTitle}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-muted-foreground mt-2 text-sm">
              {t.settings.mcpImportDesc}
            </DialogPrimitive.Description>

            <textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder={t.settings.mcpImportPlaceholder}
              className="border-input bg-muted text-foreground placeholder:text-muted-foreground focus:ring-ring mt-4 h-64 w-full resize-none rounded-lg border p-3 font-mono text-sm focus:ring-2 focus:outline-none"
            />

            <button
              onClick={handleImportJson}
              disabled={!importJson.trim()}
              className="bg-foreground text-background hover:bg-foreground/90 mt-4 flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t.settings.mcpImportButton}
            </button>

            <DialogPrimitive.Close className="text-muted-foreground hover:text-foreground absolute top-4 right-4 rounded-sm transition-opacity focus:outline-none">
              <X className="size-5" />
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* Config Dialog - Using Radix Dialog */}
      <DialogPrimitive.Root
        open={configDialog.open}
        onOpenChange={(open) => {
          if (!open) setConfigDialog(initialConfigDialog);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/60" />
          <DialogPrimitive.Content className="bg-background border-border fixed top-1/2 left-1/2 z-[100] flex max-h-[85vh] w-[500px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border shadow-2xl focus:outline-none">
            {/* Header */}
            <div className="border-border shrink-0 border-b px-6 py-4">
              <DialogPrimitive.Title className="text-foreground text-lg font-semibold">
                {t.settings.mcpConfigTitle}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close className="text-muted-foreground hover:text-foreground absolute top-4 right-4 rounded-sm transition-opacity focus:outline-none">
                <X className="size-5" />
              </DialogPrimitive.Close>
            </div>

            {/* Content */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-4">
                {/* Server Name */}
                <div>
                  <label className="text-foreground mb-2 block text-sm font-medium">
                    {t.settings.mcpServerName}
                  </label>
                  <input
                    type="text"
                    value={configDialog.serverName}
                    onChange={(e) =>
                      setConfigDialog({
                        ...configDialog,
                        serverName: e.target.value,
                      })
                    }
                    placeholder={t.settings.mcpServerNamePlaceholder}
                    className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>

                {/* Transport Type */}
                <div>
                  <label className="text-foreground mb-2 block text-sm font-medium">
                    {t.settings.mcpTransportType}
                  </label>
                  <select
                    value={configDialog.transportType}
                    onChange={(e) =>
                      setConfigDialog({
                        ...configDialog,
                        transportType: e.target.value as 'stdio' | 'http' | 'sse',
                      })
                    }
                    className="border-input bg-background text-foreground focus:ring-ring h-10 w-full cursor-pointer rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                  >
                    <option value="stdio">stdio</option>
                    <option value="http">http</option>
                    <option value="sse">sse</option>
                  </select>
                </div>

                {configDialog.transportType === 'stdio' ? (
                  /* Stdio config fields */
                  <>
                    {/* Command */}
                    <div>
                      <label className="text-foreground mb-2 block text-sm font-medium">
                        {t.settings.mcpCommand}
                      </label>
                      <input
                        type="text"
                        value={configDialog.command}
                        onChange={(e) =>
                          setConfigDialog({
                            ...configDialog,
                            command: e.target.value,
                          })
                        }
                        placeholder={t.settings.mcpCommandPlaceholder}
                        className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                      />
                    </div>

                    {/* Arguments */}
                    <div>
                      <label className="text-foreground mb-2 block text-sm font-medium">
                        {t.settings.mcpArguments}
                      </label>
                      <div className="space-y-2">
                        {configDialog.args.map((arg, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={arg}
                              onChange={(e) =>
                                handleUpdateArg(index, e.target.value)
                              }
                              placeholder={t.settings.mcpArgumentPlaceholder}
                              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 flex-1 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                            />
                            <button
                              onClick={() => handleRemoveArg(index)}
                              className="text-muted-foreground hover:text-destructive flex size-10 items-center justify-center rounded-lg transition-colors"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={handleAddArg}
                          className="text-primary hover:text-primary/80 flex items-center gap-1 text-sm"
                        >
                          <Plus className="size-4" />
                          {t.settings.mcpAddArgument}
                        </button>
                      </div>
                    </div>

                    {/* Environment Variables */}
                    <div>
                      <label className="text-foreground mb-2 block text-sm font-medium">
                        {t.settings.mcpEnvVariables}
                      </label>
                      <div className="space-y-2">
                        {configDialog.env.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-2"
                          >
                            <input
                              type="text"
                              value={item.key}
                              onChange={(e) =>
                                handleUpdateEnv(
                                  item.id,
                                  e.target.value,
                                  item.value
                                )
                              }
                              placeholder={t.settings.mcpEnvVariableName}
                              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-32 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                            />
                            <span className="text-muted-foreground">=</span>
                            <input
                              type="text"
                              value={item.value}
                              onChange={(e) =>
                                handleUpdateEnv(
                                  item.id,
                                  item.key,
                                  e.target.value
                                )
                              }
                              placeholder={t.settings.mcpEnvVariableValue}
                              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 flex-1 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                            />
                            <button
                              onClick={() => handleRemoveEnv(item.id)}
                              className="text-muted-foreground hover:text-destructive flex size-10 items-center justify-center rounded-lg transition-colors"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={handleAddEnv}
                          className="text-primary hover:text-primary/80 flex items-center gap-1 text-sm"
                        >
                          <Plus className="size-4" />
                          {t.settings.mcpAddEnvVariable}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* URL */}
                    <div>
                      <label className="text-foreground mb-2 block text-sm font-medium">
                        {t.settings.mcpServerUrl}
                      </label>
                      <input
                        type="text"
                        value={configDialog.url}
                        onChange={(e) =>
                          setConfigDialog({
                            ...configDialog,
                            url: e.target.value,
                          })
                        }
                        placeholder={configDialog.transportType === 'sse' ? t.settings.mcpServerUrlPlaceholderSse : t.settings.mcpServerUrlPlaceholder}
                        className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                      />
                    </div>

                    {/* Custom Headers */}
                    <div>
                      <label className="text-foreground mb-2 block text-sm font-medium">
                        {t.settings.mcpCustomHeaders}{' '}
                        <span className="text-muted-foreground font-normal">
                          {t.settings.mcpCustomHeadersOptional}
                        </span>
                      </label>
                      <div className="space-y-2">
                        {configDialog.headers.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-2"
                          >
                            <input
                              type="text"
                              value={item.key}
                              onChange={(e) =>
                                handleUpdateHeader(
                                  item.id,
                                  e.target.value,
                                  item.value
                                )
                              }
                              placeholder="Header Name"
                              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-32 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                            />
                            <span className="text-muted-foreground">=</span>
                            <input
                              type="text"
                              value={item.value}
                              onChange={(e) =>
                                handleUpdateHeader(
                                  item.id,
                                  item.key,
                                  e.target.value
                                )
                              }
                              placeholder="Value"
                              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 flex-1 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                            />
                            <button
                              onClick={() => handleRemoveHeader(item.id)}
                              className="text-muted-foreground hover:text-destructive flex size-10 items-center justify-center rounded-lg transition-colors"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={handleAddHeader}
                          className="text-primary hover:text-primary/80 flex items-center gap-1 text-sm"
                        >
                          <Plus className="size-4" />
                          {t.settings.mcpAddCustomHeader}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="border-border shrink-0 border-t px-6 py-4">
              <button
                onClick={handleSaveConfigDialog}
                disabled={!configDialog.serverName}
                className="bg-foreground text-background hover:bg-foreground/90 flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t.settings.mcpSave}
              </button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
