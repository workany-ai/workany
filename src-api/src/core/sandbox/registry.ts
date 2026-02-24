/**
 * Sandbox Provider Registry
 *
 * Manages registration and creation of sandbox providers.
 * Independent implementation for sandbox-specific functionality.
 */

import type {
  SandboxPlugin,
  SandboxProviderMetadata,
} from '@/core/sandbox/plugin';
import type {
  ISandboxProvider,
  SandboxProviderConfig,
  SandboxProviderFactory,
  SandboxProviderRegistry,
  SandboxProviderType,
} from '@/core/sandbox/types';
import { isDeepEqualConfig } from '@/shared/utils/config';

// ============================================================================
// Sandbox Instance State
// ============================================================================

type SandboxState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'error'
  | 'stopped';

interface SandboxInstance {
  provider: ISandboxProvider;
  state: SandboxState;
  config?: SandboxProviderConfig;
  error?: Error;
  createdAt?: Date;
  lastUsedAt?: Date;
}

// ============================================================================
// Registry Implementation
// ============================================================================

/**
 * Sandbox registry with plugin support
 */
class SandboxRegistry implements SandboxProviderRegistry {
  private readonly registryName = 'SandboxRegistry';
  private plugins: Map<string, SandboxPlugin> = new Map();
  private instances: Map<string, SandboxInstance> = new Map();

  /**
   * Register a provider factory (legacy interface)
   */
  register(type: SandboxProviderType, factory: SandboxProviderFactory): void;
  /**
   * Register a provider plugin (new interface)
   */
  register(plugin: SandboxPlugin): void;
  register(
    typeOrPlugin: SandboxProviderType | SandboxPlugin,
    factory?: SandboxProviderFactory
  ): void {
    if (typeof typeOrPlugin === 'string') {
      // Legacy registration with type and factory
      const legacyPlugin: SandboxPlugin = {
        metadata: {
          type: typeOrPlugin,
          name: typeOrPlugin,
          version: '1.0.0',
          description: `${typeOrPlugin} sandbox provider`,
          isolation: 'none',
          supportedRuntimes: ['node'],
          supportsVolumeMounts: false,
          supportsNetworking: true,
          supportsPooling: false,
        },
        factory: factory!,
      };
      this.registerPlugin(legacyPlugin);
    } else {
      // New plugin registration
      this.registerPlugin(typeOrPlugin);
    }
  }

  private registerPlugin(plugin: SandboxPlugin): void {
    const { type } = plugin.metadata;
    if (this.plugins.has(type)) {
      console.warn(
        `[${this.registryName}] Overwriting existing provider: ${type}`
      );
    }
    this.plugins.set(type, plugin);
    console.log(
      `[${this.registryName}] Registered provider: ${type} (${plugin.metadata.name})`
    );
  }

  /**
   * Get a provider factory by type
   */
  get(type: SandboxProviderType): SandboxProviderFactory | undefined {
    return this.getFactory(type);
  }

  getFactory(type: string): SandboxProviderFactory | undefined {
    const plugin = this.plugins.get(type);
    return plugin?.factory;
  }

  /**
   * Get provider metadata by type
   */
  getMetadata(type: string): SandboxProviderMetadata | undefined {
    return this.plugins.get(type)?.metadata;
  }

  /**
   * Get all registered metadata
   */
  getAllMetadata(): SandboxProviderMetadata[] {
    return Array.from(this.plugins.values()).map((p) => p.metadata);
  }

  /**
   * Create a provider instance
   */
  create(config: SandboxProviderConfig): ISandboxProvider;
  create(type: string, config?: SandboxProviderConfig): ISandboxProvider;
  create(
    configOrType: SandboxProviderConfig | string,
    config?: SandboxProviderConfig
  ): ISandboxProvider {
    if (typeof configOrType === 'string') {
      const plugin = this.plugins.get(configOrType);
      if (!plugin) {
        throw new Error(
          `[${this.registryName}] Unknown provider type: ${configOrType}. ` +
            `Available: ${this.getRegistered().join(', ')}`
        );
      }
      return plugin.factory(config);
    }
    const plugin = this.plugins.get(configOrType.type);
    if (!plugin) {
      throw new Error(
        `[${this.registryName}] Unknown provider type: ${configOrType.type}. ` +
          `Available: ${this.getRegistered().join(', ')}`
      );
    }
    return plugin.factory(configOrType);
  }

