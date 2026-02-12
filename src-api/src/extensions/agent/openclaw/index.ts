/**
 * OpenClaw Agent Implementation
 *
 * This module provides an OpenClaw Gateway agent implementation for WorkAny.
 * It integrates with the OpenClaw Gateway via WebSocket JSON-RPC protocol.
 */

import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ExecuteOptions,
  ImageAttachment,
  PlanOptions,
} from '@/core/agent/types';
import {
  BaseAgent,
  formatPlanForExecution,
  getWorkspaceInstruction,
  parsePlanFromResponse,
  parsePlanningResponse,
  PLANNING_INSTRUCTION,
} from '@/core/agent/base';
import { defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentPlugin } from '@/core/agent/plugin';
import type { OpenClawConfig } from './types';
import {
  OpenClawGateway,
  getDefaultGatewayConfig,
} from './gateway';
import { pollStreamingResponse } from './streaming';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('OpenClawAgent');

// ============================================================================
// OpenClaw Agent Metadata
// ============================================================================

/**
 * OpenClaw agent provider metadata
 */
export const OPENCLAW_METADATA = {
  type: 'openclaw',
  name: 'OpenClaw Bot',
  version: '1.0.0',
  description:
    'OpenClaw Gateway integration via WebSocket JSON-RPC. Provides access to OpenClaw bot capabilities.',
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: false,
  tags: ['openclaw', 'websocket', 'bot', 'gateway'],
};

// ============================================================================
// OpenClaw Agent Class
// ============================================================================

/**
 * OpenClaw Agent implementation
 *
 * Communicates with OpenClaw Gateway using WebSocket JSON-RPC protocol.
 * Supports planning and execution phases with polling-based streaming.
 */
export class OpenClawAgent extends BaseAgent {
  readonly provider: AgentProvider = 'openclaw';
  private gateway: OpenClawGateway;
  private currentSessionKey: string | null = null;
  private currentFriendlyId: string | null = null;

  constructor(config: AgentConfig) {
    super(config);

    // Get OpenClaw-specific configuration
    const openclawConfig = (config.providerConfig ||
      getDefaultGatewayConfig()) as OpenClawConfig;

    this.gateway = new OpenClawGateway(openclawConfig);

    logger.debug(
      `[OpenClawAgent] Initialized with gateway: ${openclawConfig.gatewayUrl}`
    );
  }

  // ============================================================================
  // IAgent Implementation
  // ============================================================================

  /**
   * Run the agent with direct execution mode
   *
   * @param prompt - User prompt
   * @param options - Agent options
   * @yields AgentMessage instances
   */
  async *run(
    prompt: string,
    options?: AgentOptions
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing');
    yield { type: 'session', sessionId: session.id };

    const sessionCwd = options?.cwd || this.config.workDir || '.';
    logger.debug(
      `[OpenClaw ${session.id}] Working directory: ${sessionCwd}`
    );
    logger.debug(`[OpenClaw ${session.id}] Direct execution started`);

    try {
      // Resolve or create session
      const { sessionKey } = await this.resolveOrCreateSession(
        options?.sessionId
      );

      // Build enhanced prompt with workspace instruction
      const workspaceInstruction = getWorkspaceInstruction(
        sessionCwd,
        options?.sandbox
          ? {
              enabled: true,
              image: options?.sandbox?.image,
              apiEndpoint: options?.sandbox?.apiEndpoint,
            }
          : undefined
      );
      const enhancedPrompt = workspaceInstruction + '\n\n' + prompt;

      // Build message with attachments
      const message = await this.buildUserMessage(
        enhancedPrompt,
        options?.images
      );

      // Send message to gateway
      await this.gateway.chatSend({
        sessionKey,
        message: message.text,
        attachments: message.attachments,
        timeoutMs: 120000,
        idempotencyKey: session.id,
      });

      // Poll for streaming response
      yield* pollStreamingResponse(this.gateway, sessionKey);
    } catch (error) {
      logger.error(`[OpenClaw ${session.id}] Error:`, error);
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.sessions.delete(session.id);
      // Don't clear session key - keep for continuation
    }
  }

