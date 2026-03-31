/**
 * ShipAny Code Agent SDK Adapter
 *
 * Implementation of the IAgent interface using @shipany/open-agent-sdk.
 * This is a drop-in replacement for the Claude Code agent runtime that
 * runs entirely in-process — no external CLI binary required.
 */

import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { homedir, platform } from 'os';
import { join } from 'path';
import {
  query,
} from '@shipany/open-agent-sdk';
import type { Options } from '@shipany/open-agent-sdk';

import {
  BaseAgent,
  buildLanguageInstruction,
  formatPlanForExecution,
  getWorkspaceInstruction,
  parsePlanFromResponse,
  parsePlanningResponse,
  PLANNING_INSTRUCTION,
  type SandboxOptions,
} from '@/core/agent/base';
import { SHIPANY_METADATA, defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentPlugin } from '@/core/agent/plugin';
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ConversationMessage,
  ExecuteOptions,
  ImageAttachment,
  McpConfig,
  PlanOptions,
  SkillsConfig,
} from '@/core/agent/types';
import {
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  DEFAULT_WORK_DIR,
} from '@/config/constants';
import { loadMcpServers, type McpServerConfig } from '@/shared/mcp/loader';
import { createLogger, LOG_FILE_PATH } from '@/shared/utils/logger';

const logger = createLogger('ShipAnyAgent');

// Sandbox API URL
const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
const API_PORT =
  process.env.PORT || (isDev ? '2026' : String(DEFAULT_API_PORT));
const SANDBOX_API_URL =
  process.env.SANDBOX_API_URL || `http://${DEFAULT_API_HOST}:${API_PORT}`;

// ============================================================================
// Helper functions
// ============================================================================

function expandPath(inputPath: string): string {
  let result = inputPath;
  if (result.startsWith('~')) {
    result = join(homedir(), result.slice(1));
  }
  if (platform() === 'win32') {
    result = result.replace(/\//g, '\\');
  }
  return result;
}

function generateFallbackSlug(prompt: string, taskId: string): string {
  let slug = prompt
    .toLowerCase()
    .replace(/[\u4e00-\u9fff]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');

  if (!slug || slug.length < 3) {
    slug = 'task';
  }

  const suffix = taskId.slice(-6);
  return `${slug}-${suffix}`;
}

function getSessionWorkDir(
  workDir: string = DEFAULT_WORK_DIR,
  prompt?: string,
  taskId?: string
): string {
  const expandedPath = expandPath(workDir);

  const hasSessionsPath = expandedPath.includes('/sessions/') || expandedPath.includes('\\sessions\\');
  const endsWithSessions = expandedPath.endsWith('/sessions') || expandedPath.endsWith('\\sessions');
  if (hasSessionsPath && !endsWithSessions) {
    return expandedPath;
  }

  const baseDir = expandedPath;
  const sessionsDir = join(baseDir, 'sessions');

  let folderName: string;
  if (prompt && taskId) {
    folderName = generateFallbackSlug(prompt, taskId);
  } else if (taskId) {
    folderName = taskId;
  } else {
    folderName = `session-${Date.now()}`;
  }

  return join(sessionsDir, folderName);
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    console.error('Failed to create directory:', error);
  }
}

async function saveImagesToDisk(
  images: ImageAttachment[],
  workDir: string
): Promise<string[]> {
  const savedPaths: string[] = [];
  if (images.length === 0) return savedPaths;

  await ensureDir(workDir);

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const ext = image.mimeType.split('/')[1] || 'png';
    const filename = `image_${Date.now()}_${i}.${ext}`;
    const filePath = join(workDir, filename);

    try {
      let base64Data = image.data;
      if (base64Data.includes(',')) {
        base64Data = base64Data.split(',')[1];
      }
      const buffer = Buffer.from(base64Data, 'base64');
      await writeFile(filePath, buffer);
      savedPaths.push(filePath);
      logger.info(`[ShipAny] Saved image to: ${filePath}`);
    } catch (error) {
      logger.error(`[ShipAny] Failed to save image: ${error}`);
    }
  }

  return savedPaths;
}

// ============================================================================
// Default tools and Sandbox MCP server
// ============================================================================

