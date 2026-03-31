/**
 * Provider Manager
 *
 * Manages provider lifecycle, switching, and configuration.
 * Provides a unified interface for accessing sandbox and agent providers.
 */

// Forward declarations for registries - will be set during initialization

import type {
  IProvider,
  ProviderEvent,
  ProviderEventListener,
  ProviderMetadata,
  ProvidersConfig,
} from '@/shared/provider/types';
import { DEFAULT_AGENT_PROVIDER } from '@/config/constants';

// ============================================================================
// Provider Manager
// ============================================================================

/**
 * Centralized manager for all provider types
 */
class ProviderManagerImpl {
  /** Current configuration */
  private config: ProvidersConfig = {};

  /** Event listeners */
  private listeners: Set<ProviderEventListener> = new Set();

  /** Provider registries by category */
  private registries: Map<
    string,
    {
      getAvailable: () => Promise<string[]>;
      getAllMetadata: () => ProviderMetadata[];
      getInstance: (
        type: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config?: any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) => Promise<any>;
      stopAll: () => Promise<void>;
    }
  > = new Map();

  /** Current active providers by category */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private activeProviders: Map<string, any> = new Map();

  // ============================================================================
  // Registry Management
  // ============================================================================

  /**
   * Register a provider registry for a category
   */
  registerRegistry(
    category: string,
    registry: {
      getAvailable: () => Promise<string[]>;
      getAllMetadata: () => ProviderMetadata[];
      getInstance: (
        type: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config?: any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) => Promise<any>;
      stopAll: () => Promise<void>;
    }
  ): void {
    this.registries.set(category, registry);
    console.log(
      `[ProviderManager] Registered registry for category: ${category}`
    );
  }

  // ============================================================================
  // Provider Access
  // ============================================================================

  /**
   * Get the current sandbox provider
   */
  async getSandboxProvider(): Promise<IProvider | undefined> {
    const registry = this.registries.get('sandbox');
    if (!registry) {
      console.warn('[ProviderManager] No sandbox registry registered');
      return undefined;
    }

    const selection = this.config.sandbox;
    if (!selection) {
      // Use first available
      const available = await registry.getAvailable();
      if (available.length === 0) {
        return undefined;
      }
      return registry.getInstance(available[0]);
    }

    return registry.getInstance(selection.type, selection.config);
  }

  /**
   * Get the current agent provider
   */
  async getAgentProvider(): Promise<IProvider | undefined> {
    const registry = this.registries.get('agent');
    if (!registry) {
      console.warn('[ProviderManager] No agent registry registered');
      return undefined;
    }

    const selection = this.config.agent;
    if (!selection) {
      // Use first available
      const available = await registry.getAvailable();
      if (available.length === 0) {
        return undefined;
      }
      return registry.getInstance(available[0]);
    }

    return registry.getInstance(selection.type, selection.config);
  }

  /**
   * Get provider by category
   */
  async getProvider(category: string): Promise<IProvider | undefined> {
    const registry = this.registries.get(category);
    if (!registry) {
      console.warn(`[ProviderManager] No registry for category: ${category}`);
      return undefined;
    }

    const selection = this.config[category];
    if (!selection) {
      const available = await registry.getAvailable();
      if (available.length === 0) {
        return undefined;
      }
      return registry.getInstance(available[0]);
    }

    return registry.getInstance(selection.type, selection.config);
  }

  // ============================================================================
  // Provider Switching
  // ============================================================================

  /**
   * Switch sandbox provider
   */
  async switchSandboxProvider(
    type: string,
    config?: Record<string, unknown>
  ): Promise<void> {
    const registry = this.registries.get('sandbox');
    if (!registry) {
      throw new Error('No sandbox registry registered');
    }

    // Stop current instance if exists
    const current = this.activeProviders.get('sandbox');
    if (current) {
      await current.shutdown();
      this.activeProviders.delete('sandbox');
    }

    // Update config
    this.config.sandbox = { category: 'sandbox', type, config };

    // Create and activate new provider
    const provider = await registry.getInstance(type, config);
    this.activeProviders.set('sandbox', provider);

    this.emit({
      type: 'provider:switched',
      providerType: type,
      timestamp: new Date(),
      data: { category: 'sandbox' },
    });

    console.log(`[ProviderManager] Switched sandbox provider to: ${type}`);
  }