  /**
   * Run planning phase
   *
   * @param prompt - User prompt
   * @param options - Plan options
   * @yields AgentMessage instances
   */
  async *plan(
    prompt: string,
    options?: PlanOptions
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('planning');
    yield { type: 'session', sessionId: session.id };

    const _sessionCwd = options?.cwd || this.config.workDir || '.';
    logger.debug(`[OpenClaw ${session.id}] Planning phase started`);

    try {
      const { sessionKey } = await this.resolveOrCreateSession(
        options?.sessionId
      );

      // Add planning instruction to prompt
      const planningPrompt = `${PLANNING_INSTRUCTION}\n\nUser request: ${prompt}`;

      // Send planning request
      await this.gateway.chatSend({
        sessionKey,
        message: planningPrompt,
        thinking: 'high',
        timeoutMs: 120000,
        idempotencyKey: session.id,
      });

      // Collect full response for plan parsing
      let fullResponse = '';
      let hasPlan = false;

      for await (const message of pollStreamingResponse(this.gateway, sessionKey)) {
        if (message.type === 'text') {
          fullResponse += message.content || '';
          yield message;
        } else if (message.type === 'done') {
          yield message;
          break;
        } else if (message.type !== 'error') {
          // Forward other messages (tool_use, tool_result, etc.)
          yield message;
        }

        // Check if we already have a plan
        if (!hasPlan && fullResponse.length > 100) {
          const parsed = parsePlanningResponse(fullResponse);
          if (parsed?.type === 'plan') {
            hasPlan = true;
            this.storePlan(parsed.plan);
            yield { type: 'plan', plan: parsed.plan };
          } else if (parsed?.type === 'direct_answer') {
            yield {
              type: 'direct_answer',
              content: parsed.answer,
            };
            break;
          }
        }
      }

      // Final attempt to parse plan if not found during streaming
      if (!hasPlan && fullResponse.length > 0) {
        const plan = parsePlanFromResponse(fullResponse);
        if (plan) {
          this.storePlan(plan);
          yield { type: 'plan', plan };
        }
      }
    } catch (error) {
      logger.error(`[OpenClaw ${session.id}] Planning error:`, error);
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.sessions.delete(session.id);
    }
  }

  /**
   * Execute an approved plan
   *
   * @param options - Execute options
   * @yields AgentMessage instances
   */
  async *execute(options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing');
    yield { type: 'session', sessionId: session.id };

    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      yield {
        type: 'error',
        message: `Plan not found: ${options.planId}`,
      };
      yield { type: 'done' };
      return;
    }

    logger.debug(`[OpenClaw ${session.id}] Executing plan: ${plan.id}`);

