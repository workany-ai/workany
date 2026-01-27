// Settings types and storage for AI provider configuration

// ============================================================================
// Backend Sync
// ============================================================================

import { API_BASE_URL } from '@/config';

import { getAppDataDir, getMcpConfigPath } from '../lib/paths';

export interface AIProvider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  models: string[];
  // Extended fields for UI
  icon?: string;
  apiKeyUrl?: string;
  canDelete?: boolean;
}

export interface MCPServer {
  id: string;
  name: string;
  type: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
}

// ============================================================================
// Sandbox Provider Settings
// ============================================================================

export type SandboxProviderType =
  | 'docker'
  | 'native'
  | 'e2b'
  | 'codex'
  | 'claude'
  | 'custom';

export interface SandboxProviderSetting {
  id: string;
  type: SandboxProviderType;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export const defaultSandboxProviders: SandboxProviderSetting[] = [
  {
    id: 'codex',
    type: 'codex',
    name: 'Codex Sandbox',
    enabled: true,
    config: {
      defaultTimeout: 120000,
    },
  },
  {
    id: 'native',
    type: 'native',
    name: 'Native (No Isolation)',
    enabled: true,
    config: {
      shell: '/bin/bash',
      defaultTimeout: 120000,
    },
  },
];

// ============================================================================
// Agent Runtime Settings
// ============================================================================

export type AgentRuntimeType = 'claude' | 'codex' | 'deepagents' | 'custom';

export interface AgentRuntimeSetting {
  id: string;
  type: AgentRuntimeType;
  name: string;
  enabled: boolean;
  config: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    executablePath?: string;
    [key: string]: unknown;
  };
}

export const defaultAgentRuntimes: AgentRuntimeSetting[] = [
  {
    id: 'claude',
    type: 'claude',
    name: 'Claude Code',
    enabled: true,
    config: {
      model: 'claude-sonnet-4-20250514',
    },
  },
  {
    id: 'codex',
    type: 'codex',
    name: 'OpenAI Codex CLI',
    enabled: false,
    config: {
      model: 'codex',
    },
  },
];

export interface UserProfile {
  nickname: string;
  avatar: string; // URL or base64 data
}

// Preset accent colors
export type AccentColor =
  | 'orange'
  | 'blue'
  | 'green'
  | 'purple'
  | 'pink'
  | 'red'
  | 'sage';

export const accentColors: {
  id: AccentColor;
  name: string;
  color: string;
  darkColor: string;
}[] = [
  {
    id: 'orange',
    name: 'Orange',
    color: 'oklch(0.6716 0.1368 48.513)',
    darkColor: 'oklch(0.7214 0.1337 49.9802)',
  },
  {
    id: 'blue',
    name: 'Blue',
    color: 'oklch(0.5469 0.1914 262.881)',
    darkColor: 'oklch(0.6232 0.1914 262.881)',
  },
  {
    id: 'green',
    name: 'Green',
    color: 'oklch(0.5966 0.1397 149.214)',
    darkColor: 'oklch(0.6489 0.1397 149.214)',
  },
  {
    id: 'purple',
    name: 'Purple',
    color: 'oklch(0.5412 0.1879 293.541)',
    darkColor: 'oklch(0.6135 0.1879 293.541)',
  },
  {
    id: 'pink',
    name: 'Pink',
    color: 'oklch(0.6171 0.1762 349.761)',
    darkColor: 'oklch(0.6894 0.1762 349.761)',
  },
  {
    id: 'red',
    name: 'Red',
    color: 'oklch(0.5772 0.2077 27.325)',
    darkColor: 'oklch(0.6495 0.2077 27.325)',
  },
  {
    id: 'sage',
    name: 'Sage',
    color: 'oklch(0.4531 0.0891 152.535)', // Dark forest green
    darkColor: 'oklch(0.5654 0.1091 152.535)',
  },
];

// Background style presets
export type BackgroundStyle = 'default' | 'warm' | 'cool';

export const backgroundStyles: {
  id: BackgroundStyle;
  name: string;
  description: string;
}[] = [
  { id: 'default', name: 'Default', description: 'Clean neutral background' },
  { id: 'warm', name: 'Warm', description: 'Cozy cream and beige tones' },
  { id: 'cool', name: 'Cool', description: 'Crisp blue-gray tones' },
];

export interface Settings {
  // User profile
  profile: UserProfile;

