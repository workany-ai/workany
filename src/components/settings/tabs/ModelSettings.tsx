import { useState } from 'react';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Check, ExternalLink, Plus, Settings, Trash2, X } from 'lucide-react';

import { Switch } from '../components/Switch';
import {
  customProviderModels,
  defaultProviderIds,
  providerApiKeyUrls,
  providerDefaultModels,
  providerIcons,
} from '../constants';
import type { AIProvider, ModelSubTab, SettingsTabProps } from '../types';

// Get suggested models for a provider
function getSuggestedModels(provider: AIProvider): string[] {
  // First check by provider ID
  if (providerDefaultModels[provider.id]) {
    return providerDefaultModels[provider.id];
  }

  // Then check custom provider models by name (case-insensitive)
  const providerNameLower = provider.name.toLowerCase();
  for (const [key, models] of Object.entries(customProviderModels)) {
    if (providerNameLower.includes(key.toLowerCase())) {
      return models;
    }
  }

  // Fall back to default
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

export function ModelSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<ModelSubTab>('settings');
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvider, setNewProvider] = useState({
    name: '',
    baseUrl: '',
    apiKey: '',
    models: '',
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [newModelName, setNewModelName] = useState('');
  const [showAddModel, setShowAddModel] = useState(false);
  const { t } = useLanguage();

  // Get all available models from enabled providers
  const availableModels = settings.providers
    .filter((p) => p.enabled && p.apiKey)
    .flatMap((p) => p.models.map((m) => ({ provider: p, model: m })));

  // Sort providers: enabled first, then configured, then others
  const sortedProviders = [...settings.providers].sort((a, b) => {
    if (a.enabled && a.apiKey && !(b.enabled && b.apiKey)) return -1;
    if (b.enabled && b.apiKey && !(a.enabled && a.apiKey)) return 1;
    if (a.apiKey && !b.apiKey) return -1;
    if (b.apiKey && !a.apiKey) return 1;
    return 0;
  });

  const selectedProvider = settings.providers.find(
    (p) => p.id === activeSubTab
  );

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

    const provider: AIProvider = {
      id,
      name: newProvider.name,
      apiKey: newProvider.apiKey,
      baseUrl: newProvider.baseUrl,
      enabled: true,
      models: models.length > 0 ? models : ['default'],
    };

    onSettingsChange({
      ...settings,
      providers: [...settings.providers, provider],
    });

    setNewProvider({ name: '', baseUrl: '', apiKey: '', models: '' });
    setShowAddProvider(false);
    setActiveSubTab(id);
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
    setActiveSubTab('settings');
  };

  return (
    <div className="-m-6 flex h-[calc(100%+48px)]">
      {/* Left Panel - Sub Navigation */}
      <div className="border-border flex w-52 flex-col border-r">
        {/* Model Settings Tab */}
        <div className="space-y-0.5 p-2">
          <button
            onClick={() => {
              setActiveSubTab('settings');
              setShowAddProvider(false);
            }}
            className={cn(
              'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-200',
              activeSubTab === 'settings' && !showAddProvider
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-foreground/70 hover:bg-accent/50 hover:text-foreground'
            )}
          >
            <Settings className="size-4" />
            <span className="flex-1 text-left">{t.settings.modelSettings}</span>
          </button>
        </div>

        {/* Providers Section */}
        <div className="border-border border-t">
          <div className="text-muted-foreground flex items-center px-4 py-2 text-xs font-medium">
            {t.settings.providers}
          </div>
          <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
            {sortedProviders.map((provider) => (
              <button
                key={provider.id}
                onClick={() => {
                  setActiveSubTab(provider.id);
                  setShowAddProvider(false);
                }}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-200',
                  activeSubTab === provider.id && !showAddProvider
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-foreground/70 hover:bg-accent/50 hover:text-foreground'
                )}
              >
                <span className="bg-muted text-muted-foreground relative flex size-6 items-center justify-center rounded text-xs font-medium">
                  {providerIcons[provider.id] ||
                    provider.name.charAt(0).toUpperCase()}
                  {provider.apiKey && (
                    <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-emerald-500" />
                  )}
                </span>
                <span className="flex-1 text-left">{provider.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Add/Remove Buttons */}
        <div className="border-border mt-auto flex items-center gap-1 border-t p-2">
          <button
            onClick={() => setShowAddProvider(true)}
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded transition-colors"
            title={t.settings.addProvider}
          >
            <Plus className="size-4" />
          </button>
          {selectedProvider &&
            !defaultProviderIds.includes(selectedProvider.id) && (
              <button
                onClick={() => handleDeleteProvider(selectedProvider.id)}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-7 items-center justify-center rounded transition-colors"
                title={t.settings.deleteProvider}
              >
                <Trash2 className="size-4" />
              </button>
            )}
        </div>
      </div>

      {/* Right Panel - Content */}
      <div className="flex-1 overflow-y-auto">
        {showAddProvider ? (
          /* Add Provider Form */
          <div className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-foreground text-base font-medium">
                {t.settings.addProvider}
              </h3>
              <button
                onClick={() => setShowAddProvider(false)}
                className="hover:bg-muted rounded p-1"
              >
                <X className="text-muted-foreground size-4" />
              </button>
            </div>

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

              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  {t.settings.apiKey}
                </label>
                <input
                  type="password"
                  value={newProvider.apiKey}
                  onChange={(e) =>
                    setNewProvider({ ...newProvider, apiKey: e.target.value })
                  }
                  placeholder={t.settings.enterApiKey}
                  className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  API Base URL
                </label>
                <input
                  type="text"
                  value={newProvider.baseUrl}
                  onChange={(e) =>
                    setNewProvider({ ...newProvider, baseUrl: e.target.value })
                  }
                  placeholder="https://api.example.com/v1"
                  className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-10 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  {t.settings.models}
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

              <button
                onClick={handleAddProvider}
                disabled={!newProvider.name || !newProvider.baseUrl}
                className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4 h-10 w-full rounded-lg text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t.settings.add}
              </button>
            </div>
          </div>
        ) : activeSubTab === 'settings' ? (
          /* Model Settings Panel */
          <div className="p-6">
            <div className="space-y-6">
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
                  value={`${settings.defaultProvider}:${settings.defaultModel}`}
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
                  <option value="default:">{t.settings.defaultEnv}</option>
                  {availableModels.map(({ provider, model }) => (
                    <option
                      key={`${provider.id}:${model}`}
                      value={`${provider.id}:${model}`}
                    >
                      {provider.name} / {model}
                    </option>
                  ))}
                </select>
                {settings.defaultProvider === 'default' && (
                  <p className="text-muted-foreground text-xs">
                    {t.settings.envHint}
                  </p>
                )}
              </div>

              {/* Conversation History Settings */}
              <div className="space-y-4">
                <h4 className="text-foreground text-sm font-medium">
                  Conversation History Limits
                </h4>

                {/* Max Conversation Turns */}
                <div className="flex flex-col gap-2">
                  <label className="text-foreground block text-sm font-medium">
                    Maximum Conversation Turns
                  </label>
                  <p className="text-muted-foreground text-xs">
                    Number of conversation turns to keep in history (0 =
                    unlimited)
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
                    Maximum History Tokens
                  </label>
                  <p className="text-muted-foreground text-xs">
                    Maximum tokens for conversation history (0 = unlimited)
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

              {/* Add Custom Model Button */}
              <button
                onClick={() => setShowAddProvider(true)}
                className="text-primary hover:text-primary/80 inline-flex items-center gap-1.5 text-sm"
              >
                <Plus className="size-4" />
                {t.settings.addCustomModel}
              </button>
            </div>
          </div>
        ) : selectedProvider ? (
          /* Provider Details Panel */
          <div className="p-6">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={selectedProvider.name}
                  onChange={(e) =>
                    handleProviderUpdate(selectedProvider.id, {
                      name: e.target.value,
                    })
                  }
                  className="text-foreground hover:border-input focus:border-primary w-40 border-b border-transparent bg-transparent text-base font-medium transition-colors outline-none"
                />
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <div
                    className={cn(
                      'size-2 rounded-full',
                      selectedProvider.apiKey ? 'bg-emerald-500' : 'bg-gray-300'
                    )}
                  />
                  <span className="text-muted-foreground text-xs">
                    {selectedProvider.apiKey
                      ? t.settings.configured
                      : t.settings.notConfigured}
                  </span>
                </div>
                <Switch
                  checked={selectedProvider.enabled}
                  onChange={(checked) =>
                    handleProviderUpdate(selectedProvider.id, {
                      enabled: checked,
                    })
                  }
                  disabled={!selectedProvider.apiKey}
                />
              </div>
            </div>

            <div className="space-y-6">
              {/* API Key */}
              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  {t.settings.apiKey}
                </label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={selectedProvider.apiKey}
                    onChange={(e) =>
                      handleProviderUpdate(selectedProvider.id, {
                        apiKey: e.target.value,
                      })
                    }
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
                      openExternalUrl(providerApiKeyUrls[selectedProvider.id])
                    }
                    className="text-primary hover:text-primary/80 inline-flex cursor-pointer items-center gap-1 text-xs"
                  >
                    {t.settings.getApiKey}
                    <ExternalLink className="size-3" />
                  </button>
                )}
              </div>

              {/* API Base URL */}
              <div className="flex flex-col gap-2">
                <label className="text-foreground block text-sm font-medium">
                  API Base URL
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

              {/* Models */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label className="text-foreground block text-sm font-medium">
                    {t.settings.models || '模型'}
                  </label>
                  <button
                    onClick={() => setShowAddModel(true)}
                    className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-xs"
                  >
                    <Plus className="size-3" />
                    {t.settings.addModel || '添加模型'}
                  </button>
                </div>

                {/* Model List */}
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
                          const newModels = selectedProvider.models.filter(
                            (_, i) => i !== index
                          );
                          handleProviderUpdate(selectedProvider.id, {
                            models:
                              newModels.length > 0 ? newModels : ['default'],
                          });
                        }}
                        className="text-muted-foreground hover:text-destructive flex-shrink-0 p-1"
                        title={t.settings.deleteModel || '删除模型'}
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
                            const currentModels = selectedProvider.models || [];
                            if (!currentModels.includes(newModelName.trim())) {
                              handleProviderUpdate(selectedProvider.id, {
                                models: [...currentModels, newModelName.trim()],
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
                          t.settings.enterModelName || '输入模型名称'
                        }
                        className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-9 flex-1 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          if (newModelName.trim()) {
                            const currentModels = selectedProvider.models || [];
                            if (!currentModels.includes(newModelName.trim())) {
                              handleProviderUpdate(selectedProvider.id, {
                                models: [...currentModels, newModelName.trim()],
                              });
                            }
                            setNewModelName('');
                            setShowAddModel(false);
                          }
                        }}
                        disabled={!newModelName.trim()}
                        className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-lg px-3 text-sm disabled:opacity-50"
                      >
                        {t.settings.add || '添加'}
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

                  {/* Suggested Models */}
                  {!showAddModel &&
                    getSuggestedModels(selectedProvider).filter(
                      (model) =>
                        !(selectedProvider.models || []).includes(model)
                    ).length > 0 && (
                      <div className="space-y-2">
                        <p className="text-muted-foreground text-xs">
                          {t.settings.suggestedModels || '推荐模型'}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {getSuggestedModels(selectedProvider)
                            .filter(
                              (model) =>
                                !(selectedProvider.models || []).includes(model)
                            )
                            .slice(0, 4)
                            .map((model) => (
                              <button
                                key={model}
                                onClick={() => {
                                  const currentModels =
                                    selectedProvider.models || [];
                                  if (!currentModels.includes(model)) {
                                    handleProviderUpdate(selectedProvider.id, {
                                      models: [...currentModels, model],
                                    });
                                  }
                                }}
                                className="bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-full px-3 py-1 text-xs transition-colors"
                              >
                                + {model}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            {t.settings.selectProvider}
          </div>
        )}
      </div>
    </div>
  );
}
