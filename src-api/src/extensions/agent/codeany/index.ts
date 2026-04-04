/**
 * CodeAny Agent SDK Adapter
 *
 * Implementation of the IAgent interface using @codeany/open-agent-sdk.
 * Runs entirely in-process — no external CLI binary required.
 */

import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { homedir, platform } from 'os';
import { join } from 'path';
import {
  query,
} from '@codeany/open-agent-sdk';
import type { AgentOptions as SdkAgentOptions } from '@codeany/open-agent-sdk';

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
import { CODEANY_METADATA, defineAgentPlugin } from '@/core/agent/plugin';
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

const logger = createLogger('CodeAnyAgent');

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
      logger.info(`[CodeAny] Saved image to: ${filePath}`);
    } catch (error) {
      logger.error(`[CodeAny] Failed to save image: ${error}`);
    }
  }

  return savedPaths;
}

// ============================================================================
// Default tools
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

// ============================================================================
// CodeAny Agent class
// ============================================================================

export class CodeAnyAgent extends BaseAgent {
  readonly provider: AgentProvider = 'codeany';

  constructor(config: AgentConfig) {
    super(config);
    logger.info('[CodeAnyAgent] Created with config:', {
      provider: config.provider,
      hasApiKey: !!config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      workDir: config.workDir,
    });
  }

  private isUsingCustomApi(): boolean {
    return !!(this.config.baseUrl && this.config.apiKey);
  }

  private buildSdkOptions(
    sessionCwd: string,
    options?: AgentOptions,
    extraOpts?: Partial<SdkAgentOptions>
  ): SdkAgentOptions {
    const sdkOpts: SdkAgentOptions = {
      cwd: sessionCwd,
      model: this.config.model,
      permissionMode: 'bypassPermissions',
      maxTurns: 200,
      thinking: { type: 'adaptive' },
      ...extraOpts,
    };

    // Set API type
    if (this.config.apiType) {
      (sdkOpts as any).apiType = this.config.apiType;
    }

    // Set API credentials
    if (this.config.apiKey) {
      sdkOpts.apiKey = this.config.apiKey;
    }
    if (this.config.baseUrl) {
      sdkOpts.baseURL = this.config.baseUrl;
    }

    // Set allowed tools
    sdkOpts.allowedTools = options?.allowedTools || ALLOWED_TOOLS;

    // Set abort controller
    if (options?.abortController) {
      sdkOpts.abortController = options.abortController;
    }

    return sdkOpts;
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
      result?: { tool_use_id?: string; tool_name?: string; output?: string };
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

    if (msg.type === 'tool_result' && msg.result) {
      yield {
        type: 'tool_result',
        toolUseId: msg.result.tool_use_id ?? '',
        output: msg.result.output ?? '',
        isError: false,
      };
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
    logger.info(`[CodeAny ${session.id}] Working Directory: ${sessionCwd}`);

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

    const sdkOpts = this.buildSdkOptions(sessionCwd, options, {
      abortController: options?.abortController || session.abortController,
    });

    // Add MCP servers if any
    if (Object.keys(userMcpServers).length > 0) {
      sdkOpts.mcpServers = userMcpServers;
      logger.info(`[CodeAny ${session.id}] MCP servers: ${Object.keys(userMcpServers).join(', ')}`);
    }

    logger.info(`[CodeAny ${session.id}] ========== AGENT START ==========`);
    logger.info(`[CodeAny ${session.id}] Model: ${this.config.model || '(default)'}`);
    logger.info(`[CodeAny ${session.id}] Custom API: ${this.isUsingCustomApi()}`);
    logger.info(`[CodeAny ${session.id}] Prompt length: ${enhancedPrompt.length} chars`);

    try {
      for await (const message of query({ prompt: enhancedPrompt, options: sdkOpts })) {
        if (session.abortController.signal.aborted) break;
        yield* this.processMessage(message, session.id, sentTextHashes, sentToolIds);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[CodeAny ${session.id}] Error:`, { message: errorMessage });

      const noApiKeyConfigured = !this.config.apiKey;
      const usingCustomApi = this.isUsingCustomApi();

      const isApiKeyError =
        errorMessage.includes('Invalid API key') || errorMessage.includes('invalid_api_key') ||
        errorMessage.includes('API key') || errorMessage.includes('authentication') ||
        errorMessage.includes('Unauthorized') || errorMessage.includes('401') ||
        errorMessage.includes('403') || noApiKeyConfigured;

      const isApiCompatibilityError = usingCustomApi && (
        errorMessage.includes('model') || errorMessage.includes('not found')
      );

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
    logger.info(`[CodeAny ${session.id}] Planning started, cwd: ${sessionCwd}`);

    const workspaceInstruction = `\n## CRITICAL: Output Directory\n**ALL files must be saved to: ${sessionCwd}**\n`;
    const languageInstruction = buildLanguageInstruction(options?.language, prompt);
    const planningPrompt = workspaceInstruction + PLANNING_INSTRUCTION + languageInstruction + prompt;

    let fullResponse = '';

    const sdkOpts = this.buildSdkOptions(sessionCwd, options, {
      allowedTools: [],
      abortController: options?.abortController || session.abortController,
    });

    try {
      for await (const message of query({ prompt: planningPrompt, options: sdkOpts })) {
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
      logger.error(`[CodeAny ${session.id}] Planning error:`, error);
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
    logger.info(`[CodeAny ${session.id}] Executing plan: ${plan.id}, cwd: ${sessionCwd}`);

    const sandboxOpts: SandboxOptions | undefined = options.sandbox?.enabled
      ? { enabled: true, image: options.sandbox.image, apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL }
      : undefined;

    const executionPrompt =
      formatPlanForExecution(plan, sessionCwd, sandboxOpts, options.language, options.originalPrompt) +
      '\n\nOriginal request: ' + options.originalPrompt;

    const sentTextHashes = new Set<string>();
    const sentToolIds = new Set<string>();

    const userMcpServers = await loadMcpServers(options.mcpConfig as McpConfig | undefined);

    const sdkOpts = this.buildSdkOptions(sessionCwd, options, {
      abortController: options.abortController || session.abortController,
    });

    if (Object.keys(userMcpServers).length > 0) {
      sdkOpts.mcpServers = userMcpServers;
    }

    try {
      for await (const message of query({ prompt: executionPrompt, options: sdkOpts })) {
        if (session.abortController.signal.aborted) break;
        yield* this.processMessage(message, session.id, sentTextHashes, sentToolIds);
      }
    } catch (error) {
      logger.error(`[CodeAny ${session.id}] Execution error:`, error);
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

export function createCodeAnyAgent(config: AgentConfig): CodeAnyAgent {
  return new CodeAnyAgent(config);
}

export const codeanyPlugin: AgentPlugin = defineAgentPlugin({
  metadata: CODEANY_METADATA,
  factory: (config) => createCodeAnyAgent(config),
});