const ALLOWED_TOOLS = [
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

// Note: @shipany/open-agent-sdk runs tools in-process (Bash, Read, Write, etc.)
// Sandbox MCP server is not supported — use the built-in Bash tool for script execution.

// ============================================================================
// ShipAny Agent class
// ============================================================================

export class ShipAnyAgent extends BaseAgent {
  readonly provider: AgentProvider = 'shipany';

  constructor(config: AgentConfig) {
    super(config);
    logger.info('[ShipAnyAgent] Created with config:', {
      provider: config.provider,
      hasApiKey: !!config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      workDir: config.workDir,
    });
  }

  private buildSettingSources(skillsConfig?: SkillsConfig): ('user' | 'project')[] {
    if (skillsConfig && !skillsConfig.enabled) {
      return ['project'];
    }
    return ['user', 'project'];
  }

  private isUsingCustomApi(): boolean {
    return !!(this.config.baseUrl && this.config.apiKey);
  }

  private buildEnvConfig(): Record<string, string> {
    const env: Record<string, string | undefined> = { ...process.env };

    if (this.config.apiKey) {
      env.ANTHROPIC_AUTH_TOKEN = this.config.apiKey;
      delete env.ANTHROPIC_API_KEY;

      if (this.config.baseUrl) {
        env.ANTHROPIC_BASE_URL = this.config.baseUrl;
        logger.info('[ShipAnyAgent] Using custom API:', { baseUrl: this.config.baseUrl });
      } else {
        delete env.ANTHROPIC_BASE_URL;
      }
    }

    if (this.config.model) {
      env.ANTHROPIC_MODEL = this.config.model;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = this.config.model;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = this.config.model;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = this.config.model;
      logger.info('[ShipAnyAgent] Model configured:', this.config.model);
    } else if (this.config.apiKey) {
      delete env.ANTHROPIC_MODEL;
      delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
      delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
      delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;
    }

    if (this.isUsingCustomApi()) {
      env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
      env.CLAUDE_CODE_SKIP_CONFIG = '1';
      env.API_TIMEOUT_MS = '600000';
      env.CLAUDE_CODE_SKIP_MODEL_VALIDATION = '1';
    }

    logger.info('[ShipAnyAgent] Final env config:', {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY === undefined ? '(deleted)' : env.ANTHROPIC_API_KEY ? `${env.ANTHROPIC_API_KEY.slice(0, 10)}...` : 'not set',
      ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN ? `${env.ANTHROPIC_AUTH_TOKEN.slice(0, 10)}...` : 'not set',
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL === undefined ? '(deleted)' : env.ANTHROPIC_BASE_URL || 'not set',
      ANTHROPIC_MODEL: env.ANTHROPIC_MODEL || 'not set',
    });

    const filteredEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) {
        filteredEnv[key] = value;
      }
    }
    return filteredEnv;
  }

  private estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private formatConversationHistory(conversation?: ConversationMessage[]): string {
    if (!conversation || conversation.length === 0) return '';

    const maxHistoryTokens = this.config.providerConfig?.maxHistoryTokens as number || 2000;
    const minMessagesToKeep = 3;

    const allFormattedMessages = conversation.map((msg) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      let messageContent = `${role}: ${msg.content}`;
      if (msg.imagePaths && msg.imagePaths.length > 0) {
        const imageRefs = msg.imagePaths.map((p, i) => `  - Image ${i + 1}: ${p}`).join('\n');
        messageContent += `\n[Attached images:\n${imageRefs}\nUse Read tool to view these images if needed]`;
      }
      return messageContent;
    });

    const messageTokens = allFormattedMessages.map(msg => ({
      content: msg,
      tokens: this.estimateTokenCount(msg)
    }));

    let totalTokens = 0;
    const selectedMessages: string[] = [];
    const startIndex = Math.max(0, messageTokens.length - minMessagesToKeep);

    for (let i = messageTokens.length - 1; i >= startIndex; i--) {
      const message = messageTokens[i];
      if (totalTokens + message.tokens <= maxHistoryTokens) {
        selectedMessages.unshift(message.content);
        totalTokens += message.tokens;
      } else {
        break;
      }
    }

    for (let i = startIndex - 1; i >= 0; i--) {
      const message = messageTokens[i];
      if (totalTokens + message.tokens <= maxHistoryTokens) {
        selectedMessages.unshift(message.content);
        totalTokens += message.tokens;
      } else {
        break;
      }
    }

    if (selectedMessages.length === 0) return '';

    const formattedMessages = selectedMessages.join('\n\n');
    const truncationNotice = conversation.length > selectedMessages.length
      ? `\n\n[Note: Showing ${selectedMessages.length} of ${conversation.length} messages.]`
      : '';

    return `## Previous Conversation Context\n\n${formattedMessages}${truncationNotice}\n\n---\n## Current Request\n`;
  }

  private sanitizeText(text: string): string {
    let sanitized = text;

    const apiKeyErrorPatterns = [
      /Invalid API key/i, /invalid_api_key/i, /API key.*invalid/i,
      /authentication.*fail/i, /Unauthorized/i,
      /身份验证失败/, /认证失败/, /鉴权失败/, /密钥无效/,
    ];

    if (apiKeyErrorPatterns.some((p) => p.test(sanitized))) {
      return '__API_KEY_ERROR__';
    }

    sanitized = sanitized.replace(/Claude Code process exited with code \d+/gi, '__AGENT_PROCESS_ERROR__');
    sanitized = sanitized.replace(/\s*[·•\-–—]\s*Please run \/login\.?/gi, '');
    sanitized = sanitized.replace(/Please run \/login\.?/gi, '');

    return sanitized;
  }

  private *processMessage(
    message: unknown,
    sessionId: string,
    sentTextHashes: Set<string>,
    sentToolIds: Set<string>
  ): Generator<AgentMessage> {
    const msg = message as {
      type: string;
      message?: { content?: unknown[] };
      subtype?: string;
      total_cost_usd?: number;
      duration_ms?: number;
    };

    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content as Record<string, unknown>[]) {
        if ('text' in block) {
          const sanitizedText = this.sanitizeText(block.text as string);
          const textHash = sanitizedText.slice(0, 100);
          if (!sentTextHashes.has(textHash)) {
            sentTextHashes.add(textHash);
            yield { type: 'text', content: sanitizedText };
          }
        } else if ('name' in block && 'id' in block) {
          const toolId = block.id as string;
          if (!sentToolIds.has(toolId)) {
            sentToolIds.add(toolId);
            yield { type: 'tool_use', id: toolId, name: block.name as string, input: block.input };
          }
        }
      }
    }

    if (msg.type === 'user' && msg.message?.content) {
      for (const block of msg.message.content as Record<string, unknown>[]) {
        if ('type' in block && block.type === 'tool_result') {
          const toolUseId = (block as any).tool_use_id ?? (block as any).toolUseId;
          const rawIsError = (block as any).is_error ?? (block as any).isError;
          const isError = typeof rawIsError === 'boolean' ? rawIsError : false;
          yield {
            type: 'tool_result',
            toolUseId: (toolUseId ?? '') as string,
            output: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
            isError,
          };
        }
      }
    }

    if (msg.type === 'result') {
      yield {
        type: 'result', content: msg.subtype,
        cost: msg.total_cost_usd, duration: msg.duration_ms,
      };
    }
  }

  // ==========================================================================
  // Core agent methods
  // ==========================================================================

  async *run(prompt: string, options?: AgentOptions): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing', {
      id: options?.sessionId,
      abortController: options?.abortController,
    });
    yield { type: 'session', sessionId: session.id };

    const sessionCwd = getSessionWorkDir(
      options?.cwd || this.config.workDir, prompt, options?.taskId
    );
    await ensureDir(sessionCwd);
    logger.info(`[ShipAny ${session.id}] Working Directory: ${sessionCwd}`);

    const sentTextHashes = new Set<string>();
    const sentToolIds = new Set<string>();

    const sandboxOpts: SandboxOptions | undefined = options?.sandbox?.enabled
      ? { enabled: true, image: options.sandbox.image, apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL }
      : undefined;

    // Handle image attachments
    let imageInstruction = '';
    if (options?.images && options.images.length > 0) {
      const imagePaths = await saveImagesToDisk(options.images, sessionCwd);
      if (imagePaths.length > 0) {
        imageInstruction = `
## MANDATORY IMAGE ANALYSIS - DO THIS FIRST

The user has attached ${imagePaths.length} image file(s):
${imagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}

**YOUR FIRST ACTION MUST BE:** Use the Read tool to view each image file listed above.

**CRITICAL:** DO NOT respond until you have READ and SEEN the actual image content.

---
User's request (answer this AFTER reading the images):
`;
      }
    }

    const conversationContext = this.formatConversationHistory(options?.conversation);
    const languageInstruction = buildLanguageInstruction(options?.language, prompt);

    const enhancedPrompt = imageInstruction
      ? imageInstruction + languageInstruction + prompt + '\n\n' + getWorkspaceInstruction(sessionCwd, sandboxOpts) + conversationContext
      : getWorkspaceInstruction(sessionCwd, sandboxOpts) + conversationContext + languageInstruction + prompt;

    // Load MCP servers
    const userMcpServers = await loadMcpServers(options?.mcpConfig as McpConfig | undefined);

    const settingSources = this.buildSettingSources(options?.skillsConfig);

    const queryOptions: Options = {
      cwd: sessionCwd,
      tools: { type: 'preset', preset: 'claude_code' },
      allowedTools: options?.allowedTools || ALLOWED_TOOLS,
      settingSources,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      abortController: options?.abortController || session.abortController,
      env: this.buildEnvConfig(),
      model: this.config.model,
      // No pathToClaudeCodeExecutable needed — open-agent-sdk runs in-process
      maxTurns: 200,
      thinking: { type: 'adaptive' },
      stderr: (data: string) => {
        logger.error(`[ShipAny ${session.id}] STDERR: ${data}`);
      },
    };

    // Initialize MCP servers
    // Note: sandbox MCP tools not supported in open-agent-sdk — use built-in Bash tool
    if (Object.keys(userMcpServers).length > 0) {
      queryOptions.mcpServers = userMcpServers;
      logger.info(`[ShipAny ${session.id}] MCP servers: ${Object.keys(userMcpServers).join(', ')}`);
    }

    logger.info(`[ShipAny ${session.id}] ========== AGENT START ==========`);
    logger.info(`[ShipAny ${session.id}] Model: ${this.config.model || '(default)'}`);
    logger.info(`[ShipAny ${session.id}] Custom API: ${this.isUsingCustomApi()}`);
    logger.info(`[ShipAny ${session.id}] Prompt length: ${enhancedPrompt.length} chars`);

    try {
      for await (const message of query({ prompt: enhancedPrompt, options: queryOptions })) {
        if (session.abortController.signal.aborted) break;
        yield* this.processMessage(message, session.id, sentTextHashes, sentToolIds);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[ShipAny ${session.id}] Error:`, { message: errorMessage });

      const noApiKeyConfigured = !this.config.apiKey && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN;
      const processExitError = errorMessage.includes('exited with code');
      const usingCustomApi = this.isUsingCustomApi();

      const isApiKeyError =
        errorMessage.includes('Invalid API key') || errorMessage.includes('invalid_api_key') ||
        errorMessage.includes('API key') || errorMessage.includes('authentication') ||
        errorMessage.includes('Unauthorized') || errorMessage.includes('401') ||
        errorMessage.includes('403') || (noApiKeyConfigured && processExitError);

      const isApiCompatibilityError = usingCustomApi && processExitError;

      if (isApiKeyError) {
        yield { type: 'error', message: '__API_KEY_ERROR__' };
      } else if (isApiCompatibilityError) {
        yield { type: 'error', message: `__CUSTOM_API_ERROR__|${this.config.baseUrl}|${LOG_FILE_PATH}` };
      } else {
        yield { type: 'error', message: `__INTERNAL_ERROR__|${LOG_FILE_PATH}` };
      }
    } finally {
      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }

  async *plan(prompt: string, options?: PlanOptions): AsyncGenerator<AgentMessage> {
    const session = this.createSession('planning', {
      id: options?.sessionId,
      abortController: options?.abortController,
    });
    yield { type: 'session', sessionId: session.id };

    const sessionCwd = getSessionWorkDir(
      options?.cwd || this.config.workDir, prompt, options?.taskId
    );
    await ensureDir(sessionCwd);
    logger.info(`[ShipAny ${session.id}] Planning started, cwd: ${sessionCwd}`);

    const workspaceInstruction = `\n## CRITICAL: Output Directory\n**ALL files must be saved to: ${sessionCwd}**\n`;
    const languageInstruction = buildLanguageInstruction(options?.language, prompt);
    const planningPrompt = workspaceInstruction + PLANNING_INSTRUCTION + languageInstruction + prompt;

    let fullResponse = '';

    const queryOptions: Options = {
      cwd: sessionCwd,
      settingSources: ['user', 'project'],
      allowedTools: [],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      abortController: options?.abortController || session.abortController,
      env: this.buildEnvConfig(),
      model: this.config.model,
      thinking: { type: 'adaptive' },
    };

    try {
      for await (const message of query({ prompt: planningPrompt, options: queryOptions })) {
        if (session.abortController.signal.aborted) break;

        if ((message as any).type === 'assistant' && (message as any).message?.content) {
          for (const block of (message as any).message.content) {
            if ('text' in block) {
              fullResponse += block.text;
              yield { type: 'text', content: block.text };
            }
          }
        }
      }

      const planningResult = parsePlanningResponse(fullResponse);

      if (planningResult?.type === 'direct_answer') {
        yield { type: 'direct_answer', content: planningResult.answer };
      } else if (planningResult?.type === 'plan' && planningResult.plan.steps.length > 0) {
        this.storePlan(planningResult.plan);
        yield { type: 'plan', plan: planningResult.plan };
      } else {
        const plan = parsePlanFromResponse(fullResponse);
        if (plan && plan.steps.length > 0) {
          this.storePlan(plan);
          yield { type: 'plan', plan };
        } else {
          yield { type: 'direct_answer', content: fullResponse.trim() };
        }
      }
    } catch (error) {
      logger.error(`[ShipAny ${session.id}] Planning error:`, error);
      yield { type: 'error', message: error instanceof Error ? error.message : String(error) };
    } finally {
      yield { type: 'done' };
    }
  }

  async *execute(options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing', {
      id: options.sessionId,
      abortController: options.abortController,
    });
    yield { type: 'session', sessionId: session.id };

    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      yield { type: 'error', message: `Plan not found: ${options.planId}` };
      yield { type: 'done' };
      return;
    }

    const sessionCwd = getSessionWorkDir(
      options.cwd || this.config.workDir, options.originalPrompt, options.taskId
    );
    await ensureDir(sessionCwd);
    logger.info(`[ShipAny ${session.id}] Executing plan: ${plan.id}, cwd: ${sessionCwd}`);

    const sandboxOpts: SandboxOptions | undefined = options.sandbox?.enabled
      ? { enabled: true, image: options.sandbox.image, apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL }
      : undefined;

    const executionPrompt =
      formatPlanForExecution(plan, sessionCwd, sandboxOpts, options.language, options.originalPrompt) +
      '\n\nOriginal request: ' + options.originalPrompt;

    const sentTextHashes = new Set<string>();
    const sentToolIds = new Set<string>();

    const userMcpServers = await loadMcpServers(options.mcpConfig as McpConfig | undefined);
    const execSettingSources = this.buildSettingSources(options.skillsConfig);

    const queryOptions: Options = {
      cwd: sessionCwd,
      tools: { type: 'preset', preset: 'claude_code' },
      allowedTools: options.allowedTools || ALLOWED_TOOLS,
      settingSources: execSettingSources,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      abortController: options.abortController || session.abortController,
      env: this.buildEnvConfig(),
      model: this.config.model,
      maxTurns: 200,
      thinking: { type: 'adaptive' },
      stderr: (data: string) => {
        logger.error(`[ShipAny ${session.id}] STDERR: ${data}`);
      },
    };

    if (Object.keys(userMcpServers).length > 0) {
      queryOptions.mcpServers = userMcpServers;
    }

    try {
      for await (const message of query({ prompt: executionPrompt, options: queryOptions })) {
        if (session.abortController.signal.aborted) break;
        yield* this.processMessage(message, session.id, sentTextHashes, sentToolIds);
      }
    } catch (error) {
      logger.error(`[ShipAny ${session.id}] Execution error:`, error);
      yield { type: 'error', message: error instanceof Error ? error.message : String(error) };
    } finally {
      this.deletePlan(options.planId);
      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }
}

// ============================================================================
// Factory & Plugin
// ============================================================================

export function createShipAnyAgent(config: AgentConfig): ShipAnyAgent {
  return new ShipAnyAgent(config);
}

export const shipanyPlugin: AgentPlugin = defineAgentPlugin({
  metadata: SHIPANY_METADATA,
  factory: (config) => createShipAnyAgent(config),
});
