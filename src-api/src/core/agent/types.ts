/**
 * Agent SDK Abstraction Layer - Type Definitions
 *
 * This module defines the common interfaces for different agent implementations.
 * Supports: Claude Agent SDK, DeepAgents.js, and custom implementations.
 */

// ============================================================================
// Message Types
// ============================================================================

import type { SandboxConfig } from '@/core/sandbox/types';

export type { SandboxConfig };

/**
 * Model configuration for custom API endpoints
 */
export interface ModelConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export type AgentMessageType =
  | 'session'
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'result'
  | 'error'
  | 'done'
  | 'plan'
  | 'direct_answer';

export interface AgentMessage {
  type: AgentMessageType;
  sessionId?: string;
  content?: string;
  name?: string;
  id?: string;
  input?: unknown;
  cost?: number;
  duration?: number;
  // Tool result fields
  toolUseId?: string;
  output?: string;
  isError?: boolean;
  // Plan fields
  plan?: TaskPlan;
  // Error fields
  message?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Image file paths attached to this message (saved to workspace) */
  imagePaths?: string[];
}

/**
 * Image attachment for vision capabilities
 */
export interface ImageAttachment {
  data: string; // Base64 encoded image data
  mimeType: string; // e.g., 'image/png', 'image/jpeg'
}

// ============================================================================
// Plan Types
// ============================================================================

export interface TaskPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  notes?: string;
  createdAt: Date;
}

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

// ============================================================================
// Agent Configuration
// ============================================================================

export type AgentProvider = 'claude' | 'codex' | 'deepagents' | 'openclaw' | 'custom';

export interface AgentConfig {
  /** Agent provider to use */
  provider: AgentProvider;
  /** API key for the provider */
  apiKey?: string;
  /** Custom API base URL (for third-party API endpoints) */
  baseUrl?: string;
  /** Model to use (provider-specific) */
  model?: string;
  /** Working directory for file operations */
  workDir?: string;
  /** Custom configuration for the provider */
  providerConfig?: Record<string, unknown>;
}

/**
 * Skills configuration for loading skills from different directories
 */
export interface SkillsConfig {
  /** Whether skills are globally enabled */
  enabled: boolean;
  /** Whether to load skills from user directory (~/.claude/skills) */
  userDirEnabled: boolean;
  /** Whether to load skills from app directory (workspace/skills) */
  appDirEnabled: boolean;
  /** Custom skills directory path (legacy support) */
  skillsPath?: string;
}

/**
 * MCP configuration for loading MCP servers from different config files
 */
export interface McpConfig {
  /** Whether MCP is globally enabled */
  enabled: boolean;
  /** Whether to load MCP servers from user directory (claude config) */
  userDirEnabled: boolean;
  /** Whether to load MCP servers from app directory (workany config) */
  appDirEnabled: boolean;
  /** Custom MCP config file path (legacy support) */
  mcpConfigPath?: string;
}

export interface AgentOptions {
  /** Session ID for continuing conversations */
  sessionId?: string;
  /** Conversation history */
  conversation?: ConversationMessage[];
  /** Working directory */
  cwd?: string;
  /** Allowed tools */
  allowedTools?: string[];
  /** Task ID for tracking */
  taskId?: string;
  /** Abort controller for cancellation */
  abortController?: AbortController;
  /** Permission mode */
  permissionMode?: 'plan' | 'execute' | 'bypassPermissions';
  /** Sandbox configuration for isolated execution */
  sandbox?: SandboxConfig;
  /** Image attachments for vision capabilities */
  images?: ImageAttachment[];
  /** Skills configuration */
  skillsConfig?: SkillsConfig;
  /** MCP configuration */
  mcpConfig?: McpConfig;
}

export interface PlanOptions extends AgentOptions {
  /** Planning-specific options */
}

export interface ExecuteOptions extends AgentOptions {
  /** Plan ID to execute */
  planId: string;
  /** Original prompt that created the plan */
  originalPrompt: string;
  /** Sandbox configuration */
  sandbox?: SandboxConfig;
  /** Plan object (optional - if not provided, will look up by planId) */
  plan?: TaskPlan;
}

// ============================================================================
// Agent Interface
// ============================================================================

/**
 * Base interface for all agent implementations.
 * Each provider (Claude, DeepAgents, etc.) must implement this interface.
 */
export interface IAgent {
  /** Provider name */
  readonly provider: AgentProvider;

  /**
   * Run the agent with a prompt (direct execution mode)
   */
  run(prompt: string, options?: AgentOptions): AsyncGenerator<AgentMessage>;

  /**
   * Run planning phase only (returns a plan for approval)
   */
  plan(prompt: string, options?: PlanOptions): AsyncGenerator<AgentMessage>;

  /**
   * Execute an approved plan
   */
  execute(options: ExecuteOptions): AsyncGenerator<AgentMessage>;

  /**
   * Stop the current execution
   */
  stop(sessionId: string): Promise<void>;

  /**
   * Get a stored plan by ID
   */
  getPlan(planId: string): TaskPlan | undefined;

  /**
   * Delete a stored plan
   */
  deletePlan(planId: string): void;
}

// ============================================================================
// Session Management
// ============================================================================

export interface AgentSession {
  id: string;
  createdAt: Date;
  phase: 'planning' | 'executing' | 'idle';
  isAborted: boolean;
  abortController: AbortController;
  config?: AgentConfig;
}

// ============================================================================
// Tool Definitions
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash',
  'WebSearch',
  'WebFetch',
  'Skill',
  'Task',
  'LSP',
  'TodoWrite',
];

// ============================================================================
// Factory Types
// ============================================================================

export type AgentFactory = (config: AgentConfig) => IAgent;

export interface AgentRegistry {
  register(provider: AgentProvider, factory: AgentFactory): void;
  get(provider: AgentProvider): AgentFactory | undefined;
  create(config: AgentConfig): IAgent;
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
  // Provider selection (optional, defaults to env config)
  provider?: 'claude' | 'deepagents';
  // Custom model configuration
  modelConfig?: ModelConfig;
  // Sandbox configuration for isolated execution
  sandboxConfig?: SandboxConfig;
}
