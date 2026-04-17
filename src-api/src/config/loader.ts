/**
 * Configuration Loader
 *
 * Loads and manages provider configuration from multiple sources:
 * - Environment variables
 * - Configuration files
 * - Runtime updates from frontend
 */

import * as fs from 'fs';
import * as path from 'path';

import type { ProvidersConfig } from '@/shared/provider/types';
import { getAppDataDir, getConfigPath } from '@/shared/utils/paths';

import {
  APP_DIR_NAME,
  CONFIG_SEARCH_PATHS,
  DEFAULT_AGENT_PROVIDER,
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  DEFAULT_SANDBOX_PROVIDER,
} from './constants';

// ============================================================================
// Types
// ============================================================================

/**
 * Full application configuration
 */
export interface AppConfig {
  /** Provider configurations */
  providers: ProvidersConfig;

  /** API settings */
  api?: {
    port?: number;
    host?: string;
    cors?: {
      origin?: string | string[];
      credentials?: boolean;
    };
  };

  /** Workspace settings */
  workspace?: {
    defaultDir?: string;
    allowedDirs?: string[];
  };
}

/**
 * Configuration source
 */
export type ConfigSource = 'env' | 'file' | 'runtime' | 'default';

/**
 * Configuration change event
 */
export interface ConfigChangeEvent {
  source: ConfigSource;
  path: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: Date;
}

export type ConfigChangeListener = (event: ConfigChangeEvent) => void;

// ============================================================================
// Default Configuration
// ============================================================================

// Get platform-specific default workspace directory
const defaultWorkspaceDir = getAppDataDir();

const DEFAULT_CONFIG: AppConfig = {
  providers: {
    sandbox: {
      category: 'sandbox',
      type: DEFAULT_SANDBOX_PROVIDER,
    },
    agent: {
      category: 'agent',
      type: DEFAULT_AGENT_PROVIDER,
    },
  },
  api: {
    port: DEFAULT_API_PORT,
    host: DEFAULT_API_HOST,
  },
  workspace: {
    defaultDir: defaultWorkspaceDir,
  },
};

// ============================================================================
// Configuration Loader Class
// ============================================================================

class ConfigLoader {
  private config: AppConfig;
  private configPath: string | null = null;
  private listeners: Set<ConfigChangeListener> = new Set();
  private fileWatcher: fs.FSWatcher | null = null;

  constructor() {
    this.config = this.deepClone(DEFAULT_CONFIG);
  }

  // ============================================================================
  // Loading
  // ============================================================================

  /**
   * Load configuration from all sources
   */
  async load(): Promise<AppConfig> {
    // Start with defaults
    this.config = this.deepClone(DEFAULT_CONFIG);

    // Load from file if exists
    const filePath = this.findConfigFile();
    if (filePath) {
      await this.loadFromFile(filePath);
    }

    // Override with environment variables
    this.loadFromEnv();

    return this.config;
  }

  /**
   * Load configuration from a specific file
   */
  async loadFromFile(filePath: string): Promise<void> {
    try {
      const absolutePath = path.resolve(filePath);

      if (!fs.existsSync(absolutePath)) {
        console.warn(`[ConfigLoader] Config file not found: ${absolutePath}`);
        return;
      }

      const content = fs.readFileSync(absolutePath, 'utf-8');
      const ext = path.extname(absolutePath).toLowerCase();

      let fileConfig: Partial<AppConfig>;
      if (ext === '.json') {
        fileConfig = JSON.parse(content);
      } else {
        console.warn(`[ConfigLoader] Unsupported config file format: ${ext}`);
        return;
      }

      this.mergeConfig(fileConfig, 'file');
      this.configPath = absolutePath;
      this.loadEnvFromConfig(fileConfig as unknown as Record<string, unknown>);

      console.log(`[ConfigLoader] Loaded config from: ${absolutePath}`);
    } catch (error) {
      console.error(`[ConfigLoader] Error loading config file:`, error);
    }
  }

