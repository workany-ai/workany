// Import for factory
import type { AgentPlugin } from '@/core/agent/plugin';
import { getAgentRegistry } from '@/core/agent/registry';
import type { AgentConfig, AgentProvider, IAgent } from '@/core/agent/types';
import { DEFAULT_AGENT_PROVIDER, DEFAULT_WORK_DIR } from '@/config/constants';
import { codeanyPlugin } from '@/extensions/agent/codeany';

/**
 * Agent SDK Abstraction Layer
 *
 * Provides a unified interface for AI agent implementations.
 * Default provider: CodeAny Agent (@codeany/open-agent-sdk)
 *
 * Usage:
 * ```typescript
 * import { createAgent } from "./agents";
 *
 * const agent = createAgent({ provider: "codeany" });
 *
 * for await (const message of agent.run("Hello!")) {
 *   console.log(message);
 * }
 * ```
 */

// Re-export types
export * from '@/core/agent/types';

// Export plugin system
export * from '@/core/agent/plugin';

// Export registry
export {
  getAgentRegistry,
  registerAgentProvider,
  registerAgentPlugin,
  createAgentFromConfig,
  getAgentInstance,
  getAvailableAgentProviders,
  getRegisteredAgentProviders,
  getAllAgentMetadata,
  stopAllAgentProviders,
} from '@/core/agent/registry';

// Export base utilities
export {
  BaseAgent,
  PLANNING_INSTRUCTION,
  formatPlanForExecution,
  parsePlanFromResponse,
  getWorkspaceInstruction,
  type AgentCapabilities,
} from '@/core/agent/base';

// Export provider implementations
export {
  CodeAnyAgent,
  createCodeAnyAgent,
  codeanyPlugin,
} from '@/extensions/agent/codeany';

/**
 * All built-in agent plugins
 */
export const builtinAgentPlugins: AgentPlugin[] = [
  codeanyPlugin,
];

/**
 * Register all built-in agent providers
 */
export function registerBuiltinAgentProviders(): void {
  const registry = getAgentRegistry();

  for (const plugin of builtinAgentPlugins) {
    registry.register(plugin);
  }

  console.log(
    `[AgentProviders] Registered built-in providers: ${builtinAgentPlugins.map((p) => p.metadata.type).join(', ')}`
  );
}

/**
 * Get list of available providers
 */
export function getAvailableProviders(): AgentProvider[] {
  return getAgentRegistry().getRegistered() as AgentProvider[];
}

/**
 * Create an agent instance
 */
export function createAgent(config: AgentConfig): IAgent {
  const registry = getAgentRegistry();

  if (registry.getRegistered().length === 0) {
    registerBuiltinAgentProviders();
  }

  return registry.create(config);
}

/**
 * Default agent configuration
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  provider: DEFAULT_AGENT_PROVIDER,
  workDir: DEFAULT_WORK_DIR,
};

/**
 * Create a default agent (CodeAny)
 */
export function createDefaultAgent(overrides?: Partial<AgentConfig>): IAgent {
  return createAgent({
    ...DEFAULT_AGENT_CONFIG,
    ...overrides,
  });
}

/**
 * Environment variable for selecting provider
 */
export function getProviderFromEnv(): AgentProvider {
  const provider = process.env.AGENT_PROVIDER as AgentProvider | undefined;
  const registry = getAgentRegistry();

  if (registry.getRegistered().length === 0) {
    registerBuiltinAgentProviders();
  }

  if (provider && registry.has(provider)) {
    return provider;
  }
  return 'codeany';
}

/**
 * Create agent from environment configuration
 */
export function createAgentFromEnv(overrides?: Partial<AgentConfig>): IAgent {
  const provider = getProviderFromEnv();
  return createAgent({
    provider,
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    model: process.env.ANTHROPIC_MODEL || process.env.AGENT_MODEL,
    workDir: process.env.AGENT_WORK_DIR || DEFAULT_WORK_DIR,
    ...overrides,
  });
}

// ============================================================================
// Initialization
// ============================================================================

let initialized = false;

/**
 * Initialize the agents module with built-in providers
 */
export async function initAgents(): Promise<void> {
  if (initialized) {
    return;
  }

  registerBuiltinAgentProviders();
  initialized = true;

  console.log('[Agents] Module initialized');
}