  /**
   * Switch agent provider
   */
  async switchAgentProvider(
    type: string,
    config?: Record<string, unknown>
  ): Promise<void> {
    const registry = this.registries.get('agent');
    if (!registry) {
      throw new Error('No agent registry registered');
    }

    // Stop current instance if exists
    const current = this.activeProviders.get('agent');
    if (current) {
      await current.shutdown();
      this.activeProviders.delete('agent');
    }

    // Update config
    this.config.agent = { category: 'agent', type, config };

    // Create and activate new provider
    const provider = await registry.getInstance(type, config);
    this.activeProviders.set('agent', provider);

    this.emit({
      type: 'provider:switched',
      providerType: type,
      timestamp: new Date(),
      data: { category: 'agent' },
    });

    console.log(`[ProviderManager] Switched agent provider to: ${type}`);
  }

  /**
   * Switch provider by category
   */
  async switchProvider(
    category: string,
    type: string,
    config?: Record<string, unknown>
  ): Promise<void> {
    if (category === 'sandbox') {
      return this.switchSandboxProvider(type, config);
    }
    if (category === 'agent') {
      return this.switchAgentProvider(type, config);
    }

    const registry = this.registries.get(category);
    if (!registry) {
      throw new Error(`No registry for category: ${category}`);
    }

    const current = this.activeProviders.get(category);
    if (current) {
      await current.shutdown();
      this.activeProviders.delete(category);
    }

    this.config[category] = {
      category: category as 'sandbox' | 'agent',
      type,
      config,
    };

    const provider = await registry.getInstance(type, config);
    this.activeProviders.set(category, provider);

    this.emit({
      type: 'provider:switched',
      providerType: type,
      timestamp: new Date(),
      data: { category },
    });
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Get current configuration
   */
  getConfig(): ProvidersConfig {
    return { ...this.config };
  }

  /**
   * Set configuration
   */
  setConfig(config: ProvidersConfig): void {
    this.config = { ...config };
    console.log('[ProviderManager] Configuration updated');
  }

  /**
   * Update configuration from settings
   */
  updateFromSettings(settings: {
    sandboxProvider?: string;
    sandboxConfig?: Record<string, unknown>;
    agentProvider?: string;
    agentConfig?: Record<string, unknown>;
  }): void {
    if (settings.sandboxProvider) {
      this.config.sandbox = {
        category: 'sandbox',
        type: settings.sandboxProvider,
        config: settings.sandboxConfig,
      };
    }

    if (settings.agentProvider) {
      this.config.agent = {
        category: 'agent',
        type: settings.agentProvider,
        config: settings.agentConfig,
      };
    }
  }

  // ============================================================================
  // Metadata
  // ============================================================================

  /**
   * Get all sandbox provider metadata
   */
  getSandboxProvidersMetadata(): ProviderMetadata[] {
    const registry = this.registries.get('sandbox');
    return registry?.getAllMetadata() ?? [];
  }

  /**
   * Get all agent provider metadata
   */
  getAgentProvidersMetadata(): ProviderMetadata[] {
    const registry = this.registries.get('agent');
    return registry?.getAllMetadata() ?? [];
  }

  /**
   * Get available sandbox providers
   */
  async getAvailableSandboxProviders(): Promise<string[]> {
    const registry = this.registries.get('sandbox');
    return registry?.getAvailable() ?? [];
  }

  /**
   * Get available agent providers
   */
  async getAvailableAgentProviders(): Promise<string[]> {
    const registry = this.registries.get('agent');
    return registry?.getAvailable() ?? [];
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Initialize all registries and load default providers
   */
  async initialize(): Promise<void> {
    console.log('[ProviderManager] Initializing...');

    // Dynamically import and register sandbox registry
    try {
      const {
        getSandboxRegistry,
        registerBuiltinProviders: registerSandboxProviders,
      } = await import('@/core/sandbox');
      registerSandboxProviders();
      const sandboxRegistry = getSandboxRegistry();
      this.registerRegistry('sandbox', {
        getAvailable: () => sandboxRegistry.getAvailable(),
        getAllMetadata: () => sandboxRegistry.getAllMetadata(),
        getInstance: (type, config) =>
          sandboxRegistry.getInstance(type, config),
        stopAll: () => sandboxRegistry.stopAll(),
      });
    } catch (error) {
      console.warn('[ProviderManager] Could not load sandbox registry:', error);
    }

    // Dynamically import and register agent registry
    try {
      const { getAgentRegistry, registerBuiltinAgentProviders } =
        await import('@/core/agent/index');
      registerBuiltinAgentProviders();
      const agentRegistry = getAgentRegistry();
      this.registerRegistry('agent', {
        getAvailable: () => agentRegistry.getAvailable(),
        getAllMetadata: () => agentRegistry.getAllMetadata(),
        getInstance: (type, config) => agentRegistry.getInstance(type, config),
        stopAll: () => agentRegistry.stopAll(),
      });
    } catch (error) {
      console.warn('[ProviderManager] Could not load agent registry:', error);
    }

    // Load default configuration from environment if not set
    // Default to codex for isolated execution
    // Network packages will auto-switch to native provider for proxy support
    if (!this.config.sandbox) {
      const sandboxType = process.env.SANDBOX_PROVIDER || 'codex';
      this.config.sandbox = { category: 'sandbox', type: sandboxType };
    }

    if (!this.config.agent) {
      const agentType = process.env.AGENT_PROVIDER || DEFAULT_AGENT_PROVIDER;
      this.config.agent = { category: 'agent', type: agentType };
    }

    console.log('[ProviderManager] Initialized with config:', this.config);
  }

  /**
   * Shutdown all active providers
   */
  async shutdown(): Promise<void> {
    console.log('[ProviderManager] Shutting down...');

    // Stop all active providers
    for (const [category, provider] of this.activeProviders) {
      try {
        await provider.shutdown();
        console.log(`[ProviderManager] Stopped ${category} provider`);
      } catch (error) {
        console.warn(
          `[ProviderManager] Error stopping ${category} provider:`,
          error
        );
      }
    }
    this.activeProviders.clear();

    // Stop all registries
    for (const [category, registry] of this.registries) {
      try {
        await registry.stopAll();
        console.log(`[ProviderManager] Stopped all ${category} providers`);
      } catch (error) {
        console.warn(
          `[ProviderManager] Error stopping ${category} registry:`,
          error
        );
      }
    }

    console.log('[ProviderManager] Shutdown complete');
  }

  // ============================================================================
  // Events
  // ============================================================================

  /**
   * Add an event listener
   */
  on(listener: ProviderEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Remove an event listener
   */
  off(listener: ProviderEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit an event
   */
  private emit(event: ProviderEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ProviderManager] Error in event listener:', error);
      }
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let providerManager: ProviderManagerImpl | null = null;

/**
 * Get the global provider manager instance
 */
export function getProviderManager(): ProviderManagerImpl {
  if (!providerManager) {
    providerManager = new ProviderManagerImpl();
  }
  return providerManager;
}

/**
 * Initialize the provider manager
 */
export async function initProviderManager(): Promise<ProviderManagerImpl> {
  const manager = getProviderManager();
  await manager.initialize();
  return manager;
}

/**
 * Shutdown the provider manager
 */
export async function shutdownProviderManager(): Promise<void> {
  if (providerManager) {
    await providerManager.shutdown();
  }
}

export { ProviderManagerImpl };