    try {
      const { sessionKey } = await this.resolveOrCreateSession();

      const executionPrompt = formatPlanForExecution(
        plan,
        options.cwd || this.config.workDir,
        options?.sandbox
          ? {
              enabled: true,
              image: options?.sandbox?.image,
              apiEndpoint: options?.sandbox?.apiEndpoint,
            }
          : undefined
      );

      const finalPrompt = `${executionPrompt}\n\nOriginal request: ${options.originalPrompt}`;

      await this.gateway.chatSend({
        sessionKey,
        message: finalPrompt,
        thinking: 'high',
        timeoutMs: 300000, // 5 minutes for execution
        idempotencyKey: session.id,
      });

      yield* pollStreamingResponse(this.gateway, sessionKey);
    } catch (error) {
      logger.error(`[OpenClaw ${session.id}] Execution error:`, error);
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.deletePlan(options.planId);
      this.sessions.delete(session.id);
    }
  }

  /**
   * Stop execution for a session
   *
   * @param sessionId - Session ID to stop
   */
  async stop(sessionId: string): Promise<void> {
    await super.stop(sessionId);
    // Note: We don't close the gateway connection here
    // as it may be shared across sessions
  }

  /**
   * Shutdown the agent and cleanup resources
   */
  async shutdown(): Promise<void> {
    await super.shutdown();
    // Note: Short connection mode means no persistent connection to close
    this.currentSessionKey = null;
    this.currentFriendlyId = null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Resolve an existing session or create a new one
   *
   * @param sessionId - Optional session ID to resolve
   * @returns Session key and friendly ID
   */
  private async resolveOrCreateSession(sessionId?: string): Promise<{
    sessionKey: string;
    friendlyId: string;
  }> {
    // If we have an active session, reuse it
    if (this.currentSessionKey && this.currentFriendlyId) {
      return {
        sessionKey: this.currentSessionKey,
        friendlyId: this.currentFriendlyId,
      };
    }

    // If sessionId is provided, try to resolve it
    if (sessionId) {
      try {
        const result = await this.gateway.sessionsResolve({
          key: sessionId,
          includeUnknown: true,
          includeGlobal: true,
        });

        if (result.ok && result.key) {
          this.currentSessionKey = result.key;
          this.currentFriendlyId = sessionId;
          return {
            sessionKey: result.key,
            friendlyId: sessionId,
          };
        }
      } catch {
        logger.debug('[OpenClawAgent] Session resolve failed, creating new');
      }
    }

    // Create a new session with a generated friendly ID
    const friendlyId = `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      // Create session via sessions.patch
      const result = await this.gateway.sessionsPatch({
        key: friendlyId,
      });

      if (result.ok && result.key) {
        this.currentSessionKey = result.key;
        this.currentFriendlyId = friendlyId;
        logger.debug(
          `[OpenClawAgent] Created new session: ${friendlyId} -> ${result.key}`
        );
        return {
          sessionKey: result.key,
          friendlyId,
        };
      }
    } catch (error) {
      logger.debug('[OpenClawAgent] Session creation via patch failed:', error);
    }

    // Fallback: use the friendly ID as the session key
    this.currentSessionKey = friendlyId;
    this.currentFriendlyId = friendlyId;
    return {
      sessionKey: friendlyId,
      friendlyId,
    };
  }

  /**
   * Build user message with optional image attachments
   *
   * @param text - Message text
   * @param images - Optional image attachments
   * @returns Message object with text and attachments
   */
  private async buildUserMessage(
    text: string,
    images?: ImageAttachment[]
  ): Promise<{ text: string; attachments?: Array<{ mimeType: string; content: string }> }> {
    if (!images || images.length === 0) {
      return { text };
    }

    // Convert images to attachment format
    const attachments = images.map((img) => ({
      mimeType: img.mimeType,
      content: img.data, // Already base64 encoded
    }));

    return { text, attachments };
  }

  /**
   * Get the current session key for the active gateway session
   *
   * The session key is the internal identifier used by the OpenClaw Gateway
   * for routing messages to the correct session.
   *
   * @returns The session key or null if no session is active
   */
  getCurrentSessionKey(): string | null {
    return this.currentSessionKey;
  }

  /**
   * Get the current friendly ID for the active gateway session
   *
   * The friendly ID is the user-facing identifier that can be used in URLs
   * and for session identification. It maps to a session key via sessions.resolve.
   *
   * @returns The friendly ID or null if no session is active
   */
  getCurrentFriendlyId(): string | null {
    return this.currentFriendlyId;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an OpenClaw agent instance
 *
 * @param config - Agent configuration
 * @returns OpenClawAgent instance
 */
export function createOpenClawAgent(config: AgentConfig): OpenClawAgent {
  return new OpenClawAgent(config);
}

// ============================================================================
// Plugin Definition
// ============================================================================

/**
 * OpenClaw agent plugin
 */
export const openclawPlugin: AgentPlugin = defineAgentPlugin({
  metadata: OPENCLAW_METADATA,
  factory: (config) => createOpenClawAgent(config),
});
