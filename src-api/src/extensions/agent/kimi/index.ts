/**
 * Kimi CLI Agent Implementation
 *
 * Implementation of the IAgent interface using kimi-cli
 * Supports streaming responses, planning, and tool execution
 */

import { spawn } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import { homedir, platform } from 'os';
import { join } from 'path';

import {
  BaseAgent,
  formatPlanForExecution,
  getWorkspaceInstruction,
  parsePlanFromResponse,
  parsePlanningResponse,
  PLANNING_INSTRUCTION,
  type SandboxOptions,
} from '@/core/agent/base';
import { KIMI_METADATA, defineAgentPlugin } from '@/core/agent/plugin';
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

import { ensureKimiCli, getKimiCliPath, isPackagedApp } from './utils';

const logger = createLogger('KimiAgent');

// API port configuration
const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
const API_PORT =
  process.env.PORT || (isDev ? '2026' : String(DEFAULT_API_PORT));
const SANDBOX_API_URL =
  process.env.SANDBOX_API_URL || `http://${DEFAULT_API_HOST}:${API_PORT}`;

/**
 * Expand ~ to home directory and normalize path separators
 */
function expandPath(inputPath: string): string {
  let result = inputPath;

  // Expand ~ to home directory
  if (result.startsWith('~')) {
    result = join(homedir(), result.slice(1));
  }

  // Normalize path separators for current platform
  if (platform() === 'win32') {
    result = result.replace(/\//g, '\\');
  }

  return result;
}

/**
 * Generate a fallback slug from prompt for session directory name
 */
function generateFallbackSlug(prompt: string, taskId: string): string {
  let slug = prompt
    .toLowerCase()
    // Remove Chinese and keep only alphanumeric
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

/**
 * Get or create session working directory
 */
function getSessionWorkDir(
  workDir: string = DEFAULT_WORK_DIR,
  prompt?: string,
  taskId?: string
): string {
  logger.info('[Kimi] getSessionWorkDir called with:', {
    workDir,
    prompt: prompt?.slice(0, 50),
    taskId,
  });

  const expandedPath = expandPath(workDir);
  logger.info('[Kimi] Expanded path:', expandedPath);

  // Check if the workDir is already a session folder path from frontend
  const hasSessionsPath = expandedPath.includes('/sessions/') || expandedPath.includes('\\sessions\\');
  const endsWithSessions = expandedPath.endsWith('/sessions') || expandedPath.endsWith('\\sessions');
  if (hasSessionsPath && !endsWithSessions) {
    // Frontend already provided a proper session path, use it directly
    logger.info('[Kimi] Using frontend-provided session path:', expandedPath);
    return expandedPath;
  }

  // No session path provided, generate one (fallback for backward compatibility)
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

  const targetDir = join(sessionsDir, folderName);
  return targetDir;
}

/**
 * Ensure a directory exists, creating it if necessary
 */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    logger.error('Failed to create directory:', error);
  }
}

/**
 * Save images to disk and return file paths
 */
async function saveImagesToDisk(
  images: ImageAttachment[],
  workDir: string
): Promise<string[]> {
  const savedPaths: string[] = [];

  if (images.length === 0) {
    return savedPaths;
  }

  // Only create directory when we actually have images to save
  await ensureDir(workDir);

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const ext = image.mimeType.split('/')[1] || 'png';
    const filename = `image_${Date.now()}_${i}.${ext}`;
    const filePath = join(workDir, filename);

    try {
      // Remove data URL prefix if present
      let base64Data = image.data;
      if (base64Data.includes(',')) {
        base64Data = base64Data.split(',')[1];
      }

      const buffer = Buffer.from(base64Data, 'base64');
      await writeFile(filePath, buffer);
      savedPaths.push(filePath);
      logger.info(`[Kimi] Saved image to: ${filePath}`);
    } catch (error) {
      logger.error(`[Kimi] Failed to save image: ${error}`);
    }
  }

  return savedPaths;
}

/**
 * Default allowed tools for execution
 */
const ALLOWED_TOOLS = [
  'ReadFile',
  'WriteFile',
  'Shell',
  'WebSearch',
  'WebFetch',
];

/**
 * Kimi Agent implementation
 */
export class KimiAgent extends BaseAgent {
  readonly provider: AgentProvider = 'kimi';

  constructor(config: AgentConfig) {
    super(config);
    logger.info('[KimiAgent] Created with config:', {
      provider: config.provider,
      hasApiKey: !!config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      workDir: config.workDir,
    });
  }

