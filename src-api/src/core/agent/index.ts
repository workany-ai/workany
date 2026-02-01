// Import for factory
import type { AgentPlugin } from '@/core/agent/plugin';
import { getAgentRegistry } from '@/core/agent/registry';
import type { AgentConfig, AgentProvider, IAgent } from '@/core/agent/types';
import { DEFAULT_AGENT_PROVIDER, DEFAULT_WORK_DIR } from '@/config/constants';
import { claudePlugin } from '@/extensions/agent/claude';
import { codexPlugin } from '@/extensions/agent/codex';
import { deepagentsPlugin } from '@/extensions/agent/deepagents';
import { kimiPlugin } from '@/extensions/agent/kimi';

/**
 * Agent SDK Abstraction Layer
 *
 * This module provides a unified interface for different AI agent implementations.
 * Currently supported providers:
 * - Claude Agent SDK (default)
 * - Codex CLI (OpenAI)
 * - DeepAgents.js (optional)
 *
 * Usage:
 * ```typescript
 * import { createAgent, AgentConfig } from "./agents";
 *
 * // Use Claude (default)
 * const agent = createAgent({ provider: "claude" });
 *
 * // Use Codex CLI
 * const agent = createAgent({
 *   provider: "codex",
 *   apiKey: "your-openai-key"
 * });
 *
 * // Use DeepAgents.js
 * const agent = createAgent({
 *   provider: "deepagents",
 *   apiKey: "your-api-key",
 *   model: "claude-sonnet-4-20250514"
 * });
 *
 * // Run agent
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
  ClaudeAgent,
  createClaudeAgent,
  claudePlugin,
} from '@/extensions/agent/claude';
export {
  CodexAgent,
  createCodexAgent,
  codexPlugin,
} from '@/extensions/agent/codex';
export {
  DeepAgentsAdapter,
  createDeepAgentsAdapter,
  deepagentsPlugin,
} from '@/extensions/agent/deepagents';

export {
  KimiAgent,
  createKimiAgent,
  kimiPlugin,
} from '@/extensions/agent/kimi';
/**
 * All built-in agent plugins
 */
export const builtinAgentPlugins: AgentPlugin[] = [
  claudePlugin,
  codexPlugin,
  deepagentsPlugin,
  kimiPlugin,
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
 * Get list of available providers (legacy compatibility)
 */
export function getAvailableProviders(): AgentProvider[] {
  return getAgentRegistry().getRegistered() as AgentProvider[];
}

/**
 * Create an agent instance
 *
 * @param config - Agent configuration
 * @returns An IAgent implementation
 * @throws Error if the provider is not registered
 *
 * @example
 * ```typescript
 * // Create a Claude agent (default)
 * const agent = createAgent({ provider: "claude" });
 *
 * // Create with specific working directory
 * const agent = createAgent({
 *   provider: "claude",
 *   workDir: "/path/to/workspace"
 * });
 *
 * // Create DeepAgents.js agent
 * const agent = createAgent({
 *   provider: "deepagents",
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   model: "claude-sonnet-4-20250514"
 * });
 * ```
 */
export function createAgent(config: AgentConfig): IAgent {
  const registry = getAgentRegistry();

  // Ensure built-in providers are registered
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
 * Create a default agent (Claude)
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

  // Ensure built-in providers are registered
  if (registry.getRegistered().length === 0) {
    registerBuiltinAgentProviders();
  }

  if (provider && registry.has(provider)) {
    return provider;
  }
  return 'claude';
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