  /**
   * Get or create a singleton instance
   */
  async getInstance(
    type: string,
    config?: SandboxProviderConfig
  ): Promise<ISandboxProvider> {
    let instanceData = this.instances.get(type);

    if (instanceData && instanceData.state === 'ready') {
      if (isDeepEqualConfig(instanceData.config, config)) {
        instanceData.lastUsedAt = new Date();
        return instanceData.provider;
      }
      try {
        await instanceData.provider.shutdown();
      } catch (error) {
        console.warn(
          `[${this.registryName}] Failed to shutdown provider ${type}:`,
          error
        );
      }
      this.instances.delete(type);
      instanceData = undefined;
    }

    // If instance exists but is in error state, try to recreate
    if (instanceData && instanceData.state === 'error') {
      console.log(
        `[${this.registryName}] Recreating provider ${type} after error`
      );
      this.instances.delete(type);
      instanceData = undefined;
    }

    // Create new instance
    const provider = this.create(type, config);
    instanceData = {
      provider,
      state: 'initializing',
      config,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    };
    this.instances.set(type, instanceData);

    try {
      await provider.init(config?.config);
      instanceData.state = 'ready';
      return provider;
    } catch (error) {
      instanceData.state = 'error';
      instanceData.error =
        error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }

  /**
   * Get all available provider types
   */
  async getAvailable(): Promise<SandboxProviderType[]> {
    const available: SandboxProviderType[] = [];

    for (const [type, plugin] of this.plugins) {
      try {
        const provider = plugin.factory();
        const isAvailable = await provider.isAvailable();
        if (isAvailable) {
          available.push(type);
        }
      } catch {
        // Provider not available
      }
    }

    return available;
  }

  /**
   * Get all registered provider types
   */
  getRegistered(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Stop all running provider instances
   */
  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    for (const [type, instance] of this.instances) {
      if (instance.state === 'ready' || instance.state === 'error') {
        stopPromises.push(
          instance.provider.stop().catch((error) => {
            console.warn(
              `[${this.registryName}] Error stopping provider ${type}:`,
              error
            );
          })
        );
      }
    }

    await Promise.all(stopPromises);
    this.instances.clear();
    console.log(`[${this.registryName}] All provider instances stopped`);
  }

  /**
   * Get sandbox-specific metadata
   */
  getSandboxMetadata(type: string): SandboxProviderMetadata | undefined {
    return this.getMetadata(type);
  }

  /**
   * Get all sandbox metadata
   */
  getAllSandboxMetadata(): SandboxProviderMetadata[] {
    return this.getAllMetadata();
  }

  /**
   * Get providers by isolation level
   */
  getByIsolation(isolation: 'vm' | 'container' | 'process' | 'none'): string[] {
    const result: string[] = [];
    for (const metadata of this.getAllSandboxMetadata()) {
      if (metadata.isolation === isolation) {
        result.push(metadata.type);
      }
    }
    return result;
  }

  /**
   * Get providers that support a specific runtime
   */
  getByRuntime(runtime: string): string[] {
    const result: string[] = [];
    for (const metadata of this.getAllSandboxMetadata()) {
      if (metadata.supportedRuntimes?.includes(runtime)) {
        result.push(metadata.type);
      }
    }
    return result;
  }

  /**
   * Get the best available provider by priority
   * Priority: codex > claude > docker > native
   */
  async getBestAvailable(): Promise<string | undefined> {
    const priority = ['codex', 'claude', 'docker', 'native'];
    const available = await this.getAvailable();

    for (const type of priority) {
      if (available.includes(type)) {
        return type;
      }
    }

    // Return any available provider
    return available[0];
  }
}

// ============================================================================
// Global Registry Instance
// ============================================================================

let globalRegistry: SandboxRegistry | null = null;

/**
 * Get the global sandbox provider registry
 */
export function getSandboxRegistry(): SandboxRegistry {
  if (!globalRegistry) {
    globalRegistry = new SandboxRegistry();
  }
  return globalRegistry;
}

/**
 * Register a sandbox provider factory
 */
export function registerSandboxProvider(
  type: SandboxProviderType,
  factory: SandboxProviderFactory
): void {
  getSandboxRegistry().register(type, factory);
}

/**
 * Create a sandbox provider from config
 */
export function createSandboxProvider(
  config: SandboxProviderConfig
): ISandboxProvider {
  return getSandboxRegistry().create(config);
}

/**
 * Get or create a singleton provider instance
 */
export async function getSandboxProvider(
  type: SandboxProviderType,
  config?: SandboxProviderConfig
): Promise<ISandboxProvider> {
  return getSandboxRegistry().getInstance(type, config);
}

/**
 * Get all available sandbox provider types
 */
export async function getAvailableSandboxProviders(): Promise<
  SandboxProviderType[]
> {
  return getSandboxRegistry().getAvailable();
}

/**
 * Stop all sandbox provider instances
 */
export async function stopAllSandboxProviders(): Promise<void> {
  return getSandboxRegistry().stopAll();
}

export { SandboxRegistry };
