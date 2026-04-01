/**
 * Agent Plugin System
 *
 * Provides plugin definition and registration for agent providers.
 * Supports extending the system with custom agent implementations.
 */

import type { AgentConfig, IAgent } from '@/core/agent/types';
import { DEFAULT_WORK_DIR, DEFAULT_CODEANY_MODEL } from '@/config/constants';
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

export function defineAgentPlugin(plugin: AgentPlugin): AgentPlugin {
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

export {
  BaseAgent,
  PLANNING_INSTRUCTION,
  formatPlanForExecution,
  parsePlanFromResponse,
  getWorkspaceInstruction,
} from '@/core/agent/base';

// ============================================================================
// Config Schemas & Metadata
// ============================================================================

/**
 * JSON Schema for CodeAny agent configuration
 */
export const CODEANY_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    apiKey: {
      type: 'string',
      description: 'API key (Anthropic or third-party)',
    },
    baseUrl: {
      type: 'string',
      description: 'Custom API base URL (e.g. OpenRouter)',
    },
    model: {
      type: 'string',
      default: DEFAULT_CODEANY_MODEL,
      description: 'Model to use',
    },
    workDir: {
      type: 'string',
      default: DEFAULT_WORK_DIR,
      description: 'Working directory for file operations',
    },
  },
};

/**
 * Metadata for built-in CodeAny agent
 */
export const CODEANY_METADATA: AgentProviderMetadata = {
  type: 'codeany',
  name: 'CodeAny Agent',
  version: '1.0.0',
  description:
    'Open-source agent runtime based on @codeany/open-agent-sdk. Runs entirely in-process — no external CLI binary required.',
  configSchema: CODEANY_CONFIG_SCHEMA,
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
  defaultModel: DEFAULT_CODEANY_MODEL,
  tags: ['codeany', 'open-agent', 'in-process', 'planning', 'streaming'],
};
