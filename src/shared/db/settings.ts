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

  // Skills settings
  skillsPath: string;
  skillsEnabled: boolean; // Enable skills mounting during agent conversations

  // Workspace settings
  workDir: string; // Working directory for sessions and outputs

  // Sandbox settings
  sandboxEnabled: boolean; // Enable sandbox mode for script execution
  sandboxProviders: SandboxProviderSetting[]; // Available sandbox providers
  defaultSandboxProvider: string; // Default sandbox provider ID

  // Agent Runtime settings
  agentRuntimes: AgentRuntimeSetting[]; // Available agent runtimes
  defaultAgentRuntime: string; // Default agent runtime ID

  // General settings
  theme: 'light' | 'dark' | 'system';
  accentColor: AccentColor;
  backgroundStyle: BackgroundStyle;
  language: string;
}

// Default providers
export const defaultProviders: AIProvider[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api',
    enabled: true,
    models: [
      'anthropic/claude-sonnet-4-5-20250514',
      'anthropic/claude-opus-4-5-20250514',
    ],
  },
  {
    id: 'volcengine',
    name: 'Volcengine',
    apiKey: '',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    enabled: true,
    models: ['ark-code-latest'],
  },
];

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
  skillsPath: '', // Will be resolved to app data dir at init
  skillsEnabled: true, // Enable skills by default
  workDir: '', // Will be resolved to app data dir at init
  sandboxEnabled: true,
  sandboxProviders: defaultSandboxProviders,
  defaultSandboxProvider: 'codex', // Default to Codex sandbox, fallback to native
  agentRuntimes: defaultAgentRuntimes,
  defaultAgentRuntime: 'claude', // Default to Claude Code
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
    return settingsCache;
  }

  const database = await getDatabase();

  if (database) {
    try {
      const result = await database.select<{ key: string; value: string }[]>(
        'SELECT key, value FROM settings'
      );

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
        // Debug: Log sandbox settings loaded from database
        console.log(
          '[Settings] Loaded from database - sandboxEnabled:',
          settings.sandboxEnabled,
          'provider:',
          settings.defaultSandboxProvider
        );
        settingsCache = settings;
        return settings;
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
      // Debug: Log sandbox settings loaded from localStorage
      console.log(
        '[Settings] Loaded from localStorage - sandboxEnabled:',
        loadedSettings.sandboxEnabled,
        'provider:',
        loadedSettings.defaultSandboxProvider
      );
      settingsCache = loadedSettings;
      return loadedSettings;
    }
  } catch (error) {
    console.error('[Settings] Failed to load from localStorage:', error);
  }

  // Debug: Using default settings
  console.log(
    '[Settings] Using defaultSettings - sandboxEnabled:',
    defaultSettings.sandboxEnabled,
    'provider:',
    defaultSettings.defaultSandboxProvider
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
      return loadedSettings;
    }
  } catch {
    // Ignore errors
  }

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

  // Save to localStorage immediately for sync access
  try {
    localStorage.setItem('workany_settings', JSON.stringify(settings));
  } catch (error) {
    console.error('[Settings] Failed to save to localStorage:', error);
  }

  // Also save to database asynchronously
  saveSettingsAsync(settings).catch((error) => {
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
