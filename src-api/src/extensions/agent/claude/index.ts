/**
 * Claude Agent SDK Adapter
 *
 * Implementation of the IAgent interface using @anthropic-ai/claude-agent-sdk
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { homedir, platform } from 'os';
import { join } from 'path';
import {
  createSdkMcpServer,
  Options,
  query,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  BaseAgent,
  formatPlanForExecution,
  getWorkspaceInstruction,
  parsePlanFromResponse,
  parsePlanningResponse,
  PLANNING_INSTRUCTION,
  type SandboxOptions,
} from '@/core/agent/base';
import { loadMcpServers, type McpServerConfig } from '@/shared/mcp/loader';
// Import plugin definition helpers
import { CLAUDE_METADATA, defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentPlugin } from '@/core/agent/plugin';
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ConversationMessage,
  ExecuteOptions,
  ImageAttachment,
  PlanOptions,
} from '@/core/agent/types';
import {
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  DEFAULT_WORK_DIR,
} from '@/config/constants';

// Sandbox API URL - use the main API's sandbox endpoints
// API port: 2620 for production, 2026 for development
// In dev mode (NODE_ENV not set or 'development'), use 2026
const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
const API_PORT =
  process.env.PORT || (isDev ? '2026' : String(DEFAULT_API_PORT));
const SANDBOX_API_URL =
  process.env.SANDBOX_API_URL || `http://${DEFAULT_API_HOST}:${API_PORT}`;

/**
 * Install Claude Code automatically
 * Returns true if installation was successful
 */
async function installClaudeCode(): Promise<boolean> {
  const os = platform();
  console.log('[Claude] Attempting to install Claude Code...');

  try {
    if (os === 'darwin') {
      // macOS: Try Homebrew first, then npm
      try {
        console.log('[Claude] Installing via Homebrew...');
        execSync('brew install claude-code', {
          encoding: 'utf-8',
          stdio: 'inherit',
        });
        return true;
      } catch {
        console.log('[Claude] Homebrew failed, trying npm...');
      }
    }

    // Fallback: Use npm (works on all platforms)
    console.log('[Claude] Installing via npm...');
    execSync('npm install -g @anthropic-ai/claude-code', {
      encoding: 'utf-8',
      stdio: 'inherit',
    });
    return true;
  } catch (error) {
    console.error('[Claude] Failed to install Claude Code:', error);
    return false;
  }
}

/**
 * Build extended PATH that includes common package manager bin locations
 */
function getExtendedPath(): string {
  const home = homedir();
  const paths = [
    process.env.PATH || '',
    '/usr/local/bin',
    '/opt/homebrew/bin',
    `${home}/.local/bin`,
    `${home}/.npm-global/bin`,
    `${home}/.volta/bin`,
    `${home}/code/node/npm_global/bin`,
  ];

  // Add nvm paths
  const nvmDir = join(home, '.nvm', 'versions', 'node');
  try {
    const { readdirSync } = require('fs');
    if (existsSync(nvmDir)) {
      const versions = readdirSync(nvmDir);
      for (const version of versions) {
        paths.push(join(nvmDir, version, 'bin'));
      }
    }
  } catch {
    // nvm not installed
  }

  return paths.join(':');
}

/**
 * Get the path to the claude-code executable.
 * Only uses user-installed Claude Code (no bundled version).
 */
