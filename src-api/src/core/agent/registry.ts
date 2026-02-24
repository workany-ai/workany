/**
 * Agent Provider Registry
 *
 * Manages registration and creation of agent providers.
 * Independent implementation for agent-specific functionality.
 */

import type { AgentPlugin, AgentProviderMetadata } from '@/core/agent/plugin';
import type {
  AgentConfig,
  AgentFactory,
  AgentProvider,
  IAgent,
} from '@/core/agent/types';
import { isDeepEqualConfig } from '@/shared/utils/config';

// ============================================================================
// Agent Instance State
// ============================================================================

type AgentState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'error'
  | 'stopped';

interface AgentInstance {
  agent: IAgent;
  state: AgentState;
  config?: AgentConfig;
  error?: Error;
  createdAt?: Date;
  lastUsedAt?: Date;
}

// ============================================================================
// Registry Implementation
// ============================================================================

/**
 * Agent registry with plugin support
 */
class AgentRegistry {
  private readonly registryName = 'AgentRegistry';
  private plugins: Map<string, AgentPlugin> = new Map();
  private instances: Map<string, AgentInstance> = new Map();

  /**
   * Register a provider factory (legacy interface)
   */
  register(provider: AgentProvider, factory: AgentFactory): void;
  /**
   * Register a provider plugin (new interface)
   */
  register(plugin: AgentPlugin): void;
  register(
    providerOrPlugin: AgentProvider | AgentPlugin,
    factory?: AgentFactory
  ): void {
    if (typeof providerOrPlugin === 'string') {
      // Legacy registration with provider name and factory
      const legacyPlugin: AgentPlugin = {
        metadata: {
          type: providerOrPlugin,
          name: providerOrPlugin,
          version: '1.0.0',
          description: `${providerOrPlugin} agent provider`,
          supportsPlan: false,
          supportsStreaming: false,
          supportsSandbox: false,
        },
        factory: (config: AgentConfig) => factory!(config),
      };
      this.registerPlugin(legacyPlugin);
    } else {
      // New plugin registration
      this.registerPlugin(providerOrPlugin);
    }
  }