  /**
   * Check if using custom API configuration
   */
  private isUsingCustomApi(): boolean {
    return !!(this.config.baseUrl && this.config.apiKey);
  }

  /**
   * Build environment variables for Kimi CLI execution
   */
  private buildKimiEnvConfig(): Record<string, string> {
    const env: Record<string, string | undefined> = { ...process.env };

    // Set Kimi-specific environment variables
    if (this.config.apiKey) {
      env.MOONSHOT_API_KEY = this.config.apiKey;
      logger.info('[KimiAgent] Using custom API key');
    }

    if (this.config.baseUrl) {
      env.MOONSHOT_API_BASE = this.config.baseUrl;
      logger.info('[KimiAgent] Using custom API base URL:', this.config.baseUrl);
    }

    if (this.config.model) {
      env.KIMI_MODEL = this.config.model;
      logger.info('[KimiAgent] Model configured:', this.config.model);
    }

    // Filter out undefined values
    const filteredEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) {
        filteredEnv[key] = value;
      }
    }
    return filteredEnv;
  }

  /**
   * Estimate token count for conversation history
   */
  private estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Format conversation history for inclusion in prompt
   */
  private formatConversationHistory(
    conversation?: ConversationMessage[]
  ): string {
    if (!conversation || conversation.length === 0) {
      return '';
    }

    const maxHistoryTokens = this.config.providerConfig?.maxHistoryTokens as number || 2000;
    const minMessagesToKeep = 3;

    const allFormattedMessages = conversation.map((msg) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      let messageContent = `${role}: ${msg.content}`;

      if (msg.imagePaths && msg.imagePaths.length > 0) {
        const imageRefs = msg.imagePaths
          .map((p, i) => `  - Image ${i + 1}: ${p}`)
          .join('\n');
        messageContent += `\n[Attached images in this message:\n${imageRefs}\nUse ReadFile tool to view these images if needed]`;
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

    if (selectedMessages.length === 0) {
      return '';
    }

    const formattedMessages = selectedMessages.join('\n\n');
    const truncationNotice = conversation.length > selectedMessages.length
      ? `\n\n[Note: Conversation history truncated. Showing ${selectedMessages.length} of ${conversation.length} messages to stay within token limits.]`
      : '';

    logger.info(`[formatConversationHistory] Selected ${selectedMessages.length} of ${conversation.length} messages, estimated ${totalTokens} tokens (limit: ${maxHistoryTokens})`);

    return `## Previous Conversation Context
The following is the conversation history. Use this context to understand and respond to the current message appropriately.

${formattedMessages}${truncationNotice}\n\n---\n## Current Request\n`;
  }

  /**
   * Execute Kimi CLI command and parse streaming JSON output
   */
  private async *executeKimiCommand(
    prompt: string,
    workDir: string,
    sessionId: string
  ): AsyncGenerator<AgentMessage> {
    const kimiCliPath = await ensureKimiCli();
    if (!kimiCliPath) {
      yield {
        type: 'error',
        message: '__KIMI_CLI_NOT_FOUND__',
      };
      return;
    }

    const env = this.buildKimiEnvConfig();

    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--work-dir', workDir,
      '--prompt', prompt,
    ];

    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    logger.info(`[Kimi ${sessionId}] Executing: ${kimiCliPath} ${args.join(' ')}`);

    const kimiProcess = spawn(kimiCliPath, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: workDir,
    });

    let buffer = '';
    const sentTextHashes = new Set<string>();
    const sentToolIds = new Set<string>();
    const messageQueue: AgentMessage[] = [];

    kimiProcess.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line.trim());
            // Process message and add to queue
            for (const agentMessage of this.processKimiMessage(message, sessionId, sentTextHashes, sentToolIds)) {
              messageQueue.push(agentMessage);
            }
          } catch (parseError) {
            logger.warn(`[Kimi ${sessionId}] Failed to parse JSON: ${line}`);
          }
        }
      }
    });

    kimiProcess.stderr?.on('data', (data: Buffer) => {
      logger.error(`[Kimi ${sessionId}] STDERR: ${data.toString()}`);
    });

    // Track process completion
    let processCompleted = false;
    const processPromise = new Promise<void>((resolve, reject) => {
      kimiProcess.on('close', (code: number) => {
        processCompleted = true;
        if (code === 0) {
          logger.info(`[Kimi ${sessionId}] Process completed successfully`);
          resolve();
        } else {
          logger.error(`[Kimi ${sessionId}] Process exited with code: ${code}`);
          reject(new Error(`Kimi CLI process exited with code ${code}`));
        }
      });

      kimiProcess.on('error', (processError: Error) => {
        processCompleted = true;
        logger.error(`[Kimi ${sessionId}] Process error: ${processError}`);
        reject(processError);
      });
    });

    // Yield messages as they arrive
    while (!processCompleted) {
      await new Promise(resolve => setTimeout(resolve, 100));
      while (messageQueue.length > 0) {
        const message = messageQueue.shift();
        if (message) {
          yield message;
        }
      }
    }

    // Wait for process to complete and handle errors
    await processPromise;

    // Yield any remaining messages
    while (messageQueue.length > 0) {
      const message = messageQueue.shift();
      if (message) {
        yield message;
      }
    }
  }

  /**
   * Process Kimi CLI messages and convert to AgentMessage format
   */
  private *processKimiMessage(
    message: any,
    sessionId: string,
    sentTextHashes: Set<string>,
    sentToolIds: Set<string>
  ): Generator<AgentMessage> {
    if (message.role === 'assistant') {
      if (message.content) {
        for (const block of message.content) {
          if (block.type === 'text') {
            const textHash = block.text.slice(0, 100);
            if (!sentTextHashes.has(textHash)) {
              sentTextHashes.add(textHash);
              logger.info(`[Kimi ${sessionId}] Text: ${block.text.slice(0, 50)}...`);
              yield { type: 'text', content: block.text };
            }
          }
        }
      }

      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.type === 'function') {
            const toolId = toolCall.id;
            if (!sentToolIds.has(toolId)) {
              sentToolIds.add(toolId);
              logger.info(`[Kimi ${sessionId}] Tool: ${toolCall.function.name}`);
              yield {
                type: 'tool_use',
                id: toolId,
                name: toolCall.function.name,
                input: JSON.parse(toolCall.function.arguments || '{}'),
              };
            }
          }
        }
      }
    }

    if (message.role === 'tool') {
      logger.info(`[Kimi ${sessionId}] Tool result for: ${message.tool_call_id}`);
      yield {
        type: 'tool_result',
        toolUseId: message.tool_call_id,
        output: Array.isArray(message.content)
          ? message.content.map((c: any) => c.text || '').join('\n')
          : message.content,
        isError: false,
      };
    }
  }

  /**
   * Direct execution mode (without planning)
   */
  async *run(
    prompt: string,
    options?: AgentOptions
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing');
    yield { type: 'session', sessionId: session.id };

    const sessionCwd = getSessionWorkDir(
      options?.cwd || this.config.workDir,
      prompt,
      options?.taskId
    );

    await ensureDir(sessionCwd);
    logger.info(`[Kimi ${session.id}] Working directory: ${sessionCwd}`);
    logger.info(`[Kimi ${session.id}] Direct execution started`);

    if (options?.conversation && options.conversation.length > 0) {
      logger.info(`[Kimi ${session.id}] Conversation history: ${options.conversation.length} messages`);
    }

    // Handle image attachments
    let imageInstruction = '';
    if (options?.images && options.images.length > 0) {
      logger.info(`[Kimi ${session.id}] Processing ${options.images.length} image(s)`);
      const imagePaths = await saveImagesToDisk(options.images, sessionCwd);
      logger.info(`[Kimi ${session.id}] Saved ${imagePaths.length} images to disk: ${imagePaths.join(', ')}`);

      if (imagePaths.length > 0) {
        imageInstruction = `
## 🖼️ MANDATORY IMAGE ANALYSIS - DO THIS FIRST

**STOP! Before doing anything else, you MUST read the attached image(s).**

The user has attached ${imagePaths.length} image file(s):
${imagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}

**YOUR FIRST ACTION MUST BE:**
Use the ReadFile tool to view each image file listed above.

**CRITICAL RULES:**
- DO NOT respond to the user's question until you have READ and SEEN the actual image content
- DO NOT guess or assume what the image contains
- After reading the image, describe what you actually see in the image
- Base your response ONLY on the actual visual content you observe

---
User's request (answer this AFTER reading the images):
`;
      }
    }

    // Format conversation history
    const conversationContext = this.formatConversationHistory(options?.conversation);

    // Build sandbox options
    const sandboxOpts: SandboxOptions | undefined = options?.sandbox?.enabled
      ? {
          enabled: true,
          image: options.sandbox.image,
          apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL,
        }
      : undefined;

    // Combine prompt with context and instructions
    const enhancedPrompt = imageInstruction
      ? imageInstruction + prompt + '\n\n' + getWorkspaceInstruction(sessionCwd, sandboxOpts) + conversationContext
      : getWorkspaceInstruction(sessionCwd, sandboxOpts) + conversationContext + prompt;

    try {
      yield* this.executeKimiCommand(enhancedPrompt, sessionCwd, session.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[Kimi ${session.id}] Error occurred`, { error: errorMessage });

      const isApiKeyError = errorMessage.includes('API key') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('401') ||
        errorMessage.includes('403');

      if (isApiKeyError) {
        yield { type: 'error', message: '__API_KEY_ERROR__' };
      } else {
        yield { type: 'error', message: `__INTERNAL_ERROR__|${LOG_FILE_PATH}` };
      }
    } finally {
      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }

  /**
   * Planning phase only
   */
  async *plan(
    prompt: string,
    options?: PlanOptions
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('planning');
    yield { type: 'session', sessionId: session.id };

    const sessionCwd = getSessionWorkDir(
      options?.cwd || this.config.workDir,
      prompt,
      options?.taskId
    );

    await ensureDir(sessionCwd);
    logger.info(`[Kimi ${session.id}] Working directory: ${sessionCwd}`);
    logger.info(`[Kimi ${session.id}] Planning phase started`);

    const workspaceInstruction = `
## CRITICAL: Output Directory
**ALL files must be saved to: ${sessionCwd}**
If you need to create any files during planning, use this directory.
`;
    const planningPrompt = workspaceInstruction + PLANNING_INSTRUCTION + prompt;

    let fullResponse = '';

    try {
      const kimiCliPath = await ensureKimiCli();
      if (!kimiCliPath) {
        yield { type: 'error', message: '__KIMI_CLI_NOT_FOUND__' };
        yield { type: 'done' };
        return;
      }

      yield* this.executeKimiCommand(planningPrompt, sessionCwd, session.id);

      // For now, we'll just return the response as a direct answer
      // TODO: Parse planning response when we understand Kimi's output format better
      yield { type: 'direct_answer', content: fullResponse || 'Planning completed. Ready to execute.' };
    } catch (error) {
      logger.error(`[Kimi ${session.id}] Planning error:`, error);
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      yield { type: 'done' };
    }
  }

  /**
   * Execute an approved plan
   */
  async *execute(options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing');
    yield { type: 'session', sessionId: session.id };

    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      logger.error(`[Kimi ${session.id}] Plan not found: ${options.planId}`);
      yield { type: 'error', message: `Plan not found: ${options.planId}` };
      yield { type: 'done' };
      return;
    }

    logger.info(`[Kimi ${session.id}] Using plan: ${plan.id} (${plan.goal})`);

    const sessionCwd = getSessionWorkDir(
      options.cwd || this.config.workDir,
      options.originalPrompt,
      options.taskId
    );

    await ensureDir(sessionCwd);
    logger.info(`[Kimi ${session.id}] Working directory: ${sessionCwd}`);

    const sandboxOpts: SandboxOptions | undefined = options.sandbox?.enabled
      ? {
          enabled: true,
          image: options.sandbox.image,
          apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL,
        }
      : undefined;

    const executionPrompt =
      formatPlanForExecution(plan, sessionCwd, sandboxOpts) +
      '\n\nOriginal request: ' + options.originalPrompt;

    logger.info(`[Kimi ${session.id}] Execution phase started for plan: ${options.planId}`);

    try {
      yield* this.executeKimiCommand(executionPrompt, sessionCwd, session.id);
    } catch (error) {
      logger.error(`[Kimi ${session.id}] Execution error:`, error);
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      logger.info(`[Kimi ${session.id}] Execution done`);
      this.deletePlan(options.planId);
      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }
}

/**
 * Factory function to create Kimi agent
 */
export function createKimiAgent(config: AgentConfig): KimiAgent {
  return new KimiAgent(config);
}

/**
 * Kimi agent plugin definition
 */
export const kimiPlugin: AgentPlugin = defineAgentPlugin({
  metadata: KIMI_METADATA,
  factory: (config) => createKimiAgent(config),
});