function getClaudeCodePath(): string | undefined {
  const os = platform();
  const extendedEnv = { ...process.env, PATH: getExtendedPath() };

  // Priority 1: Check for user-installed Claude Code via 'which'/'where' with extended PATH
  try {
    if (os === 'win32') {
      const whereResult = execSync('where claude', {
        encoding: 'utf-8',
        stdio: 'pipe',
        env: extendedEnv,
      }).trim();
      const firstPath = whereResult.split('\n')[0];
      if (firstPath && existsSync(firstPath)) {
        console.log(
          `[Claude] Found user-installed Claude Code at: ${firstPath}`
        );
        return firstPath;
      }
    } else {
      // Try with login shell to get user's PATH
      try {
        const shellWhichResult = execSync('bash -l -c "which claude"', {
          encoding: 'utf-8',
          stdio: 'pipe',
          env: extendedEnv,
        }).trim();
        if (shellWhichResult && existsSync(shellWhichResult)) {
          console.log(
            `[Claude] Found user-installed Claude Code at: ${shellWhichResult}`
          );
          return shellWhichResult;
        }
      } catch {
        // Try zsh if bash fails
        try {
          const zshWhichResult = execSync('zsh -l -c "which claude"', {
            encoding: 'utf-8',
            stdio: 'pipe',
            env: extendedEnv,
          }).trim();
          if (zshWhichResult && existsSync(zshWhichResult)) {
            console.log(
              `[Claude] Found user-installed Claude Code at: ${zshWhichResult}`
            );
            return zshWhichResult;
          }
        } catch {
          // Fall through to other checks
        }
      }

      // Fallback: simple which with extended PATH
      const whichResult = execSync('which claude', {
        encoding: 'utf-8',
        stdio: 'pipe',
        env: extendedEnv,
      }).trim();
      if (whichResult && existsSync(whichResult)) {
        console.log(
          `[Claude] Found user-installed Claude Code at: ${whichResult}`
        );
        return whichResult;
      }
    }
  } catch {
    // 'which claude' failed, user doesn't have claude installed globally
  }

  // Priority 2: Try to get npm global bin path dynamically
  try {
    const npmPrefix = execSync('npm config get prefix', {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: extendedEnv,
    }).trim();
    if (npmPrefix) {
      const npmBinPath = join(npmPrefix, 'bin', 'claude');
      if (existsSync(npmBinPath)) {
        console.log(`[Claude] Found Claude Code at npm global: ${npmBinPath}`);
        return npmBinPath;
      }
    }
  } catch {
    // npm not available
  }

  // Priority 3: Check common install locations
  const home = homedir();
  const commonPaths =
    os === 'win32'
      ? [
          join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
          join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        ]
      : [
          '/usr/local/bin/claude',
          '/opt/homebrew/bin/claude',
          join(home, '.local', 'bin', 'claude'),
          join(home, '.npm-global', 'bin', 'claude'),
          join(home, '.volta', 'bin', 'claude'), // Volta
          join(home, 'code', 'node', 'npm_global', 'bin', 'claude'), // Custom npm global path
        ];

  // Priority 3.5: Also check nvm paths (dynamically find node versions)
  if (os !== 'win32') {
    const nvmDir = join(home, '.nvm', 'versions', 'node');
    try {
      const { readdirSync } = require('fs');
      const versions = readdirSync(nvmDir);
      for (const version of versions) {
        const nvmPath = join(nvmDir, version, 'bin', 'claude');
        if (existsSync(nvmPath)) {
          console.log(`[Claude] Found Claude Code at nvm path: ${nvmPath}`);
          return nvmPath;
        }
      }
    } catch {
      // nvm not installed or no versions
    }
  }

  for (const p of commonPaths) {
    if (existsSync(p)) {
      console.log(`[Claude] Found Claude Code at: ${p}`);
      return p;
    }
  }

  // Priority 4: Check if CLAUDE_CODE_PATH env var is set
  if (
    process.env.CLAUDE_CODE_PATH &&
    existsSync(process.env.CLAUDE_CODE_PATH)
  ) {
    console.log(
      `[Claude] Using CLAUDE_CODE_PATH: ${process.env.CLAUDE_CODE_PATH}`
    );
    return process.env.CLAUDE_CODE_PATH;
  }

  console.warn('[Claude] Claude Code not found. Please install it.');
  return undefined;
}

/**
 * Ensure Claude Code is available, install if necessary
 */
async function ensureClaudeCode(): Promise<string | undefined> {
  let path = getClaudeCodePath();

  if (!path) {
    console.log(
      '[Claude] Claude Code not found, attempting automatic installation...'
    );
    const installed = await installClaudeCode();
    if (installed) {
      // Re-check after installation
      path = getClaudeCodePath();
    }
  }

  return path;
}

/**
 * Expand ~ to home directory
 */
function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

/**
 * Generate a fallback slug from prompt for session directory name
 * Only used when no session path is provided from frontend
 */