  // AI Provider settings
  providers: AIProvider[];
  defaultProvider: string;
  defaultModel: string;

  // MCP settings - path to mcp.json config file
  mcpConfigPath: string;
  mcpEnabled: boolean; // Enable MCP mounting during agent conversations
  mcpUserDirEnabled: boolean; // Enable loading MCP servers from user directory (claude config)
  mcpAppDirEnabled: boolean; // Enable loading MCP servers from app directory (workany config)

  // Skills settings
  skillsPath: string;
  skillsEnabled: boolean; // Enable skills mounting during agent conversations
  skillsUserDirEnabled: boolean; // Enable loading skills from user directory (~/.claude/skills)
  skillsAppDirEnabled: boolean; // Enable loading skills from app directory (workspace/skills)

  // Workspace settings
  workDir: string; // Working directory for sessions and outputs

  // Sandbox settings
  sandboxEnabled: boolean; // Enable sandbox mode for script execution
  sandboxProviders: SandboxProviderSetting[]; // Available sandbox providers
  defaultSandboxProvider: string; // Default sandbox provider ID

  // Agent Runtime settings
  agentRuntimes: AgentRuntimeSetting[]; // Available agent runtimes
  defaultAgentRuntime: string; // Default agent runtime ID

  // Conversation History settings
  maxConversationTurns: number; // Maximum conversation turns to keep in history (default: 20)
  maxHistoryTokens: number; // Maximum tokens for conversation history (default: 2000)

  // General settings
  theme: 'light' | 'dark' | 'system';
  accentColor: AccentColor;
  backgroundStyle: BackgroundStyle;
  language: string;
}

// ============================================================================
// AI Provider Configuration
// ============================================================================

// Default providers with full configuration
export const defaultProviders: AIProvider[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api',
    enabled: true,
    models: ['anthropic/claude-sonnet-4.5', 'anthropic/claude-opus-4.5'],
    icon: 'O',
    apiKeyUrl: 'https://openrouter.ai/keys',
    canDelete: true,
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    apiKey: '',
    baseUrl: 'https://api.minimax.io/anthropic',
    enabled: true,
    models: ['MiniMax-M2.1'],
    icon: 'M',
    apiKeyUrl:
      'https://platform.minimax.io/subscribe/coding-plan?code=9hgHKlPO3G&source=link',
    canDelete: true,
  },
  {
    id: 'zai',
    name: 'Z.ai',
    apiKey: '',
    baseUrl: 'https://api.z.ai/api/anthropic',
    enabled: true,
    models: ['glm-4.7'],
    icon: 'Z',
    apiKeyUrl: 'https://z.ai/subscribe?ic=7YS469UOXD',
    canDelete: true,
  },
  {
    id: 'volcengine',
    name: 'Volcengine',
    apiKey: '',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    enabled: true,
    models: ['ark-code-latest'],
    icon: 'V',
    apiKeyUrl: 'https://volcengine.com/L/Sq5rSgyFu_E',
    canDelete: true,
  },
  {
    id: '302ai',
    name: '302.AI',
    apiKey: '',
    baseUrl: 'https://api.302.ai/cc',
    enabled: true,
    models: ['claude-sonnet-4-5-20250929'],
    icon: '3',
    apiKeyUrl: 'https://302.ai/?utm_source=workany_desktop',
    canDelete: true,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    apiKey: '',
    baseUrl: 'http://localhost:11434',
    enabled: true,
    models: ['glm-4.7-flash'],
    icon: 'O',
    apiKeyUrl: 'https://docs.ollama.com/integrations/claude-code',
    canDelete: true,
  },
];

// Default provider IDs that cannot be deleted (derived from defaultProviders)
export const defaultProviderIds = defaultProviders
  .filter((p) => p.canDelete === false)
  .map((p) => p.id);

