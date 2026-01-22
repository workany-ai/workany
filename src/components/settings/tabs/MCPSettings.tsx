import { useEffect, useState } from 'react';
import { getMcpConfigPath } from '@/shared/lib/paths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { FolderOpen, Loader2, Plus, Settings, Trash2, X } from 'lucide-react';

import { Switch } from '../components/Switch';
import { API_BASE_URL } from '../constants';
import type {
  MCPConfig,
  MCPServerStdio,
  MCPServerUI,
  MCPSubTab,
  SettingsTabProps,
} from '../types';

export function MCPSettings({ settings, onSettingsChange }: SettingsTabProps) {
  const [servers, setServers] = useState<MCPServerUI[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<MCPSubTab>('settings');
  const [showAddServer, setShowAddServer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newServer, setNewServer] = useState<MCPServerUI>({
    id: '',
    name: '',
    type: 'stdio',
    enabled: false,
    command: '',
    args: [],
    url: '',
    headers: {},
    autoExecute: true,
  });
  const { t } = useLanguage();

  const selectedServer = servers.find((s) => s.id === activeSubTab);

  // Check if server is configured
  const isServerConfigured = (server: MCPServerUI) => {
    if (server.type === 'stdio') {
      return !!server.command;
    } else {
      return !!server.url;
    }
  };

  // Sort servers
  const sortedServers = [...servers].sort((a, b) => {
    const aConfigured = isServerConfigured(a);
    const bConfigured = isServerConfigured(b);
    if (a.enabled && aConfigured && !(b.enabled && bConfigured)) return -1;
    if (b.enabled && bConfigured && !(a.enabled && aConfigured)) return 1;
    if (aConfigured && !bConfigured) return -1;
    if (bConfigured && !aConfigured) return 1;
    return 0;
  });

  // Load MCP config from API
  useEffect(() => {
    async function loadMCPConfig() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE_URL}/mcp/config`);
        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || 'Failed to load config');
        }

        const config: MCPConfig = result.data;

        const serverList: MCPServerUI[] = Object.entries(
          config.mcpServers || {}
        ).map(([id, serverConfig]) => {
          const isHttp = 'url' in serverConfig;
          return {
            id,
            name: id,
            type: isHttp ? 'http' : 'stdio',
            enabled: true,
            command: isHttp
              ? undefined
              : (serverConfig as MCPServerStdio).command,
            args: isHttp ? undefined : (serverConfig as MCPServerStdio).args,
            url: isHttp ? (serverConfig as { url: string }).url : undefined,
            headers: isHttp
              ? (serverConfig as { headers?: Record<string, string> }).headers
              : undefined,
            autoExecute: true,
          };
        });

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
        if (!server.enabled) continue;
        if (server.type === 'http') {
          mcpServers[server.id] = {
            url: server.url || '',
            headers: server.headers,
          };
        } else {
          mcpServers[server.id] = {
            command: server.command || '',
            args: server.args,
          };
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

  const handleServerUpdate = (
    serverId: string,
    updates: Partial<MCPServerUI>
  ) => {
    const newServers = servers.map((s) => {
      if (s.id !== serverId) return s;
      const updated = { ...s, ...updates };
      if (!isServerConfigured(updated) && updated.enabled) {
        updated.enabled = false;
      }
      return updated;
    });
    setServers(newServers);
    saveMCPConfig(newServers);
  };

  const handleAddServer = () => {
    if (!newServer.id) return;
    if (servers.some((s) => s.id === newServer.id)) return;

    const serverToAdd: MCPServerUI = {
      ...newServer,
      name: newServer.name || newServer.id,
      enabled: false,
    };

    const newServers = [...servers, serverToAdd];
    setServers(newServers);
    saveMCPConfig(newServers);

    setNewServer({
      id: '',
      name: '',
      type: 'stdio',
      enabled: false,
      command: '',
      args: [],
      url: '',
      headers: {},
      autoExecute: true,
    });
    setShowAddServer(false);
    setActiveSubTab(serverToAdd.id);
  };

  const handleDeleteServer = (serverId: string) => {
    const newServers = servers.filter((s) => s.id !== serverId);
    setServers(newServers);
    saveMCPConfig(newServers);
    setActiveSubTab('settings');
  };

  const handleHeaderChange = (
    serverId: string,
    key: string,
    value: string,
    oldKey?: string
  ) => {
    const server = servers.find((s) => s.id === serverId);
    if (!server) return;
    const newHeaders = { ...server.headers };
    if (oldKey && oldKey !== key) delete newHeaders[oldKey];
    if (key) newHeaders[key] = value;
    handleServerUpdate(serverId, { headers: newHeaders });
  };

  const handleRemoveHeader = (serverId: string, key: string) => {
    const server = servers.find((s) => s.id === serverId);
    if (!server) return;
    const newHeaders = { ...server.headers };
    delete newHeaders[key];
    handleServerUpdate(serverId, { headers: newHeaders });
  };

  const handleAddHeader = (serverId: string) => {
    const server = servers.find((s) => s.id === serverId);
    if (!server) return;
    const newHeaders = { ...server.headers, '': '' };
    handleServerUpdate(serverId, { headers: newHeaders });
  };

  if (loading) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin" />
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
              setShowAddServer(false);
            }}
            className={cn(
              'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-200',
              activeSubTab === 'settings' && !showAddServer
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-foreground/70 hover:bg-accent/50 hover:text-foreground'
            )}
          >
            <Settings className="size-4" />
            <span className="flex-1 text-left">{t.settings.mcpSettings}</span>
          </button>
        </div>

        <div className="border-border border-t">
          <div className="text-muted-foreground flex items-center px-4 py-2 text-xs font-medium">
            {t.settings.mcpServers}
          </div>
          <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
            {error ? (
              <div className="p-2 text-center text-xs text-red-500">
                {error}
              </div>
            ) : sortedServers.length === 0 ? (
              <div className="text-muted-foreground p-2 text-center text-xs">
                {t.settings.mcpNoServers}
              </div>
            ) : (
              sortedServers.map((server) => (
                <button
                  key={server.id}
                  onClick={() => {
                    setActiveSubTab(server.id);
                    setShowAddServer(false);
                  }}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-200',
                    activeSubTab === server.id && !showAddServer
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-foreground/70 hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  <span className="bg-muted text-muted-foreground relative flex size-6 items-center justify-center rounded text-xs font-medium">
                    {server.type === 'http' ? 'H' : 'S'}
                    {isServerConfigured(server) && (
                      <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-emerald-500" />
                    )}
                  </span>
                  <span className="flex-1 truncate text-left">{server.id}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="border-border mt-auto flex items-center gap-1 border-t p-2">
          <button
            onClick={() => setShowAddServer(true)}
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded transition-colors"
            title={t.settings.mcpAddServer}
          >
            <Plus className="size-4" />
          </button>
          {selectedServer && (
            <button
              onClick={() => handleDeleteServer(selectedServer.id)}
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-7 items-center justify-center rounded transition-colors"
              title={t.settings.mcpDeleteServer}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 overflow-y-auto">
        {showAddServer ? (
          <div className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-foreground text-base font-medium">
                {t.settings.mcpAddServer}
              </h3>
              <button
                onClick={() => setShowAddServer(false)}
                className="hover:bg-muted rounded p-1"
              >
                <X className="text-muted-foreground size-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  {t.settings.mcpType}
                </label>
                <select
                  value={newServer.type}
                  onChange={(e) =>
                    setNewServer({
                      ...newServer,
                      type: e.target.value as 'stdio' | 'http',
                    })
                  }
                  className="border-input bg-background text-foreground focus:ring-ring h-10 w-full max-w-xs cursor-pointer rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                >
                  <option value="stdio">{t.settings.mcpTypeStdio}</option>
                  <option value="http">{t.settings.mcpTypeHttp}</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  {t.settings.mcpId}
                </label>
                <p className="text-muted-foreground text-xs">
                  {t.settings.mcpIdHint}
                </p>
                <input
                  type="text"
                  value={newServer.id}
                  onChange={(e) =>
                    setNewServer({ ...newServer, id: e.target.value })
                  }
                  placeholder="my-mcp-server"
                  className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                />
              </div>

              {newServer.type === 'stdio' && (
                <>
                  <div className="flex flex-col gap-2">
                    <label className="text-foreground block text-sm font-medium">
                      {t.settings.mcpCommand}
                    </label>
                    <input
                      type="text"
                      value={newServer.command}
                      onChange={(e) =>
                        setNewServer({ ...newServer, command: e.target.value })
                      }
                      placeholder="npx"
                      className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-foreground block text-sm font-medium">
                      {t.settings.mcpArgs}
                    </label>
                    <input
                      type="text"
                      value={(newServer.args || []).join(' ')}
                      onChange={(e) =>
                        setNewServer({
                          ...newServer,
                          args: e.target.value.split(' ').filter((a) => a),
                        })
                      }
                      placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                      className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                    />
                  </div>
                </>
              )}

              {newServer.type === 'http' && (
                <div className="flex flex-col gap-2">
                  <label className="text-foreground block text-sm font-medium">
                    {t.settings.mcpUrl}
                  </label>
                  <input
                    type="text"
                    value={newServer.url}
                    onChange={(e) =>
                      setNewServer({ ...newServer, url: e.target.value })
                    }
                    placeholder="https://mcprouter.to/my-server"
                    className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>
              )}

              <button
                onClick={handleAddServer}
                disabled={!newServer.id}
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
                  {t.settings.mcpDescription}
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-foreground text-sm font-medium">
                    {t.settings.mcpEnabled}
                  </label>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t.settings.mcpEnabledDescription}
                  </p>
                </div>
                <Switch
                  checked={settings.mcpEnabled ?? true}
                  onChange={(checked) =>
                    onSettingsChange({ ...settings, mcpEnabled: checked })
                  }
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  {t.settings.mcpConfigPath}
                </label>
                <p className="text-muted-foreground text-xs">
                  {t.settings.mcpConfigPathDescription}
                </p>
                <div className="flex items-center gap-2">
                  <div className="relative max-w-md flex-1">
                    <FolderOpen className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <input
                      type="text"
                      value={settings.mcpConfigPath}
                      onChange={(e) =>
                        onSettingsChange({
                          ...settings,
                          mcpConfigPath: e.target.value,
                        })
                      }
                      placeholder="~/.workany/mcp.json"
                      className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border pr-3 pl-10 text-sm focus:border-transparent focus:ring-2 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={async () => {
                      const path = await getMcpConfigPath();
                      onSettingsChange({ ...settings, mcpConfigPath: path });
                    }}
                    className="text-muted-foreground hover:text-foreground border-border hover:bg-accent h-10 cursor-pointer rounded-lg border px-3 text-sm transition-colors"
                  >
                    {t.common.reset}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : selectedServer ? (
          <div className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-foreground text-base font-medium">
                {selectedServer.id}
              </h3>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <div
                    className={cn(
                      'size-2 rounded-full',
                      isServerConfigured(selectedServer)
                        ? 'bg-emerald-500'
                        : 'bg-gray-300'
                    )}
                  />
                  <span className="text-muted-foreground text-xs">
                    {isServerConfigured(selectedServer)
                      ? t.settings.configured
                      : t.settings.notConfigured}
                  </span>
                </div>
                <Switch
                  checked={selectedServer.enabled}
                  onChange={(checked) =>
                    handleServerUpdate(selectedServer.id, { enabled: checked })
                  }
                  disabled={!isServerConfigured(selectedServer)}
                />
              </div>
            </div>

            <div className="space-y-6">
              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  {t.settings.mcpType}
                </label>
                <select
                  value={selectedServer.type}
                  onChange={(e) =>
                    handleServerUpdate(selectedServer.id, {
                      type: e.target.value as 'stdio' | 'http',
                    })
                  }
                  className="border-input bg-background text-foreground focus:ring-ring h-10 w-full max-w-xs cursor-pointer rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                >
                  <option value="stdio">{t.settings.mcpTypeStdio}</option>
                  <option value="http">{t.settings.mcpTypeHttp}</option>
                </select>
              </div>

              {selectedServer.type === 'stdio' && (
                <>
                  <div className="flex flex-col gap-2">
                    <label className="text-foreground block text-sm font-medium">
                      {t.settings.mcpCommand}
                    </label>
                    <input
                      type="text"
                      value={selectedServer.command || ''}
                      onChange={(e) =>
                        handleServerUpdate(selectedServer.id, {
                          command: e.target.value,
                        })
                      }
                      placeholder="npx"
                      className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-foreground block text-sm font-medium">
                      {t.settings.mcpArgs}
                    </label>
                    <input
                      type="text"
                      value={(selectedServer.args || []).join(' ')}
                      onChange={(e) =>
                        handleServerUpdate(selectedServer.id, {
                          args: e.target.value.split(' ').filter((a) => a),
                        })
                      }
                      placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                      className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                    />
                  </div>
                </>
              )}

              {selectedServer.type === 'http' && (
                <>
                  <div className="flex flex-col gap-2">
                    <label className="text-foreground block text-sm font-medium">
                      {t.settings.mcpUrl}
                    </label>
                    <input
                      type="text"
                      value={selectedServer.url || ''}
                      onChange={(e) =>
                        handleServerUpdate(selectedServer.id, {
                          url: e.target.value,
                        })
                      }
                      placeholder="https://mcprouter.to/my-server"
                      className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-foreground text-sm font-medium">
                        {t.settings.mcpHeaders}
                      </label>
                      <button
                        onClick={() => handleAddHeader(selectedServer.id)}
                        className="text-primary hover:text-primary/80 flex items-center gap-1 text-xs"
                      >
                        <Plus className="size-3" />
                        {t.settings.mcpAddHeader}
                      </button>
                    </div>
                    <div className="space-y-2">
                      {Object.entries(selectedServer.headers || {}).map(
                        ([key, value], index) => (
                          <div key={index} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={key}
                              onChange={(e) =>
                                handleHeaderChange(
                                  selectedServer.id,
                                  e.target.value,
                                  value,
                                  key
                                )
                              }
                              placeholder="Header Name"
                              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-9 w-36 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                            />
                            <span className="text-muted-foreground">=</span>
                            <input
                              type="text"
                              value={value}
                              onChange={(e) =>
                                handleHeaderChange(
                                  selectedServer.id,
                                  key,
                                  e.target.value
                                )
                              }
                              placeholder="Value"
                              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-9 flex-1 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                            />
                            <button
                              onClick={() =>
                                handleRemoveHeader(selectedServer.id, key)
                              }
                              className="text-muted-foreground hover:text-destructive flex size-9 items-center justify-center rounded-lg transition-colors"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            {t.settings.mcpSelectServer}
          </div>
        )}
      </div>
    </div>
  );
}