function generateFallbackSlug(prompt: string, taskId: string): string {
  // Convert Chinese to pinyin-like or just use alphanumeric
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
 * If workDir already contains a valid session path (from frontend), use it directly
 * Otherwise, generate a new session folder
 */
async function getSessionWorkDir(
  workDir: string = DEFAULT_WORK_DIR,
  prompt?: string,
  taskId?: string
): Promise<string> {
  console.log('[Claude] getSessionWorkDir called with:', {
    workDir,
    prompt: prompt?.slice(0, 50),
    taskId,
  });

  const expandedPath = expandPath(workDir);
  console.log('[Claude] Expanded path:', expandedPath);

  // Check if the workDir is already a session folder path from frontend
  // Session paths from frontend look like: ~/.workany/sessions/{sessionId}/task-{xx}
  // or: ~/.workany/sessions/{sessionId}
  if (
    expandedPath.includes('/sessions/') &&
    !expandedPath.endsWith('/sessions')
  ) {
    // Frontend already provided a proper session path, use it directly
    console.log('[Claude] Using frontend-provided session path:', expandedPath);
    try {
      await mkdir(expandedPath, { recursive: true });
    } catch (error) {
      console.error('Failed to create working directory:', error);
    }
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

  try {
    await mkdir(targetDir, { recursive: true });
  } catch (error) {
    console.error('Failed to create working directory:', error);
  }

  return targetDir;
}

/**
 * Save images to disk and return file paths
 */
async function saveImagesToDisk(
  images: ImageAttachment[],
  workDir: string
): Promise<string[]> {
  const savedPaths: string[] = [];

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const ext = image.mimeType.split('/')[1] || 'png';
    const filename = `image_${Date.now()}_${i}.${ext}`;
    const filePath = join(workDir, filename);

    try {
      // Remove data URL prefix if present (e.g., "data:image/png;base64,")
      let base64Data = image.data;
      if (base64Data.includes(',')) {
        base64Data = base64Data.split(',')[1];
      }

      const buffer = Buffer.from(base64Data, 'base64');
      await writeFile(filePath, buffer);
      savedPaths.push(filePath);
      console.log(`[Claude] Saved image to: ${filePath}`);
    } catch (error) {
      console.error(`[Claude] Failed to save image: ${error}`);
    }
  }

  return savedPaths;
}

/**
 * Default allowed tools for execution
 */
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

/**
 * Create sandbox MCP server with inline tools
 */
function createSandboxMcpServer() {
  return createSdkMcpServer({
    name: 'sandbox',
    version: '1.0.0',
    tools: [
      tool(
        'sandbox_run_script',
        `Run a script file in an isolated sandbox container. Automatically detects the runtime (Python, Node.js, Bun) based on file extension.

IMPORTANT: The sandbox is isolated and CANNOT write files to the host filesystem.
- Scripts should output results to stdout (print/console.log)
- After execution, use the Write tool to save stdout content to files if needed
- Do NOT write files inside the script - it will fail with PermissionError

Example workflow:
1. Write script that prints results to stdout
2. Run script with sandbox_run_script
3. Use Write tool to save the stdout output to a file`,
        {
          filePath: z
            .string()
            .describe('Absolute path to the script file to execute'),
          workDir: z
            .string()
            .describe('Working directory containing the script'),
          args: z
            .array(z.string())
            .optional()
            .describe('Optional command line arguments'),
          packages: z
            .array(z.string())
            .optional()
            .describe(
              'Optional packages to install (pip for Python, npm for Node.js)'
            ),
          timeout: z
            .number()
            .optional()
            .describe('Execution timeout in milliseconds (default: 120000)'),
        },
        async (args) => {
          try {
            const response = await fetch(
              `${SANDBOX_API_URL}/sandbox/run/file`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args),
              }
            );

            if (!response.ok) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Sandbox service error: HTTP ${response.status}. The sandbox service may not be running.`,
                  },
                ],
                isError: true,
              };
            }

            const result = (await response.json()) as {
              success: boolean;
              exitCode: number;
              runtime?: string;
              duration?: number;
              stdout?: string;
              stderr?: string;
              error?: string;
            } | null;

            if (!result) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Sandbox service returned empty response. The sandbox service may not be available.',
                  },
                ],
                isError: true,
              };
            }

            let output = '';
            if (result.success) {
              output = `Script executed successfully (exit code: ${result.exitCode})\n`;
              output += `Runtime: ${result.runtime || 'unknown'}\n`;
              output += `Duration: ${result.duration || 0}ms\n\n`;
              if (result.stdout) output += `--- stdout ---\n${result.stdout}\n`;
              if (result.stderr) output += `--- stderr ---\n${result.stderr}\n`;
            } else {
              output = `Script execution failed (exit code: ${result.exitCode})\n`;
              if (result.error) output += `Error: ${result.error}\n`;
              if (result.stderr) output += `--- stderr ---\n${result.stderr}\n`;
              if (result.stdout) output += `--- stdout ---\n${result.stdout}\n`;
            }

            return {
              content: [{ type: 'text' as const, text: output }],
              isError: !result.success,
            };
          } catch (error) {
            // Network error or sandbox service not running
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Sandbox service unavailable: ${errorMsg}. Please ensure the sandbox service is running or disable sandbox mode.`,
                },
              ],
              isError: true,
            };
          }
        }
      ),
      tool(
        'sandbox_run_command',
        `Execute a shell command in an isolated sandbox container.

IMPORTANT: The sandbox is isolated and CANNOT write files to the host filesystem.
- Commands should output results to stdout
- Use Write tool to save any output to files after execution
- File write operations inside sandbox will fail with PermissionError`,
        {
          command: z
            .string()
            .describe("The command to execute (e.g., 'python', 'node', 'pip')"),
          args: z
            .array(z.string())
            .optional()
            .describe('Arguments for the command'),
          workDir: z
            .string()
            .describe('Working directory for command execution'),
          image: z
            .string()
            .optional()
            .describe('Container image (auto-detected if not specified)'),
          timeout: z
            .number()
            .optional()
            .describe('Execution timeout in milliseconds'),
        },
        async (args) => {
          try {
            const response = await fetch(`${SANDBOX_API_URL}/sandbox/exec`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                command: args.command,
                args: args.args,
                cwd: args.workDir,
                image: args.image,
                timeout: args.timeout,
              }),
            });

            if (!response.ok) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Sandbox service error: HTTP ${response.status}. The sandbox service may not be running.`,
                  },
                ],
                isError: true,
              };
            }

            const result = (await response.json()) as {
              success: boolean;
              exitCode: number;
              duration?: number;
              stdout?: string;
              stderr?: string;
              error?: string;
            } | null;

            if (!result) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Sandbox service returned empty response. The sandbox service may not be available.',
                  },
                ],
                isError: true,
              };
            }

            let output = '';
            if (result.success) {
              output = `Command executed successfully (exit code: ${result.exitCode})\n`;
              output += `Duration: ${result.duration || 0}ms\n\n`;
              if (result.stdout) output += `--- stdout ---\n${result.stdout}\n`;
              if (result.stderr) output += `--- stderr ---\n${result.stderr}\n`;
            } else {
              output = `Command failed (exit code: ${result.exitCode})\n`;
              if (result.error) output += `Error: ${result.error}\n`;
              if (result.stderr) output += `--- stderr ---\n${result.stderr}\n`;
            }

            return {
              content: [{ type: 'text' as const, text: output }],
              isError: !result.success,
            };
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Sandbox service unavailable: ${errorMsg}. Please ensure the sandbox service is running or disable sandbox mode.`,
                },
              ],
              isError: true,
            };
          }
        }
      ),
    ],
  });
}

