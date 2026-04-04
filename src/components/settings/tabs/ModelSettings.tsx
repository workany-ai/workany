import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  Check,
  ExternalLink,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';

import { Switch } from '../components/Switch';
import {
  customProviderModels,
  defaultProviderIds,
  providerApiKeyUrls,
  providerDefaultModels,
  providerIcons,
} from '../constants';
import type { AIProvider, SettingsTabProps } from '../types';

// Get suggested models for a provider
function getSuggestedModels(provider: AIProvider): string[] {
  if (providerDefaultModels[provider.id]) {
    return providerDefaultModels[provider.id];
  }
  const providerNameLower = provider.name.toLowerCase();
  for (const [key, models] of Object.entries(customProviderModels)) {
    if (providerNameLower.includes(key.toLowerCase())) {
      return models;
    }
  }
  return providerDefaultModels.default || [];
}

// Helper function to open external URLs
const openExternalUrl = async (url: string) => {
  try {
    await openUrl(url);
  } catch {
    window.open(url, '_blank');
  }
};

type MainTab = 'providers' | 'settings';

// Provider Card component
function ProviderCard({
  provider,
  onConfigure,
  onDelete,
  onToggle,
  isBuiltIn,
}: {
  provider: AIProvider;
  onConfigure: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  isBuiltIn: boolean;
}) {
  const { t } = useLanguage();
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="border-border bg-background hover:border-foreground/20 relative flex flex-col rounded-xl border p-4 transition-colors">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="bg-muted text-muted-foreground relative flex size-7 items-center justify-center rounded text-xs font-medium">
            {providerIcons[provider.id] ||
              provider.name.charAt(0).toUpperCase()}
            {provider.apiKey && (
              <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-emerald-500" />
            )}
          </span>
          <span className="text-foreground text-sm font-medium">
            {provider.name}
          </span>
        </div>
        <Switch
          checked={provider.enabled}
          onChange={onToggle}
          disabled={!provider.apiKey}
        />
      </div>

      <p className="text-muted-foreground mb-4 flex-1 text-xs">
        {provider.apiKey
          ? `${provider.models?.length || 0} ${t.settings.models?.toLowerCase() || 'models'}`
          : t.settings.notConfigured}
      </p>

      <div className="border-border flex items-center justify-end border-t pt-3">
        <div className="flex items-center gap-1">
          <button
            onClick={onConfigure}
            className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1.5 transition-colors"
            title={t.settings.modelSettings}
          >
            <Settings2 className="size-4" />
          </button>
          {!isBuiltIn && (
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
                      {t.settings.deleteProvider}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ModelSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const [mainTab, setMainTab] = useState<MainTab>('providers');
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvider, setNewProvider] = useState({
    name: '',
    baseUrl: '',
    apiKey: '',
    models: '',
    apiType: 'openai-completions' as 'anthropic-messages' | 'openai-completions',
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [newModelName, setNewModelName] = useState('');
  const [showAddModel, setShowAddModel] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { t, tt } = useLanguage();

  // Detect connection states for "Add Provider" form
  const [detectStatus, setDetectStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [detectMessage, setDetectMessage] = useState('');

  // Detect connection states for "Edit Provider" panel
  const [editDetectStatus, setEditDetectStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [editDetectMessage, setEditDetectMessage] = useState('');

  const selectedProvider = settings.providers.find(
    (p) => p.id === editingProvider
  );

  // Reset edit detect status when switching providers
  useEffect(() => {
    setEditDetectStatus('idle');
    setEditDetectMessage('');
    setShowApiKey(false);
    setShowAddModel(false);
    setNewModelName('');
  }, [editingProvider]);

  // Function to detect if API configuration is valid (for Add Provider form)
  const handleDetectConnection = async () => {
    if (!newProvider.baseUrl || !newProvider.apiKey) {
      setDetectStatus('error');
      setDetectMessage(t.settings.fillBaseUrlAndApiKey);
      setTimeout(() => setDetectStatus('idle'), 3000);
      return;
    }

    setDetectStatus('loading');
    setDetectMessage('');

    try {
      const testModel =
        newProvider.models
          .split(',')
          .map((m) => m.trim())
          .filter((m) => m)[0] || 'gpt-3.5-turbo';

      const response = await fetch(`${API_BASE_URL}/providers/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: newProvider.baseUrl,
          apiKey: newProvider.apiKey,
          model: testModel,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        message?: string;
        error?: string;
      };

      if (data.success) {
        setDetectStatus('success');
        setDetectMessage('');
        setTimeout(() => setDetectStatus('idle'), 3000);
      } else {
        setDetectStatus('error');
        setDetectMessage(data.error || t.settings.connectionFailed);
        setTimeout(() => setDetectStatus('idle'), 5000);
      }
    } catch (error) {
      setDetectStatus('error');
      setDetectMessage(
        tt('settings.connectionError', {
          error:
            error instanceof Error ? error.message : t.settings.networkError,
        })
      );
      setTimeout(() => setDetectStatus('idle'), 5000);
    }
  };

  // Function to detect connection (for Edit Provider dialog)
  const handleEditDetectConnection = async () => {
    if (!selectedProvider?.baseUrl || !selectedProvider?.apiKey) {
      setEditDetectStatus('error');
      setEditDetectMessage(t.settings.fillBaseUrlAndApiKey);
      setTimeout(() => setEditDetectStatus('idle'), 3000);
      return;
    }

    if (!selectedProvider?.defaultModel) {
      setEditDetectStatus('error');
      setEditDetectMessage(t.settings.selectDefaultModel);
      setTimeout(() => setEditDetectStatus('idle'), 3000);
      return;
    }

    setEditDetectStatus('loading');
    setEditDetectMessage('');

    try {
      const testModel =
        selectedProvider.defaultModel ||
        selectedProvider.models?.[0] ||
        'gpt-3.5-turbo';

      const response = await fetch(`${API_BASE_URL}/providers/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: selectedProvider.baseUrl,
          apiKey: selectedProvider.apiKey,
          model: testModel,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        message?: string;
        error?: string;
      };

      if (data.success) {
        setEditDetectStatus('success');
        setEditDetectMessage('');
        setTimeout(() => setEditDetectStatus('idle'), 3000);
      } else {
        setEditDetectStatus('error');
        setEditDetectMessage(data.error || t.settings.connectionFailed);
        setTimeout(() => setEditDetectStatus('idle'), 5000);
      }
    } catch (error) {
      setEditDetectStatus('error');
      setEditDetectMessage(
        tt('settings.connectionError', {
          error:
            error instanceof Error ? error.message : t.settings.networkError,
        })
      );
      setTimeout(() => setEditDetectStatus('idle'), 5000);
    }
  };

  // Get all available models from enabled providers
  const availableModels = settings.providers
    .filter((p) => p.enabled && p.apiKey)
    .flatMap((p) => p.models.map((m) => ({ provider: p, model: m })));

  // Sort providers: enabled first, then configured, then others
  const sortedProviders = [...settings.providers]
    .filter(
      (p) =>
        !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      if (a.enabled && a.apiKey && !(b.enabled && b.apiKey)) return -1;
      if (b.enabled && b.apiKey && !(a.enabled && a.apiKey)) return 1;
      if (a.apiKey && !b.apiKey) return -1;
      if (b.apiKey && !a.apiKey) return 1;
      return 0;
    });

  const handleProviderUpdate = (
    providerId: string,
    updates: Partial<AIProvider>
  ) => {
    const newProviders = settings.providers.map((p) => {
      if (p.id !== providerId) return p;
      const updated = { ...p, ...updates };
      if ('apiKey' in updates && !updates.apiKey && updated.enabled) {
        updated.enabled = false;
      }
      return updated;
    });
    onSettingsChange({ ...settings, providers: newProviders });
  };

  const handleAddProvider = () => {
    if (!newProvider.name || !newProvider.baseUrl) return;

    const id = `custom-${Date.now()}`;
    const models = newProvider.models
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m);

    const defaultModel = models[0] || '';
    const provider: AIProvider = {
      id,
      name: newProvider.name,
      apiKey: newProvider.apiKey,
      baseUrl: newProvider.baseUrl,
      enabled: true,
      models: models.length > 0 ? models : ['default'],
      defaultModel,
      apiType: newProvider.apiType,
    };

    onSettingsChange({
      ...settings,
      providers: [...settings.providers, provider],
    });

    setNewProvider({ name: '', baseUrl: '', apiKey: '', models: '', apiType: 'openai-completions' });
    setShowAddProvider(false);
    setEditingProvider(id);
  };

  const handleDeleteProvider = (providerId: string) => {
    const newProviders = settings.providers.filter((p) => p.id !== providerId);

    let newSettings = { ...settings, providers: newProviders };
    if (settings.defaultProvider === providerId) {
      const enabledProvider = newProviders.find((p) => p.enabled);
      if (enabledProvider) {
        newSettings.defaultProvider = enabledProvider.id;
        newSettings.defaultModel = enabledProvider.models[0] || '';
      }
    }

    onSettingsChange(newSettings);
    if (editingProvider === providerId) {
      setEditingProvider(null);
    }
  };

  return (
    <>
      <div className="-m-6 flex h-[calc(100%+48px)] flex-col">
        {/* Tab Bar */}
        <div className="border-border shrink-0 border-b px-6">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setMainTab('providers')}
              className={cn(
                'relative py-4 text-sm font-medium transition-colors',
                mainTab === 'providers'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t.settings.providers}
              {mainTab === 'providers' && (
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
          {mainTab === 'providers' ? (
            <div className="flex h-full flex-col">
              {/* Top bar with Search and Add button */}
              <div className="bg-background sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 px-6 pt-6 pb-4">
                <div className="relative">
                  <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={
                      t.settings.searchProviders || 'Search providers'
                    }
                    className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-9 w-64 rounded-lg border py-2 pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>
                <button
                  onClick={() => setShowAddProvider(true)}
                  className="bg-foreground text-background hover:bg-foreground/90 flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors"
                >
                  <Plus className="size-4" />
                  {t.settings.addProvider}
                </button>
              </div>

              {/* Provider Grid */}
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                <div className="grid grid-cols-2 gap-4">
                  {sortedProviders.map((provider) => (
                    <ProviderCard
                      key={provider.id}
                      provider={provider}
                      onConfigure={() => setEditingProvider(provider.id)}
                      onDelete={() => handleDeleteProvider(provider.id)}
                      onToggle={(enabled) =>
                        handleProviderUpdate(provider.id, { enabled })
                      }
                      isBuiltIn={defaultProviderIds.includes(provider.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Settings Tab Content */
            <div className="space-y-6 p-6">
              <div>
                <p className="text-muted-foreground text-sm">
                  {t.settings.modelDescription}
                </p>
              </div>

              {/* Default Model Selection */}
              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  {t.settings.defaultModel}
                </label>
                <p className="text-muted-foreground text-xs">
                  {t.settings.defaultModelDescription}
                </p>
                <select
                  value={
                    settings.defaultProvider && settings.defaultProvider !== 'default'
                      ? `${settings.defaultProvider}:${settings.defaultModel}`
                      : availableModels.length > 0
                        ? `${availableModels[0].provider.id}:${availableModels[0].model}`
                        : ''
                  }
                  onChange={(e) => {
                    const [provider, model] = e.target.value.split(':');
                    onSettingsChange({
                      ...settings,
                      defaultProvider: provider,
                      defaultModel: model,
                    });
                  }}
                  className="border-input bg-background text-foreground focus:ring-ring h-10 w-full max-w-md rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                >
                  {availableModels.length === 0 && (
                    <option value="">{t.settings.noModelsAvailable || 'No models available'}</option>
                  )}
                  {availableModels.map(({ provider, model }) => (
                    <option
                      key={`${provider.id}:${model}`}
                      value={`${provider.id}:${model}`}
                    >
                      {provider.name} / {model}
                    </option>
                  ))}
                </select>
              </div>

              {/* Conversation History Settings */}
              <div className="space-y-4">
                <h4 className="text-foreground text-sm font-medium">
                  {t.settings.conversationHistoryLimits}
                </h4>

                {/* Max Conversation Turns */}
                <div className="flex flex-col gap-2">
                  <label className="text-foreground block text-sm font-medium">
                    {t.settings.maxConversationTurns}
                  </label>
                  <p className="text-muted-foreground text-xs">
                    {t.settings.maxConversationTurnsDescription}
                  </p>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={settings.maxConversationTurns}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || 0;
                      onSettingsChange({
                        ...settings,
                        maxConversationTurns: Math.max(0, Math.min(100, value)),
                      });
                    }}
                    className="border-input bg-background text-foreground focus:ring-ring h-10 w-full max-w-md rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>

                {/* Max History Tokens */}
                <div className="flex flex-col gap-2">
                  <label className="text-foreground block text-sm font-medium">
                    {t.settings.maxHistoryTokens}
                  </label>
                  <p className="text-muted-foreground text-xs">
                    {t.settings.maxHistoryTokensDescription}
                  </p>
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    step="100"
                    value={settings.maxHistoryTokens}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || 0;
                      onSettingsChange({
                        ...settings,
                        maxHistoryTokens: Math.max(0, Math.min(10000, value)),
                      });
                    }}
                    className="border-input bg-background text-foreground focus:ring-ring h-10 w-full max-w-md rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Provider Dialog */}
      <DialogPrimitive.Root
        open={showAddProvider}
        onOpenChange={setShowAddProvider}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/60" />
          <DialogPrimitive.Content className="bg-background border-border fixed top-1/2 left-1/2 z-[100] flex max-h-[85vh] w-[500px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border shadow-2xl focus:outline-none">
            {/* Header */}
            <div className="border-border shrink-0 border-b px-6 py-4">
              <DialogPrimitive.Title className="text-foreground text-lg font-semibold">
                {t.settings.addProvider}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close className="text-muted-foreground hover:text-foreground absolute top-4 right-4 rounded-sm transition-opacity focus:outline-none">
                <X className="size-5" />
              </DialogPrimitive.Close>
            </div>

            {/* Content */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-4">
                <div className="flex flex-col gap-2">
                  <label className="text-foreground block text-sm font-medium">
                    {t.settings.providerName}
                  </label>
                  <input
                    type="text"
                    value={newProvider.name}
                    onChange={(e) =>
                      setNewProvider({ ...newProvider, name: e.target.value })
                    }
                    placeholder="Claude"
                    className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>

                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-2">
                    <label className="text-foreground block text-sm font-medium">
                      API Type
                    </label>
                    <select
                      value={newProvider.apiType}
                      onChange={(e) =>
                        setNewProvider({
                          ...newProvider,
                          apiType: e.target.value as 'anthropic-messages' | 'openai-completions',
                        })
                      }
                      className="border-input bg-background text-foreground focus:ring-ring h-10 w-full appearance-none rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                    >
                      <option value="openai-completions">OpenAI Completions</option>
                      <option value="anthropic-messages">Anthropic Messages</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-foreground block text-sm font-medium">
                    {t.settings.apiBaseUrl}
                  </label>
                  <input
                    type="text"
                    value={newProvider.baseUrl}
                    onChange={(e) =>
                      setNewProvider({
                        ...newProvider,
                        baseUrl: e.target.value,
                      })
                    }
                    placeholder="https://api.example.com/v1"
                    className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-foreground block text-sm font-medium">
                    {t.settings.apiKey}
                  </label>
                  <input
                    type="password"
                    value={newProvider.apiKey}
                    onChange={(e) => {
                      setNewProvider({
                        ...newProvider,
                        apiKey: e.target.value,
                      });
                      setDetectStatus('idle');
                      setDetectMessage('');
                    }}
                    placeholder={t.settings.enterApiKey}
                    className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-foreground block text-sm font-medium">
                    {t.settings.defaultModel}
                  </label>
                  <input
                    type="text"
                    value={newProvider.models}
                    onChange={(e) =>
                      setNewProvider({ ...newProvider, models: e.target.value })
                    }
                    placeholder={t.settings.modelsPlaceholder || 'e.g. gpt-4o'}
                    className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>

                {/* Detect Button */}
                <button
                  type="button"
                  onClick={handleDetectConnection}
                  disabled={detectStatus === 'loading'}
                  className={cn(
                    'border-border hover:bg-accent hover:text-accent-foreground text-muted-foreground flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    detectStatus === 'success' &&
                      'border-emerald-500 bg-emerald-500 text-white hover:border-emerald-600 hover:bg-emerald-600',
                    detectStatus === 'error' &&
                      'border-red-500 bg-red-500 text-white hover:border-red-600 hover:bg-red-600'
                  )}
                >
                  <RefreshCw
                    className={cn(
                      'size-4',
                      detectStatus === 'loading' && 'animate-spin'
                    )}
                  />
                  {detectStatus === 'loading'
                    ? t.settings.detecting
                    : detectStatus === 'success'
                      ? t.settings.success
                      : detectStatus === 'error'
                        ? t.settings.failed
                        : t.settings.detectConfig}
                </button>
                {detectMessage && (
                  <p
                    className={cn(
                      'text-xs font-medium',
                      detectStatus === 'success'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    )}
                  >
                    {detectMessage}
                  </p>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="border-border shrink-0 border-t px-6 py-4">
              <button
                onClick={handleAddProvider}
                disabled={!newProvider.name || !newProvider.baseUrl}
                className="bg-foreground text-background hover:bg-foreground/90 flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t.settings.add}
              </button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* Edit Provider Dialog */}
      <DialogPrimitive.Root
        open={!!editingProvider && !!selectedProvider}
        onOpenChange={(open) => {
          if (!open) setEditingProvider(null);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/60" />
          <DialogPrimitive.Content className="bg-background border-border fixed top-1/2 left-1/2 z-[100] flex max-h-[85vh] w-[500px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border shadow-2xl focus:outline-none">
            {selectedProvider && (
              <>
                {/* Header */}
                <div className="border-border shrink-0 border-b px-6 py-4">
                  <DialogPrimitive.Title className="text-foreground text-lg font-semibold">
                    {t.settings.modelSettings}
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Close className="text-muted-foreground hover:text-foreground absolute top-4 right-4 rounded-sm transition-opacity focus:outline-none">
                    <X className="size-5" />
                  </DialogPrimitive.Close>
                </div>

                {/* Content */}
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                  <div className="space-y-5">
                    {/* Provider Name */}
                    <div className="flex flex-col gap-2">
                      <label className="text-foreground block text-sm font-medium">
                        {t.settings.providerName}
                      </label>

                      <input
                        type="text"
                        value={selectedProvider.name}
                        onChange={(e) =>
                          handleProviderUpdate(selectedProvider.id, {
                            name: e.target.value,
                          })
                        }
                        placeholder={t.settings.providerName}
                        className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                      />
                    </div>

                    {/* API Type */}
                    <div className="flex flex-col gap-2">
                      <label className="text-foreground block text-sm font-medium">
                        API Type
                      </label>
                      <select
                        value={selectedProvider.apiType || 'openai-completions'}
                        onChange={(e) =>
                          handleProviderUpdate(selectedProvider.id, {
                            apiType: e.target.value as 'anthropic-messages' | 'openai-completions',
                          })
                        }
                        className="border-input bg-background text-foreground focus:ring-ring h-10 w-full appearance-none rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                      >
                        <option value="openai-completions">OpenAI Completions</option>
                        <option value="anthropic-messages">Anthropic Messages</option>
                      </select>
                    </div>

                    {/* API Base URL */}
                    <div className="flex flex-col gap-2">
                      <label className="text-foreground block text-sm font-medium">
                        {t.settings.apiBaseUrl}
                      </label>
                      <input
                        type="text"
                        value={selectedProvider.baseUrl}
                        onChange={(e) =>
                          handleProviderUpdate(selectedProvider.id, {
                            baseUrl: e.target.value,
                          })
                        }
                        placeholder={t.settings.apiBaseUrl}
                        className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                      />
                    </div>

                    {/* API Key */}
                    <div className="flex flex-col gap-2">
                      <label className="text-foreground block text-sm font-medium">
                        {t.settings.apiKey}
                      </label>
                      <div className="relative">
                        <input
                          type={showApiKey ? 'text' : 'password'}
                          value={selectedProvider.apiKey}
                          onChange={(e) => {
                            handleProviderUpdate(selectedProvider.id, {
                              apiKey: e.target.value,
                            });
                            setEditDetectStatus('idle');
                            setEditDetectMessage('');
                          }}
                          placeholder={t.settings.enterApiKey}
                          className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border pr-10 pl-3 text-sm focus:ring-2 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
                        >
                          {showApiKey ? (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                              <line x1="1" y1="1" x2="23" y2="23" />
                            </svg>
                          ) : (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                      </div>
                      {providerApiKeyUrls[selectedProvider.id] && (
                        <button
                          onClick={() =>
                            openExternalUrl(
                              providerApiKeyUrls[selectedProvider.id]
                            )
                          }
                          className="text-primary hover:text-primary/80 inline-flex cursor-pointer items-center gap-1 text-xs"
                        >
                          {t.settings.getApiKey}
                          <ExternalLink className="size-3" />
                        </button>
                      )}
                    </div>

                    {/* Default Model */}
                    <div className="flex flex-col gap-2">
                      <label className="text-foreground block text-sm font-medium">
                        {t.settings.defaultModel}
                      </label>
                      <select
                        value={selectedProvider.defaultModel || ''}
                        onChange={(e) =>
                          handleProviderUpdate(selectedProvider.id, {
                            defaultModel: e.target.value,
                          })
                        }
                        className="border-input bg-background text-foreground focus:ring-ring h-10 w-full appearance-none rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                      >
                        <option value="">--</option>
                        {(selectedProvider.models || []).map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                      <p className="text-muted-foreground text-xs">
                        {t.settings.defaultModelHint}
                      </p>
                    </div>

                    {/* Models */}
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <label className="text-foreground block text-sm font-medium">
                          {t.settings.models || 'Models'}
                        </label>
                        <button
                          onClick={() => setShowAddModel(true)}
                          className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-xs"
                        >
                          <Plus className="size-3" />
                          {t.settings.addModel || 'Add Model'}
                        </button>
                      </div>

                      <div className="space-y-2">
                        {(selectedProvider.models || []).map((model, index) => (
                          <div
                            key={index}
                            className="bg-muted/50 flex items-center gap-2 rounded-lg px-3 py-2"
                          >
                            <Check className="size-4 flex-shrink-0 text-emerald-500" />
                            <span className="text-foreground flex-1 truncate text-sm">
                              {model}
                            </span>
                            <button
                              onClick={() => {
                                const newModels =
                                  selectedProvider.models.filter(
                                    (_, i) => i !== index
                                  );
                                handleProviderUpdate(selectedProvider.id, {
                                  models: newModels,
                                });
                              }}
                              className="text-muted-foreground hover:text-destructive flex-shrink-0 p-1"
                              title={t.settings.deleteModel || 'Delete model'}
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        ))}

                        {/* Add Model Input */}
                        {showAddModel && (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={newModelName}
                              onChange={(e) => setNewModelName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newModelName.trim()) {
                                  const currentModels =
                                    selectedProvider.models || [];
                                  if (
                                    !currentModels.includes(newModelName.trim())
                                  ) {
                                    handleProviderUpdate(selectedProvider.id, {
                                      models: [
                                        ...currentModels,
                                        newModelName.trim(),
                                      ],
                                    });
                                  }
                                  setNewModelName('');
                                  setShowAddModel(false);
                                } else if (e.key === 'Escape') {
                                  setNewModelName('');
                                  setShowAddModel(false);
                                }
                              }}
                              placeholder={
                                t.settings.enterModelName || 'Model name'
                              }
                              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-9 flex-1 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                              autoFocus
                            />
                            <button
                              onClick={() => {
                                if (newModelName.trim()) {
                                  const currentModels =
                                    selectedProvider.models || [];
                                  if (
                                    !currentModels.includes(newModelName.trim())
                                  ) {
                                    handleProviderUpdate(selectedProvider.id, {
                                      models: [
                                        ...currentModels,
                                        newModelName.trim(),
                                      ],
                                    });
                                  }
                                  setNewModelName('');
                                  setShowAddModel(false);
                                }
                              }}
                              disabled={!newModelName.trim()}
                              className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-lg px-3 text-sm disabled:opacity-50"
                            >
                              {t.settings.add || 'Add'}
                            </button>
                            <button
                              onClick={() => {
                                setNewModelName('');
                                setShowAddModel(false);
                              }}
                              className="text-muted-foreground hover:text-foreground p-1"
                            >
                              <X className="size-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Detect Button */}
                    <button
                      type="button"
                      onClick={handleEditDetectConnection}
                      disabled={editDetectStatus === 'loading'}
                      className={cn(
                        'border-border hover:bg-accent hover:text-accent-foreground text-muted-foreground flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                        editDetectStatus === 'success' &&
                          'border-emerald-500 bg-emerald-500 text-white hover:border-emerald-600 hover:bg-emerald-600',
                        editDetectStatus === 'error' &&
                          'border-red-500 bg-red-500 text-white hover:border-red-600 hover:bg-red-600'
                      )}
                    >
                      <RefreshCw
                        className={cn(
                          'size-4',
                          editDetectStatus === 'loading' && 'animate-spin'
                        )}
                      />
                      {editDetectStatus === 'loading'
                        ? t.settings.detecting
                        : editDetectStatus === 'success'
                          ? t.settings.success
                          : editDetectStatus === 'error'
                            ? t.settings.failed
                            : t.settings.detectConfig}
                    </button>
                    {editDetectMessage && (
                      <p
                        className={cn(
                          'text-xs font-medium',
                          editDetectStatus === 'success'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        )}
                      >
                        {editDetectMessage}
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Footer */}
            <div className="border-border shrink-0 border-t px-6 py-4">
              <button
                onClick={() => setEditingProvider(null)}
                className="bg-foreground text-background hover:bg-foreground/90 flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium transition-colors"
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