  private registerPlugin(plugin: AgentPlugin): void {
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
   * Unregister a provider by type
   */
  unregister(type: string): void {
    this.plugins.delete(type);
    this.instances.delete(type);
  }

  /**
   * Check if a provider type is registered
   */
  has(type: string): boolean {
    return this.plugins.has(type);
  }

  /**
   * Get a provider factory by type
   */
  get(provider: AgentProvider): AgentFactory | undefined {
    return this.getFactory(provider);
  }

  getFactory(type: string): ((config: AgentConfig) => IAgent) | undefined {
    const plugin = this.plugins.get(type);
    return plugin?.factory;
  }

  /**
   * Get provider metadata by type
   */
  getMetadata(type: string): AgentProviderMetadata | undefined {
    return this.plugins.get(type)?.metadata;
  }

  /**
   * Get all registered metadata
   */
  getAllMetadata(): AgentProviderMetadata[] {
    return Array.from(this.plugins.values()).map((p) => p.metadata);
  }

  /**
   * Create an agent instance
   */
  create(config: AgentConfig): IAgent;
  create(provider: string, config?: AgentConfig): IAgent;
  create(configOrProvider: AgentConfig | string, config?: AgentConfig): IAgent {
    if (typeof configOrProvider === 'string') {
      const plugin = this.plugins.get(configOrProvider);
      if (!plugin) {
        throw new Error(
          `[${this.registryName}] Unknown provider type: ${configOrProvider}. ` +
            `Available: ${this.getRegistered().join(', ')}`
        );
      }
      return plugin.factory(
        config || { provider: configOrProvider as AgentProvider }
      );
    }
    const plugin = this.plugins.get(configOrProvider.provider);
    if (!plugin) {
      throw new Error(
        `[${this.registryName}] Unknown provider type: ${configOrProvider.provider}. ` +
          `Available: ${this.getRegistered().join(', ')}`
      );
    }
    return plugin.factory(configOrProvider);
  }

  /**
   * Get or create a singleton instance
   */
  async getInstance(type: string, config?: AgentConfig): Promise<IAgent> {
    let instanceData = this.instances.get(type);
    const effectiveConfig: AgentConfig = {
      ...(config ?? {}),
      provider: type as AgentProvider,
    };

    if (instanceData && instanceData.state === 'ready') {
      if (isDeepEqualConfig(instanceData.config, effectiveConfig)) {
        instanceData.lastUsedAt = new Date();
        return instanceData.agent;
      }
      try {
        const agentWithShutdown = instanceData.agent as {
          shutdown?: () => Promise<void>;
        };
        if (typeof agentWithShutdown.shutdown === 'function') {
          await agentWithShutdown.shutdown();
        }
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
    const agent = this.create(type, effectiveConfig);
    instanceData = {
      agent,
      state: 'ready',
      config: effectiveConfig,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    };
    this.instances.set(type, instanceData);

    return agent;
  }

  /**
   * Get all available provider types
   */
  async getAvailable(): Promise<string[]> {
    // For agents, all registered providers are considered available
    return this.getRegistered();
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
      if (instance.state === 'ready') {
        // Agents don't have a shutdown method, but we can clear the instance
        console.log(`[${this.registryName}] Clearing agent instance: ${type}`);
      }
    }

    await Promise.all(stopPromises);
    this.instances.clear();
    console.log(`[${this.registryName}] All agent instances cleared`);
  }

  /**
   * Get agent-specific metadata
   */
  getAgentMetadata(type: string): AgentProviderMetadata | undefined {
    return this.getMetadata(type);
  }

  /**
   * Get all agent metadata
   */
  getAllAgentMetadata(): AgentProviderMetadata[] {
    return this.getAllMetadata();
  }

  /**
   * Get agents that support planning
   */
  getWithPlanning(): string[] {
    const result: string[] = [];
    for (const metadata of this.getAllAgentMetadata()) {
      if (metadata.supportsPlan) {
        result.push(metadata.type);
      }
    }
    return result;
  }

  /**
   * Get agents that support streaming
   */
  getWithStreaming(): string[] {
    const result: string[] = [];
    for (const metadata of this.getAllAgentMetadata()) {
      if (metadata.supportsStreaming) {
        result.push(metadata.type);
      }
    }
    return result;
  }

  /**
   * Get agents that support sandbox mode
   */
  getWithSandbox(): string[] {
    const result: string[] = [];
    for (const metadata of this.getAllAgentMetadata()) {
      if (metadata.supportsSandbox) {
        result.push(metadata.type);
      }
    }
    return result;
  }

  /**
   * Get the default agent provider
   * Priority: claude > codex > deepagents
   */
  async getDefaultProvider(): Promise<string | undefined> {
    const priority = ['claude', 'codex', 'deepagents'];
    const available = await this.getAvailable();

    for (const type of priority) {
      if (available.includes(type)) {
        return type;
      }
    }

    return available[0];
  }
}

// ============================================================================
// Global Registry Instance
// ============================================================================

let globalRegistry: AgentRegistry | null = null;

/**
 * Get the global agent provider registry
 */
export function getAgentRegistry(): AgentRegistry {
  if (!globalRegistry) {
    globalRegistry = new AgentRegistry();
  }
  return globalRegistry;
}

/**
 * Register an agent provider factory (legacy)
 */
export function registerAgentProvider(
  provider: AgentProvider,
  factory: AgentFactory
): void {
  getAgentRegistry().register(provider, factory);
}

/**
 * Register an agent plugin
 */
export function registerAgentPlugin(plugin: AgentPlugin): void {
  getAgentRegistry().register(plugin);
}

/**
 * Create an agent instance from config
 */
export function createAgentFromConfig(config: AgentConfig): IAgent {
  return getAgentRegistry().create(config);
}

/**
 * Get or create a singleton agent instance
 */
export async function getAgentInstance(
  provider: AgentProvider,
  config?: AgentConfig
): Promise<IAgent> {
  return getAgentRegistry().getInstance(provider, config);
}

/**
 * Get all available agent providers
 */
export async function getAvailableAgentProviders(): Promise<string[]> {
  return getAgentRegistry().getAvailable();
}

/**
 * Get all registered agent providers
 */
export function getRegisteredAgentProviders(): string[] {
  return getAgentRegistry().getRegistered();
}

/**
 * Get all agent metadata
 */
export function getAllAgentMetadata(): AgentProviderMetadata[] {
  return getAgentRegistry().getAllAgentMetadata();
}

/**
 * Stop all agent provider instances
 */
export async function stopAllAgentProviders(): Promise<void> {
  return getAgentRegistry().stopAll();
}

export { AgentRegistry };