/**
 * Claude Agent SDK implementation
 */
export class ClaudeAgent extends BaseAgent {
  readonly provider: AgentProvider = 'claude';

  constructor(config: AgentConfig) {
    super(config);
  }

  /**
   * Build environment variables for the SDK query
   * Supports custom API endpoint and API key
   * Also includes extended PATH for packaged app compatibility
   */
  private buildEnvConfig(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...process.env };

    // Extend PATH for packaged app to find node and other binaries
    env.PATH = getExtendedPath();

    // Override with config values if provided
    if (this.config.apiKey) {
      env.ANTHROPIC_API_KEY = this.config.apiKey;
    }
    if (this.config.baseUrl) {
      env.ANTHROPIC_BASE_URL = this.config.baseUrl;
    }

    return env;
  }

  /**
   * Format conversation history for inclusion in prompt
   */
  private formatConversationHistory(conversation?: ConversationMessage[]): string {
    if (!conversation || conversation.length === 0) {
      return '';
    }

    const formattedMessages = conversation.map((msg) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      return `${role}: ${msg.content}`;
    }).join('\n\n');

    return `## Previous Conversation Context
The following is the conversation history. Use this context to understand and respond to the current message appropriately.

${formattedMessages}

---
## Current Request
`;
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

    const sessionCwd = await getSessionWorkDir(
      options?.cwd || this.config.workDir,
      prompt,
      options?.taskId
    );
    console.log(`[Claude ${session.id}] Working directory: ${sessionCwd}`);
    console.log(`[Claude ${session.id}] Direct execution started`);
    if (options?.conversation && options.conversation.length > 0) {
      console.log(`[Claude ${session.id}] Conversation history: ${options.conversation.length} messages`);
    }
    if (options?.sandbox?.enabled) {
      console.log(`[Claude ${session.id}] Sandbox mode enabled`);
    }

    const sentTextHashes = new Set<string>();
    const sentToolIds = new Set<string>();

    // Build sandbox options for workspace instruction
    const sandboxOpts: SandboxOptions | undefined = options?.sandbox?.enabled
      ? {
          enabled: true,
          image: options.sandbox.image,
          apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL,
        }
      : undefined;

    // Handle image attachments - save to disk and reference in prompt
    let imageInstruction = '';
    if (options?.images && options.images.length > 0) {
      console.log(`[Claude ${session.id}] Processing ${options.images.length} image(s)`);
      options.images.forEach((img, i) => {
        console.log(`[Claude ${session.id}] Image ${i}: mimeType=${img.mimeType}, dataLength=${img.data?.length || 0}`);
      });
      const imagePaths = await saveImagesToDisk(options.images, sessionCwd);
      console.log(`[Claude ${session.id}] Saved ${imagePaths.length} images to disk: ${imagePaths.join(', ')}`);
      if (imagePaths.length > 0) {
        imageInstruction = `
## 🖼️ MANDATORY IMAGE ANALYSIS - DO THIS FIRST

**STOP! Before doing anything else, you MUST read the attached image(s).**

The user has attached ${imagePaths.length} image file(s):
${imagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}

**YOUR FIRST ACTION MUST BE:**
Use the Read tool to view each image file listed above. The Read tool supports image files (PNG, JPG, etc.) and will show you the visual content.

Example:
\`\`\`
Read tool: file_path="${imagePaths[0]}"
\`\`\`

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

    // Format conversation history to include context from previous messages
    const conversationContext = this.formatConversationHistory(options?.conversation);

    // Add workspace instruction to prompt so skills know where to save files
    // If images are attached, put image instruction FIRST (highest priority)
    const enhancedPrompt = imageInstruction
      ? imageInstruction + prompt + '\n\n' + getWorkspaceInstruction(sessionCwd, sandboxOpts) + conversationContext
      : getWorkspaceInstruction(sessionCwd, sandboxOpts) + conversationContext + prompt;

    // Ensure Claude Code is installed
    const claudeCodePath = await ensureClaudeCode();
    if (!claudeCodePath) {
      yield {
        type: 'error',
        message:
          'Claude Code is not installed. Please install it with: npm install -g @anthropic-ai/claude-code',
      };
      yield { type: 'done' };
      return;
    }

    // Load user-configured MCP servers from ~/.workany/mcp.json
    const userMcpServers = await loadMcpServers();

    // Build query options
    const queryOptions: Options = {
      cwd: sessionCwd,
      tools: { type: 'preset', preset: 'claude_code' },
      allowedTools: options?.allowedTools || ALLOWED_TOOLS,
      settingSources: ['user', 'project'],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      abortController: options?.abortController || session.abortController,
      env: this.buildEnvConfig(),
      model: this.config.model,
      pathToClaudeCodeExecutable: claudeCodePath,
    };

    // Initialize MCP servers with user-configured servers
    const mcpServers: Record<string, McpServerConfig | ReturnType<typeof createSandboxMcpServer>> = {
      ...userMcpServers,
    };

    // Add sandbox MCP server if sandbox is enabled
    if (options?.sandbox?.enabled) {
      mcpServers.sandbox = createSandboxMcpServer();
      // Add sandbox tools to allowed tools
      queryOptions.allowedTools = [
        ...(options?.allowedTools || ALLOWED_TOOLS),
        'sandbox_run_script',
        'sandbox_run_command',
      ];
    }

    // Only add mcpServers to options if there are any configured
    if (Object.keys(mcpServers).length > 0) {
      queryOptions.mcpServers = mcpServers;
      console.log(`[Claude ${session.id}] MCP servers loaded: ${Object.keys(mcpServers).join(', ')}`);
    }

    try {
      for await (const message of query({
        prompt: enhancedPrompt,
        options: queryOptions,
      })) {
        if (session.abortController.signal.aborted) break;

        yield* this.processMessage(
          message,
          session.id,
          sentTextHashes,
          sentToolIds
        );
      }
    } catch (error) {
      console.error(`[Claude ${session.id}] Error:`, error);
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
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

    // Create session working directory even in planning phase
    const sessionCwd = await getSessionWorkDir(
      options?.cwd || this.config.workDir,
      prompt,
      options?.taskId
    );
    console.log(`[Claude ${session.id}] Working directory: ${sessionCwd}`);
    console.log(`[Claude ${session.id}] Planning phase started`);

    // Include workspace instruction in planning prompt
    const workspaceInstruction = `
## CRITICAL: Output Directory
**ALL files must be saved to: ${sessionCwd}**
If you need to create any files during planning, use this directory.
`;
    const planningPrompt = workspaceInstruction + PLANNING_INSTRUCTION + prompt;

    let fullResponse = '';

    // Ensure Claude Code is installed
    const claudeCodePath = await ensureClaudeCode();
    if (!claudeCodePath) {
      yield {
        type: 'error',
        message:
          'Claude Code is not installed. Please install it with: npm install -g @anthropic-ai/claude-code',
      };
      yield { type: 'done' };
      return;
    }

    const queryOptions: Options = {
      cwd: sessionCwd, // Set working directory for planning phase
      settingSources: ['project', 'user'],
      allowedTools: [], // No tools in planning phase
      // Use bypassPermissions since we have no tools - avoids SDK's built-in plan file creation
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      abortController: options?.abortController || session.abortController,
      env: this.buildEnvConfig(),
      model: this.config.model,
      pathToClaudeCodeExecutable: claudeCodePath,
    };

    try {
      for await (const message of query({
        prompt: planningPrompt,
        options: queryOptions,
      })) {
        if (session.abortController.signal.aborted) break;

        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if ('text' in block) {
              fullResponse += block.text;
              yield { type: 'text', content: block.text };
            }
          }
        }
      }

      // Parse the planning response - can be direct answer or plan
      const planningResult = parsePlanningResponse(fullResponse);

      if (planningResult?.type === 'direct_answer') {
        // Simple question - return direct answer, no plan needed
        console.log(
          `[Claude ${session.id}] Direct answer provided (no plan needed)`
        );
        yield { type: 'direct_answer', content: planningResult.answer };
      } else if (
        planningResult?.type === 'plan' &&
        planningResult.plan.steps.length > 0
      ) {
        // Complex task - return plan
        this.storePlan(planningResult.plan);
        console.log(
          `[Claude ${session.id}] Plan created: ${planningResult.plan.id} with ${planningResult.plan.steps.length} steps`
        );
        yield { type: 'plan', plan: planningResult.plan };
      } else {
        // Fallback: try to parse as plan directly
        const plan = parsePlanFromResponse(fullResponse);
        if (plan && plan.steps.length > 0) {
          this.storePlan(plan);
          console.log(
            `[Claude ${session.id}] Plan created: ${plan.id} with ${plan.steps.length} steps`
          );
          yield { type: 'plan', plan };
        } else {
          // If no structured response, treat as direct answer
          console.log(
            `[Claude ${session.id}] No plan found, treating as direct answer`
          );
          yield { type: 'direct_answer', content: fullResponse.trim() };
        }
      }
    } catch (error) {
      console.error(`[Claude ${session.id}] Planning error:`, error);
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

    const plan = this.getPlan(options.planId);
    if (!plan) {
      yield { type: 'error', message: 'Plan not found' };
      yield { type: 'done' };
      return;
    }

    const sessionCwd = await getSessionWorkDir(
      options.cwd || this.config.workDir,
      options.originalPrompt,
      options.taskId
    );
    console.log(`[Claude ${session.id}] Working directory: ${sessionCwd}`);
    if (options.sandbox?.enabled) {
      console.log(`[Claude ${session.id}] Sandbox mode enabled`);
    }

    // Build sandbox options for workspace instruction
    const sandboxOpts: SandboxOptions | undefined = options.sandbox?.enabled
      ? {
          enabled: true,
          image: options.sandbox.image,
          apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL,
        }
      : undefined;

    // Pass workDir and sandbox to formatPlanForExecution so skills know where to save files
    const executionPrompt =
      formatPlanForExecution(plan, sessionCwd, sandboxOpts) +
      '\n\nOriginal request: ' +
      options.originalPrompt;
    console.log(
      `[Claude ${session.id}] Execution phase started for plan: ${options.planId}`
    );

    const sentTextHashes = new Set<string>();
    const sentToolIds = new Set<string>();

    // Ensure Claude Code is installed
    const claudeCodePath = await ensureClaudeCode();
    if (!claudeCodePath) {
      yield {
        type: 'error',
        message:
          'Claude Code is not installed. Please install it with: npm install -g @anthropic-ai/claude-code',
      };
      yield { type: 'done' };
      return;
    }

    // Load user-configured MCP servers from ~/.workany/mcp.json
    const userMcpServers = await loadMcpServers();

    // Build query options
    const queryOptions: Options = {
      cwd: sessionCwd,
      tools: { type: 'preset', preset: 'claude_code' },
      allowedTools: options.allowedTools || ALLOWED_TOOLS,
      settingSources: ['user', 'project'],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      abortController: options.abortController || session.abortController,
      env: this.buildEnvConfig(),
      model: this.config.model,
      pathToClaudeCodeExecutable: claudeCodePath,
    };

    // Initialize MCP servers with user-configured servers
    const mcpServers: Record<string, McpServerConfig | ReturnType<typeof createSandboxMcpServer>> = {
      ...userMcpServers,
    };

    // Add sandbox MCP server if sandbox is enabled
    if (options.sandbox?.enabled) {
      mcpServers.sandbox = createSandboxMcpServer();
      // Add sandbox tools to allowed tools
      queryOptions.allowedTools = [
        ...(options.allowedTools || ALLOWED_TOOLS),
        'sandbox_run_script',
        'sandbox_run_command',
      ];
    }

    // Only add mcpServers to options if there are any configured
    if (Object.keys(mcpServers).length > 0) {
      queryOptions.mcpServers = mcpServers;
      console.log(`[Claude ${session.id}] MCP servers loaded: ${Object.keys(mcpServers).join(', ')}`);
    }

    try {
      for await (const message of query({
        prompt: executionPrompt,
        options: queryOptions,
      })) {
        if (session.abortController.signal.aborted) break;

        yield* this.processMessage(
          message,
          session.id,
          sentTextHashes,
          sentToolIds
        );
      }
    } catch (error) {
      console.error(`[Claude ${session.id}] Execution error:`, error);
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      console.log(`[Claude ${session.id}] Execution done`);
      this.deletePlan(options.planId);
      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }

  /**
   * Process SDK messages and convert to AgentMessage format
   */
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
          const textHash = (block.text as string).slice(0, 100);
          if (!sentTextHashes.has(textHash)) {
            sentTextHashes.add(textHash);
            console.log(
              `[Claude ${sessionId}] Text: ${(block.text as string).slice(0, 50)}...`
            );
            yield { type: 'text', content: block.text as string };
          }
        } else if ('name' in block && 'id' in block) {
          const toolId = block.id as string;
          if (!sentToolIds.has(toolId)) {
            sentToolIds.add(toolId);
            console.log(`[Claude ${sessionId}] Tool: ${block.name}`);
            yield {
              type: 'tool_use',
              id: toolId,
              name: block.name as string,
              input: block.input,
            };
          }
        }
      }
    }

    if (msg.type === 'user' && msg.message?.content) {
      for (const block of msg.message.content as Record<string, unknown>[]) {
        if ('type' in block && block.type === 'tool_result') {
          console.log(
            `[Claude ${sessionId}] Tool result for: ${block.tool_use_id}`
          );
          yield {
            type: 'tool_result',
            toolUseId: block.tool_use_id as string,
            output:
              typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content),
            isError: (block.is_error as boolean) || false,
          };
        }
      }
    }

    if (msg.type === 'result') {
      console.log(`[Claude ${sessionId}] Result: ${msg.subtype}`);
      yield {
        type: 'result',
        content: msg.subtype,
        cost: msg.total_cost_usd,
        duration: msg.duration_ms,
      };
    }
  }
}

/**
 * Factory function to create Claude agent
 */
export function createClaudeAgent(config: AgentConfig): ClaudeAgent {
  return new ClaudeAgent(config);
}

/**
 * Claude agent plugin definition
 */
export const claudePlugin: AgentPlugin = defineAgentPlugin({
  metadata: CLAUDE_METADATA,
  factory: (config) => createClaudeAgent(config),
});