// Popular models for each provider (derived from defaultProviders + extra providers)
export const providerDefaultModels: Record<string, string[]> = {
  // Auto-generate from defaultProviders
  ...Object.fromEntries(defaultProviders.map((p) => [p.id, p.models])),
  // Extra providers not in defaultProviders
  anthropic: ['claude-sonnet-4-5-20250514', 'claude-opus-4-5-20250514'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1-preview'],
  // Fallback for unknown providers
  default: [],
};

// Model suggestions for custom providers (matched by name pattern)
export const customProviderModels: Record<string, string[]> = {
  火山: [
    'doubao-1-5-pro-256k-250115',
    'doubao-1-5-lite-32k-250115',
    'deepseek-v3-250324',
  ],
  volcengine: [
    'doubao-1-5-pro-256k-250115',
    'doubao-1-5-lite-32k-250115',
    'deepseek-v3-250324',
  ],
  deepseek: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
  moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  zhipu: ['glm-4-plus', 'glm-4-flash', 'glm-4-long'],
  qwen: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
};

// Default settings
// Note: Path values are placeholders that get resolved at initialization
// to platform-specific paths (e.g., ~/Library/Application Support/workany on macOS)
export const defaultSettings: Settings = {
  profile: {
    nickname: 'Guest User',
    avatar: '',
  },
  providers: defaultProviders,
  defaultProvider: 'default', // Use environment variables by default
  defaultModel: '',
  mcpConfigPath: '', // Will be resolved to app data dir at init
  mcpEnabled: true, // Enable MCP by default
  mcpUserDirEnabled: true, // Enable user directory MCP by default
  mcpAppDirEnabled: true, // Enable app directory MCP by default
  skillsPath: '', // Will be resolved to app data dir at init
  skillsEnabled: true, // Enable skills by default
  skillsUserDirEnabled: true, // Enable user directory skills by default
  skillsAppDirEnabled: true, // Enable app directory skills by default
  workDir: '', // Will be resolved to app data dir at init
  sandboxEnabled: true,
  sandboxProviders: defaultSandboxProviders,
  defaultSandboxProvider: 'codex', // Default to Codex sandbox, fallback to native
  agentRuntimes: defaultAgentRuntimes,
  defaultAgentRuntime: 'claude', // Default to Claude Code
  maxConversationTurns: 20, // Default: 20 conversation turns
  maxHistoryTokens: 2000, // Default: 2000 tokens for history
  theme: 'system',
  accentColor: 'orange',
  backgroundStyle: 'default',
  language: '', // Empty string triggers system language detection on first run
};

const DB_NAME = 'sqlite:workany.db';

// Check if running in Tauri environment synchronously
function isTauriSync(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const hasTauriInternals = '__TAURI_INTERNALS__' in window;
  const hasTauri = '__TAURI__' in window;
  return hasTauriInternals || hasTauri;
}

// In-memory cache for settings
let settingsCache: Settings | null = null;

// Tauri database instance
let db: Awaited<
  ReturnType<typeof import('@tauri-apps/plugin-sql').default.load>
> | null = null;

// Initialize database connection (only in Tauri)
async function getDatabase() {
  if (!isTauriSync()) {
    return null;
  }

  if (!db) {
    try {
      const Database = (await import('@tauri-apps/plugin-sql')).default;
      db = await Database.load(DB_NAME);
    } catch (error) {
      console.error('[Settings] Failed to connect to SQLite:', error);
      return null;
    }
  }
  return db;
}

// Get settings from database (async version)
export async function getSettingsAsync(): Promise<Settings> {
  // Return cached settings if available
  if (settingsCache) {
    console.log('[Settings] getSettingsAsync returning cached settings:', {
      defaultProvider: settingsCache.defaultProvider,
      defaultModel: settingsCache.defaultModel,
    });
    return settingsCache;
  }

  const isTauri = isTauriSync();
  console.log('[Settings] getSettingsAsync - isTauri:', isTauri);

  const database = await getDatabase();
  console.log(
    '[Settings] getSettingsAsync - database:',
    database ? 'connected' : 'null'
  );

  if (database) {
    try {
      const result = await database.select<{ key: string; value: string }[]>(
        'SELECT key, value FROM settings'
      );

      console.log('[Settings] Database query result rows:', result.length);

      if (result.length > 0) {
        // Build settings object from key-value pairs
        const settings = { ...defaultSettings };
        for (const row of result) {
          try {
            const value = JSON.parse(row.value);
            (settings as Record<string, unknown>)[row.key] = value;
          } catch {
            // Skip invalid JSON values
          }
        }
        // Migration: Add missing default providers
        for (const defaultProvider of defaultProviders) {
          if (!settings.providers.find((p) => p.id === defaultProvider.id)) {
            settings.providers.push(defaultProvider);
          }
        }
        // Debug: Log loaded settings
        console.log('[Settings] Loaded from database:', {
          defaultProvider: settings.defaultProvider,
          defaultModel: settings.defaultModel,
          sandboxEnabled: settings.sandboxEnabled,
          sandboxProvider: settings.defaultSandboxProvider,
        });
        settingsCache = settings;
        return settings;
      } else {
        console.log(
          '[Settings] Database has no settings rows, falling back to localStorage'
        );
      }
    } catch (error) {
      console.error('[Settings] Failed to load from database:', error);
    }
  }

  // Fallback to localStorage for browser mode
  try {
    const stored = localStorage.getItem('workany_settings');
    if (stored) {
      const loadedSettings = { ...defaultSettings, ...JSON.parse(stored) };
      // Migration: Add missing default providers
      for (const defaultProvider of defaultProviders) {
        if (
          !loadedSettings.providers.find(
            (p: AIProvider) => p.id === defaultProvider.id
          )
        ) {
          loadedSettings.providers.push(defaultProvider);
        }
      }
      // Debug: Log loaded settings
      console.log('[Settings] Loaded from localStorage:', {
        defaultProvider: loadedSettings.defaultProvider,
        defaultModel: loadedSettings.defaultModel,
        sandboxEnabled: loadedSettings.sandboxEnabled,
        sandboxProvider: loadedSettings.defaultSandboxProvider,
      });
      settingsCache = loadedSettings;
      return loadedSettings;
    } else {
      console.log('[Settings] localStorage has no workany_settings');
    }
  } catch (error) {
    console.error('[Settings] Failed to load from localStorage:', error);
  }

  // WARNING: Using default settings - user custom API settings will NOT be applied
  console.warn(
    '[Settings] Using defaultSettings - no saved settings found in database or localStorage.',
    'User custom API settings will NOT be applied!'
  );
  settingsCache = defaultSettings;
  return defaultSettings;
}

// Get settings synchronously (returns cached or default)
export function getSettings(): Settings {
  if (settingsCache) {
    return settingsCache;
  }

  // Try localStorage first for immediate sync access
  try {
    const stored = localStorage.getItem('workany_settings');
    if (stored) {
      const loadedSettings = { ...defaultSettings, ...JSON.parse(stored) };
      // Migration: Add missing default providers
      for (const defaultProvider of defaultProviders) {
        if (
          !loadedSettings.providers.find(
            (p: AIProvider) => p.id === defaultProvider.id
          )
        ) {
          loadedSettings.providers.push(defaultProvider);
        }
      }
      settingsCache = loadedSettings;
      console.log('[Settings] getSettings loaded from localStorage:', {
        defaultProvider: loadedSettings.defaultProvider,
        defaultModel: loadedSettings.defaultModel,
        providersCount: loadedSettings.providers.length,
      });
      return loadedSettings;
    }
  } catch (error) {
    console.error('[Settings] Failed to load from localStorage:', error);
  }

  // WARNING: Returning default settings - user configuration may not be loaded
  console.warn(
    '[Settings] getSettings returning defaultSettings - settingsCache is null and localStorage has no data.',
    'User custom API settings will NOT be applied. This may happen if:',
    '1. App just started and initializeSettings() has not completed yet',
    '2. Database/localStorage failed to load settings',
    '3. User has never saved settings'
  );
  return defaultSettings;
}

// Save settings to database (async version)
export async function saveSettingsAsync(settings: Settings): Promise<void> {
  settingsCache = settings;

  const database = await getDatabase();

  if (database) {
    try {
      // Save each setting key individually using REPLACE
      const keys = Object.keys(settings) as (keyof Settings)[];
      for (const key of keys) {
        const value = JSON.stringify(settings[key]);
        await database.execute(
          `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ($1, $2, datetime('now'))`,
          [key, value]
        );
      }
    } catch (error) {
      console.error('[Settings] Failed to save to database:', error);
    }
  }

  // Also save to localStorage as fallback
  try {
    localStorage.setItem('workany_settings', JSON.stringify(settings));
  } catch (error) {
    console.error('[Settings] Failed to save to localStorage:', error);
  }
}

// Sync version that triggers async save
export function saveSettings(settings: Settings): void {
  settingsCache = settings;

  console.log('[Settings] saveSettings called:', {
    defaultProvider: settings.defaultProvider,
    defaultModel: settings.defaultModel,
    providersCount: settings.providers.length,
  });

  // Save to localStorage immediately for sync access
  try {
    localStorage.setItem('workany_settings', JSON.stringify(settings));
    console.log('[Settings] Saved to localStorage successfully');
  } catch (error) {
    console.error('[Settings] Failed to save to localStorage:', error);
  }

  // Also save to database asynchronously
  saveSettingsAsync(settings)
    .then(() => {
      console.log('[Settings] Saved to database successfully');
    })
    .catch((error) => {
      console.error('[Settings] Failed to save settings async:', error);
    });
}

// Initialize settings - call this on app startup
export async function initializeSettings(): Promise<Settings> {
  // Resolve platform-specific paths
  const [appDataDir, mcpConfigPath] = await Promise.all([
    getAppDataDir(),
    getMcpConfigPath(),
  ]);

  const settings = await getSettingsAsync();

  // If paths are empty (first run or migration), set them to platform defaults
  if (!settings.workDir) {
    settings.workDir = appDataDir;
  }
  if (!settings.mcpConfigPath) {
    settings.mcpConfigPath = mcpConfigPath;
  }
  // Default skillsPath to workDir/skills (not system default)
  if (!settings.skillsPath) {
    settings.skillsPath = `${settings.workDir}/skills`;
  }

  // Migration: If a sandbox provider is selected but sandboxEnabled is not true, enable it
  // This fixes a bug where selecting a sandbox provider didn't enable sandbox mode
  if (settings.defaultSandboxProvider && settings.sandboxEnabled !== true) {
    console.log(
      '[Settings] Migration: Enabling sandbox because provider is selected:',
      settings.defaultSandboxProvider
    );
    settings.sandboxEnabled = true;
  }

  settingsCache = settings;

  // Save if paths were updated
  if (
    settings.workDir === appDataDir ||
    settings.mcpConfigPath === mcpConfigPath ||
    settings.skillsPath === `${settings.workDir}/skills`
  ) {
    await saveSettingsAsync(settings);
  }

  return settings;
}

// Update a single AI provider
export function updateProvider(
  providerId: string,
  updates: Partial<AIProvider>
): Settings {
  const settings = getSettings();
  const providerIndex = settings.providers.findIndex(
    (p) => p.id === providerId
  );
  if (providerIndex !== -1) {
    settings.providers[providerIndex] = {
      ...settings.providers[providerIndex],
      ...updates,
    };
    saveSettings(settings);
  }
  return settings;
}

// ============================================================================
// Sandbox Provider Management
// ============================================================================

// Update a sandbox provider
export function updateSandboxProvider(
  providerId: string,
  updates: Partial<SandboxProviderSetting>
): Settings {
  const settings = getSettings();
  const providerIndex = settings.sandboxProviders.findIndex(
    (p) => p.id === providerId
  );
  if (providerIndex !== -1) {
    settings.sandboxProviders[providerIndex] = {
      ...settings.sandboxProviders[providerIndex],
      ...updates,
    };
    saveSettings(settings);
  }
  return settings;
}

// Set default sandbox provider
export function setDefaultSandboxProvider(providerId: string): Settings {
  const settings = getSettings();
  settings.defaultSandboxProvider = providerId;
  saveSettings(settings);
  return settings;
}

// Get the current default sandbox provider
export function getDefaultSandboxProvider():
  | SandboxProviderSetting
  | undefined {
  const settings = getSettings();
  return settings.sandboxProviders.find(
    (p) => p.id === settings.defaultSandboxProvider
  );
}

// ============================================================================
// Agent Runtime Management
// ============================================================================

// Update an agent runtime
export function updateAgentRuntime(
  runtimeId: string,
  updates: Partial<AgentRuntimeSetting>
): Settings {
  const settings = getSettings();
  const runtimeIndex = settings.agentRuntimes.findIndex(
    (r) => r.id === runtimeId
  );
  if (runtimeIndex !== -1) {
    settings.agentRuntimes[runtimeIndex] = {
      ...settings.agentRuntimes[runtimeIndex],
      ...updates,
    };
    saveSettings(settings);
  }
  return settings;
}

// Set default agent runtime
export function setDefaultAgentRuntime(runtimeId: string): Settings {
  const settings = getSettings();
  settings.defaultAgentRuntime = runtimeId;
  saveSettings(settings);
  return settings;
}

// Get the current default agent runtime
export function getDefaultAgentRuntime(): AgentRuntimeSetting | undefined {
  const settings = getSettings();
  return settings.agentRuntimes.find(
    (r) => r.id === settings.defaultAgentRuntime
  );
}

/**
 * Get the current default AI provider (for model configuration)
 */
export function getDefaultAIProvider(): AIProvider | undefined {
  const settings = getSettings();
  return settings.providers.find((p) => p.id === settings.defaultProvider);
}

/**
 * Sync settings with the backend API
 * This ensures the backend uses the same provider configuration as the frontend
 */
export async function syncSettingsWithBackend(): Promise<void> {
  const settings = getSettings();

  // Get the selected AI provider's configuration
  const aiProvider = getDefaultAIProvider();

  // Build agent config with model information
  const agentConfig: Record<string, unknown> = {
    ...getDefaultAgentRuntime()?.config,
  };

  // If a custom AI provider is selected (not 'default'), use its configuration
  if (settings.defaultProvider !== 'default' && aiProvider) {
    if (aiProvider.apiKey) {
      agentConfig.apiKey = aiProvider.apiKey;
    }
    if (aiProvider.baseUrl) {
      agentConfig.baseUrl = aiProvider.baseUrl;
    }
    if (settings.defaultModel) {
      agentConfig.model = settings.defaultModel;
    }
  }

  try {
    const response = await fetch(`${API_BASE_URL}/providers/settings/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sandboxProvider: settings.defaultSandboxProvider,
        sandboxConfig: getDefaultSandboxProvider()?.config,
        agentProvider: settings.defaultAgentRuntime,
        agentConfig: agentConfig,
        // Also send the AI provider info for clarity
        defaultProvider: settings.defaultProvider,
        defaultModel: settings.defaultModel,
      }),
    });

    if (!response.ok) {
      console.error(
        '[Settings] Failed to sync with backend:',
        response.statusText
      );
    } else {
      console.log('[Settings] Successfully synced with backend');
    }
  } catch (error) {
    // Backend might not be running, ignore error
    console.warn('[Settings] Could not sync with backend:', error);
  }
}

/**
 * Save settings and sync with backend
 */
export async function saveSettingsWithSync(settings: Settings): Promise<void> {
  saveSettings(settings);
  await syncSettingsWithBackend();
}

// ============================================================================
// Individual Setting Items (for flags like setupCompleted)
// ============================================================================

/**
 * Save a single setting item (for simple key-value flags)
 */
export async function saveSettingItem(
  key: string,
  value: string
): Promise<void> {
  const database = await getDatabase();

  if (database) {
    try {
      await database.execute(
        `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ($1, $2, datetime('now'))`,
        [key, JSON.stringify(value)]
      );
    } catch (error) {
      console.error(`[Settings] Failed to save ${key} to database:`, error);
    }
  }

  // Also save to localStorage
  try {
    localStorage.setItem(`workany_${key}`, value);
  } catch (error) {
    console.error(`[Settings] Failed to save ${key} to localStorage:`, error);
  }
}

/**
 * Get a single setting item
 */
export async function getSettingItem(key: string): Promise<string | null> {
  const database = await getDatabase();

  if (database) {
    try {
      const result = await database.select<{ value: string }[]>(
        'SELECT value FROM settings WHERE key = $1',
        [key]
      );
      if (result.length > 0) {
        return JSON.parse(result[0].value);
      }
    } catch (error) {
      console.error(`[Settings] Failed to get ${key} from database:`, error);
    }
  }

  // Fallback to localStorage
  try {
    return localStorage.getItem(`workany_${key}`);
  } catch {
    return null;
  }
}

/**
 * Check if setup has been completed
 */
export async function isSetupCompleted(): Promise<boolean> {
  const value = await getSettingItem('setupCompleted');
  return value === 'true';
}

/**
 * Clear all settings and reset to defaults
 */
export async function clearAllSettings(): Promise<void> {
  const database = await getDatabase();

  if (database) {
    try {
      await database.execute('DELETE FROM settings');
    } catch (error) {
      console.error(
        '[Settings] Failed to clear settings from database:',
        error
      );
    }
  }

  // Clear localStorage
  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith('workany')) {
        localStorage.removeItem(key);
      }
    }
  } catch (error) {
    console.error('[Settings] Failed to clear localStorage:', error);
  }

  // Reset cache
  settingsCache = null;
}
