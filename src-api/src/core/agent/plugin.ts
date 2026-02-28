/**
 * Agent Plugin System
 *
 * Provides plugin definition and registration for agent providers.
 * Supports extending the system with custom agent implementations.
 */

import type { AgentConfig, IAgent } from '@/core/agent/types';
import { DEFAULT_AGENT_MODEL, DEFAULT_WORK_DIR, DEFAULT_KIMI_MODEL } from '@/config/constants';
import type { ProviderMetadata } from '@/shared/provider/types';

// ============================================================================
// Agent Plugin Types
// ============================================================================

/**
 * Extended metadata for agent providers
 */
export interface AgentProviderMetadata extends ProviderMetadata {
  /** Whether this is a built-in provider */
  builtin?: boolean;
  /** Whether the agent supports planning phase */
  supportsPlan: boolean;
  /** Whether the agent supports streaming responses */
  supportsStreaming: boolean;
  /** Supported models (if configurable) */
  supportedModels?: string[];
  /** Default model */
  defaultModel?: string;
  /** Whether sandbox mode is supported */
  supportsSandbox: boolean;
  /** Tags for categorization */
  tags?: string[];
}

/**
 * Agent provider plugin
 */
export interface AgentPlugin {
  metadata: AgentProviderMetadata;
  factory: (config: AgentConfig) => IAgent;
  onInit?: () => Promise<void>;
  onDestroy?: () => Promise<void>;
}

// ============================================================================
// Plugin Definition Helper
// ============================================================================

/**
 * Define an agent plugin with type safety
 *
 * @example
 * ```typescript
 * export default defineAgentPlugin({
 *   metadata: {
 *     type: "claude",
 *     name: "Claude Agent",
 *     version: "1.0.0",
 *     description: "Claude Agent SDK integration",
 *     configSchema: {...},
 *     supportsPlan: true,
 *     supportsStreaming: true,
 *     supportsSandbox: true,
 *   },
 *   factory: (config) => new ClaudeAgent(config),
 * });
 * ```
 */
export function defineAgentPlugin(plugin: AgentPlugin): AgentPlugin {
  // Validate required fields
  if (!plugin.metadata.type) {
    throw new Error('Agent plugin must have a type');
  }
  if (!plugin.metadata.name) {
    throw new Error('Agent plugin must have a name');
  }
  if (typeof plugin.factory !== 'function') {
    throw new Error('Agent plugin must have a factory function');
  }

  return plugin;
}

// ============================================================================
// Base Agent Class
// ============================================================================

/**
 * Re-export BaseAgent from base.ts for convenience
 */
export {
  BaseAgent,
  PLANNING_INSTRUCTION,
  formatPlanForExecution,
  parsePlanFromResponse,
  getWorkspaceInstruction,
} from '@/core/agent/base';

// ============================================================================
// Default Config Schemas
// ============================================================================

/**
 * JSON Schema for Claude agent configuration
 */
export const CLAUDE_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    apiKey: {
      type: 'string',
      description: 'Anthropic API key',
    },
    baseUrl: {
      type: 'string',
      description: 'Custom API base URL',
    },
    model: {
      type: 'string',
      default: DEFAULT_AGENT_MODEL,
      description: 'Claude model to use',
    },
    workDir: {
      type: 'string',
      default: DEFAULT_WORK_DIR,
      description: 'Working directory for file operations',
    },
  },
};

/**
 * JSON Schema for Codex agent configuration
 */
export const CODEX_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    apiKey: {
      type: 'string',
      description: 'OpenAI API key',
    },
    codexPath: {
      type: 'string',
      description: 'Path to codex CLI executable',
    },
    model: {
      type: 'string',
      default: 'gpt-4',
      description: 'OpenAI model to use',
    },
    workDir: {
      type: 'string',
      default: DEFAULT_WORK_DIR,
      description: 'Working directory for file operations',
    },
  },
};

/**
 * JSON Schema for DeepAgents configuration
 */
export const DEEPAGENTS_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    apiKey: {
      type: 'string',
      description: 'API key for the underlying LLM provider',
    },
    model: {
      type: 'string',
      default: DEFAULT_AGENT_MODEL,
      description: 'Model to use',
    },
    workDir: {
      type: 'string',
      default: DEFAULT_WORK_DIR,
      description: 'Working directory for file operations',
    },
  },
};

export const KIMI_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    apiKey: {
      type: 'string',
      description: 'Kimi Code API key (optional if using OAuth)',
    },
    baseUrl: {
      type: 'string',
      description: 'Kimi Code API base URL',
      default: 'https://api.kimi.com/coding/v1',
    },
    model: {
      type: 'string',
      default: DEFAULT_KIMI_MODEL,
      description: 'Kimi model to use',
    },
    workDir: {
      type: 'string',
      default: DEFAULT_WORK_DIR,
      description: 'Working directory for file operations',
    },
  },
};

// ============================================================================
// Built-in Plugin Metadata
// ============================================================================

/**
 * Metadata for built-in Claude agent
 */
export const CLAUDE_METADATA: AgentProviderMetadata = {
  type: 'claude',
  name: 'Claude Agent',
  version: '1.0.0',
  description:
    'Claude Agent SDK integration with full planning and execution support. Uses Anthropic Claude models.',
  configSchema: CLAUDE_CONFIG_SCHEMA,
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: true,
  supportedModels: [
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ],
  defaultModel: 'claude-sonnet-4-20250514',
  tags: ['anthropic', 'claude', 'planning', 'streaming'],
};

/**
 * Metadata for built-in Codex agent
 */
export const CODEX_METADATA: AgentProviderMetadata = {
  type: 'codex',
  name: 'Codex CLI',
  version: '1.0.0',
  description:
    'OpenAI Codex CLI integration. Uses OpenAI models through the codex command-line tool.',
  configSchema: CODEX_CONFIG_SCHEMA,
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: true,
  supportedModels: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  defaultModel: 'gpt-4',
  tags: ['openai', 'codex', 'cli'],
};

/**
 * Metadata for built-in DeepAgents adapter
 */
export const DEEPAGENTS_METADATA: AgentProviderMetadata = {
  type: 'deepagents',
  name: 'DeepAgents',
  version: '1.0.0',
  description:
    'DeepAgents.js framework integration using LangGraph. Supports multiple LLM providers.',
  configSchema: DEEPAGENTS_CONFIG_SCHEMA,
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: false,
  tags: ['langgraph', 'deepagents', 'multi-provider'],
};
 

/**   
 * Metadata for built-in Kimi agent
 */
export const KIMI_METADATA: AgentProviderMetadata = {
  type: 'kimi',
  name: 'Kimi Agent',
  version: '1.0.0',
  description:
    'Kimi Agent SDK integration. Uses Kimi models through the kimi command-line tool.',
  configSchema: KIMI_CONFIG_SCHEMA,
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: true,
};