  /**
   * Load custom env vars from config.json's "env" field.
   * Values like "${VAR}" are resolved from process.env.
   */
  private loadEnvFromConfig(fileConfig: Record<string, unknown>): void {
    const envMap = fileConfig.env as Record<string, string> | undefined;
    if (!envMap || typeof envMap !== 'object') return;

    for (const [key, value] of Object.entries(envMap)) {
      if (typeof value !== 'string') continue;
      const resolved = value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || '');
      if (resolved && !process.env[key]) {
        process.env[key] = resolved;
        console.log(`[ConfigLoader] Injected env: ${key}`);
      }
    }
  }

  /**
   * Load configuration from environment variables
   */
  loadFromEnv(): void {
    // Sandbox provider
    if (process.env.SANDBOX_PROVIDER) {
      this.config.providers.sandbox = {
        category: 'sandbox',
        type: process.env.SANDBOX_PROVIDER,
      };
    }

    // Agent provider
    if (process.env.AGENT_PROVIDER) {
      this.config.providers.agent = {
        category: 'agent',
        type: process.env.AGENT_PROVIDER,
        config: {
          apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY,
          baseUrl: process.env.ANTHROPIC_BASE_URL,
          model: process.env.AGENT_MODEL,
        },
      };
    }

    // API settings
    if (process.env.PORT) {
      this.config.api = this.config.api || {};
      this.config.api.port = Number(process.env.PORT);
    }

    // Workspace
    if (process.env.AGENT_WORK_DIR) {
      this.config.workspace = this.config.workspace || {};
      this.config.workspace.defaultDir = process.env.AGENT_WORK_DIR;
    }
  }

  /**
   * Find the config file in standard locations
   */
  private findConfigFile(): string | null {
    const searchPaths = [
      process.env.WORKANY_CONFIG,
      ...CONFIG_SEARCH_PATHS,
      getConfigPath(), // Platform-specific config path
      path.join(process.env.HOME || '', APP_DIR_NAME, 'config.json'), // Legacy fallback
    ].filter(Boolean) as string[];

    for (const searchPath of searchPaths) {
      if (fs.existsSync(searchPath)) {
        return searchPath;
      }
    }

    return null;
  }

  // ============================================================================
  // Configuration Access
  // ============================================================================

  /**
   * Get the full configuration
   */
  getConfig(): AppConfig {
    return this.deepClone(this.config);
  }

  /**
   * Get provider configuration
   */
  getProviders(): ProvidersConfig {
    return this.deepClone(this.config.providers);
  }

  /**
   * Get a specific value by path (e.g., "providers.sandbox.type")
   */
  get<T = unknown>(path: string): T | undefined {
    const parts = path.split('.');
    let current: unknown = this.config;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current as T;
  }

  // ============================================================================
  // Configuration Updates
  // ============================================================================

  /**
   * Update configuration at runtime
   */
  set(path: string, value: unknown): void {
    const oldValue = this.get(path);

    const parts = path.split('.');
    let current: Record<string, unknown> = this.config as unknown as Record<
      string,
      unknown
    >;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;

    this.emit({
      source: 'runtime',
      path,
      oldValue,
      newValue: value,
      timestamp: new Date(),
    });
  }

  /**
   * Update from frontend settings sync
   */
  updateFromSettings(settings: {
    sandboxProvider?: string;
    sandboxConfig?: Record<string, unknown>;
    agentProvider?: string;
    agentConfig?: Record<string, unknown>;
  }): void {
    if (settings.sandboxProvider) {
      this.config.providers.sandbox = {
        category: 'sandbox',
        type: settings.sandboxProvider,
        config: settings.sandboxConfig,
      };

      this.emit({
        source: 'runtime',
        path: 'providers.sandbox',
        oldValue: undefined,
        newValue: this.config.providers.sandbox,
        timestamp: new Date(),
      });
    }

    if (settings.agentProvider) {
      this.config.providers.agent = {
        category: 'agent',
        type: settings.agentProvider,
        config: settings.agentConfig,
      };

      this.emit({
        source: 'runtime',
        path: 'providers.agent',
        oldValue: undefined,
        newValue: this.config.providers.agent,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Merge partial config into current config
   */
  private mergeConfig(
    partial: Partial<AppConfig>,
    _source: ConfigSource
  ): void {
    // Deep merge - use type assertion to bypass strict type checking
    this.config = this.deepMerge(
      this.config as unknown as Record<string, unknown>,
      partial as unknown as Partial<Record<string, unknown>>
    ) as unknown as AppConfig;
  }

  // ============================================================================
  // File Watching
  // ============================================================================

  /**
   * Start watching the config file for changes
   */
  startWatching(): void {
    if (!this.configPath || this.fileWatcher) {
      return;
    }

    this.fileWatcher = fs.watch(this.configPath, async (eventType) => {
      if (eventType === 'change') {
        console.log(`[ConfigLoader] Config file changed, reloading...`);
        await this.loadFromFile(this.configPath!);
      }
    });

    console.log(`[ConfigLoader] Watching config file: ${this.configPath}`);
  }

  /**
   * Stop watching the config file
   */
  stopWatching(): void {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
  }

  // ============================================================================
  // Events
  // ============================================================================

  /**
   * Add a change listener
   */
  onChange(listener: ConfigChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit a change event
   */
  private emit(event: ConfigChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ConfigLoader] Error in change listener:', error);
      }
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Deep clone an object
   */
  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Deep merge two objects
   */
  private deepMerge<T extends Record<string, unknown>>(
    target: T,
    source: Partial<T>
  ): T {
    const result = { ...target };

    for (const key in source) {
      const sourceValue = source[key];
      const targetValue = target[key];

      if (
        sourceValue !== null &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue !== null &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        result[key] = this.deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        ) as T[Extract<keyof T, string>];
      } else {
        result[key] = sourceValue as T[Extract<keyof T, string>];
      }
    }

    return result;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let configLoader: ConfigLoader | null = null;

/**
 * Get the global config loader instance
 */
export function getConfigLoader(): ConfigLoader {
  if (!configLoader) {
    configLoader = new ConfigLoader();
  }
  return configLoader;
}

/**
 * Load configuration (convenience function)
 */
export async function loadConfig(): Promise<AppConfig> {
  return getConfigLoader().load();
}

/**
 * Get configuration (convenience function)
 */
export function getConfig(): AppConfig {
  return getConfigLoader().getConfig();
}

/**
 * Get provider configuration (convenience function)
 */
export function getProvidersConfig(): ProvidersConfig {
  return getConfigLoader().getProviders();
}

export { ConfigLoader };
