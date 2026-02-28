/**
 * Agent Types
 *
 * Re-exports types from the agents abstraction layer
 * and defines API-specific request types.
 */

// Re-export all types from agents module
export type {
  AgentMessage,
  AgentMessageType,
  AgentSession,
  TaskPlan,
  PlanStep,
  ConversationMessage,
  AgentConfig,
  AgentProvider,
  AgentOptions,
  IAgent,
  SkillsConfig,
  McpConfig,
} from '@/core/agent/types';

/**
 * Model configuration for custom API endpoints
 */
export interface ModelConfig {
  apiKey?: string; // API key (ANTHROPIC_API_KEY)
  baseUrl?: string; // Custom API base URL (ANTHROPIC_BASE_URL)
  model?: string; // Model name to use
}

/**
 * Sandbox configuration for isolated script execution
 */
export interface SandboxConfig {
  enabled: boolean; // Whether sandbox mode is enabled
  provider?: string; // Sandbox provider to use (e.g., 'codex', 'native', 'docker')
  image?: string; // Container image to use (e.g., node:18-alpine)
  apiEndpoint?: string; // API endpoint for sandbox service
  providerConfig?: Record<string, unknown>; // Provider-specific configuration
}

/**
 * Image attachment for API requests
 */
export interface ImageAttachment {
  data: string; // Base64 encoded image data
  mimeType: string; // e.g., 'image/png', 'image/jpeg'
}

/**
 * Skills configuration for API requests
 */
export interface SkillsConfigRequest {
  enabled: boolean;
  userDirEnabled: boolean;
  appDirEnabled: boolean;
  skillsPath?: string;
}

/**
 * MCP configuration for API requests
 */
export interface McpConfigRequest {
  enabled: boolean;
  userDirEnabled: boolean;
  appDirEnabled: boolean;
  mcpConfigPath?: string;
}

/**
 * API Request type for agent endpoints
 */
export interface AgentRequest {
  prompt: string;
  sessionId?: string;
  conversation?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  // Two-phase execution control
  phase?: 'plan' | 'execute';
  planId?: string; // Reference to approved plan
  // Workspace settings
  workDir?: string; // Working directory for session outputs
  taskId?: string; // Task ID for session folder
  // Skills configuration
  skillsConfig?: SkillsConfigRequest;
  // MCP configuration
  mcpConfig?: McpConfigRequest;
  // Provider selection (optional, defaults to env config)
  provider?: 'claude' | 'deepagents'|'kimi';
  // Custom model configuration
  modelConfig?: ModelConfig;
  // Sandbox configuration for isolated execution
  sandboxConfig?: SandboxConfig;
  // Image attachments for vision capabilities
  images?: ImageAttachment[];
}
