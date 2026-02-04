/**
 * Codex Agent Adapter
 *
 * Implementation of the IAgent interface using OpenAI Codex CLI.
 * Provides CLI-based execution for OpenAI-powered code generation.
 */

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
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
// Import plugin definition helpers
import { CODEX_METADATA, defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentPlugin } from '@/core/agent/plugin';
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ExecuteOptions,
  PlanOptions,
} from '@/core/agent/types';
import {
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  DEFAULT_WORK_DIR,
} from '@/config/constants';

// Sandbox API URL - use the main API's sandbox endpoints
// API port: 2620 for production, 2026 for development
const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
const API_PORT =
  process.env.PORT || (isDev ? '2026' : String(DEFAULT_API_PORT));
const SANDBOX_API_URL = `http://${DEFAULT_API_HOST}:${API_PORT}`;

/**
 * Install Codex CLI automatically
 */
async function installCodex(): Promise<boolean> {
  console.log('[Codex] Attempting to install Codex CLI...');

  try {
    console.log('[Codex] Installing via npm...');
    execSync('npm install -g @openai/codex', {
      encoding: 'utf-8',
      stdio: 'inherit',
    });
    return true;
  } catch (error) {
    console.error('[Codex] Failed to install Codex CLI:', error);
    return false;
  }
}

/**
 * Get the path to the codex executable
 */
function getCodexPath(): string | undefined {
  const os = platform();

  // Priority 1: Check for user-installed Codex via 'which'/'where'
  try {
    if (os === 'win32') {
      const whereResult = execSync('where codex', {
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();
      const firstPath = whereResult.split('\n')[0];
      if (firstPath && existsSync(firstPath)) {
        console.log(`[Codex] Found user-installed Codex at: ${firstPath}`);
        return firstPath;
      }
    } else {
      const whichResult = execSync('which codex', {
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();
      if (whichResult && existsSync(whichResult)) {
        console.log(`[Codex] Found user-installed Codex at: ${whichResult}`);
        return whichResult;
      }
    }
  } catch {
    // 'which codex' failed, user doesn't have codex installed globally
  }

  // Priority 2: Check common install locations
  const commonPaths =
    os === 'win32'
      ? [join(homedir(), 'AppData', 'Roaming', 'npm', 'codex.cmd')]
      : [
          '/usr/local/bin/codex',
          join(homedir(), '.local', 'bin', 'codex'),
          join(homedir(), '.npm-global', 'bin', 'codex'),
        ];

  for (const p of commonPaths) {
    if (existsSync(p)) {
      console.log(`[Codex] Found Codex at: ${p}`);
      return p;
    }
  }

  // Priority 3: Check if CODEX_PATH env var is set
  if (process.env.CODEX_PATH && existsSync(process.env.CODEX_PATH)) {
    console.log(`[Codex] Using CODEX_PATH: ${process.env.CODEX_PATH}`);
    return process.env.CODEX_PATH;
  }

  console.warn('[Codex] Codex CLI not found. Please install it.');
  return undefined;
}

/**
 * Ensure Codex CLI is available, install if necessary
 */
async function ensureCodex(): Promise<string | undefined> {
  let path = getCodexPath();

  if (!path) {
    console.log(
      '[Codex] Codex CLI not found, attempting automatic installation...'
    );
    const installed = await installCodex();
    if (installed) {
      path = getCodexPath();
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
 * Generate a semantic slug from prompt for session directory name
 */
function generateSessionSlug(prompt: string, taskId: string): string {
  let slug = prompt
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff-]/g, ' ')
    .replace(/[\u4e00-\u9fff]+/g, (match) => match)
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
async function getSessionWorkDir(
  workDir: string = DEFAULT_WORK_DIR,
  prompt?: string,
  taskId?: string
): Promise<string> {
  const baseDir = expandPath(workDir);
  const sessionsDir = join(baseDir, 'sessions');

  let folderName: string;
  if (prompt && taskId) {
    folderName = generateSessionSlug(prompt, taskId);
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
 * Run Codex CLI and stream output
 */
async function runCodex(
  codexPath: string,
  prompt: string,
  cwd: string,
  env: Record<string, string | undefined>,
  abortController?: AbortController
): Promise<
  AsyncGenerator<{ type: 'stdout' | 'stderr' | 'exit'; data: string }>
> {
  const proc = spawn(codexPath, ['--quiet', prompt], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (abortController) {
    abortController.signal.addEventListener('abort', () => {
      proc.kill('SIGTERM');
    });
  }

  proc.stdout?.setEncoding('utf-8');
  proc.stderr?.setEncoding('utf-8');

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  proc.stdout?.on('data', (data: string) => {
    stdoutChunks.push(data);
  });

  proc.stderr?.on('data', (data: string) => {
    stderrChunks.push(data);
  });

  return new Promise((resolve) => {
    proc.on('close', (code) => {
      const fullStdout = stdoutChunks.join('');
      const fullStderr = stderrChunks.join('');

      // Create a generator that yields the results
      const gen = (async function* () {
        if (fullStdout) {
          yield { type: 'stdout' as const, data: fullStdout };
        }
        if (fullStderr) {
          yield { type: 'stderr' as const, data: fullStderr };
        }
        yield { type: 'exit' as const, data: String(code || 0) };
      })();

      resolve(gen);
    });
  });
}

/**
 * Codex Agent implementation
 */
export class CodexAgent extends BaseAgent {
  readonly provider: AgentProvider = 'codex';

  constructor(config: AgentConfig) {
    super(config);
  }

  /**
   * Build environment variables for Codex
   */
  private buildEnvConfig(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...process.env };

    // Override with config values if provided
    if (this.config.apiKey) {
      env.OPENAI_API_KEY = this.config.apiKey;
    }
    if (this.config.baseUrl) {
      env.OPENAI_BASE_URL = this.config.baseUrl;
    }
    if (this.config.model) {
      env.CODEX_MODEL = this.config.model;
    }

    return env;
  }

  /**
   * Direct execution mode (without planning)
   */
  async *run(
    prompt: string,
    options?: AgentOptions
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing', {
      id: options?.sessionId,
      abortController: options?.abortController,
    });
    yield { type: 'session', sessionId: session.id };

    const sessionCwd = await getSessionWorkDir(
      this.config.workDir || options?.cwd,
      prompt,
      options?.taskId
    );
    console.log(`[Codex ${session.id}] Working directory: ${sessionCwd}`);
    console.log(`[Codex ${session.id}] Direct execution started`);

    // Build sandbox options for workspace instruction
    const sandboxOpts: SandboxOptions | undefined = options?.sandbox?.enabled
      ? {
          enabled: true,
          image: options.sandbox.image,
          apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL,
        }
      : undefined;

    // Add workspace instruction to prompt
    const enhancedPrompt =
      getWorkspaceInstruction(sessionCwd, sandboxOpts) + prompt;

    // Ensure Codex CLI is installed
    const codexPath = await ensureCodex();
    if (!codexPath) {
      yield {
        type: 'error',
        message:
          'Codex CLI is not installed. Please install it with: npm install -g @openai/codex',
      };
      yield { type: 'done' };
      return;
    }

    try {
      // Run Codex CLI
      const cliGenerator = await runCodex(
        codexPath,
        enhancedPrompt,
        sessionCwd,
        this.buildEnvConfig(),
        options?.abortController || session.abortController
      );

      for await (const event of cliGenerator) {
        if (session.abortController.signal.aborted) break;

        if (event.type === 'stdout') {
          yield { type: 'text', content: event.data };
        } else if (event.type === 'stderr') {
          // Log stderr but don't treat as error unless exit code is non-zero
          console.log(`[Codex ${session.id}] stderr: ${event.data}`);
        } else if (event.type === 'exit') {
          const exitCode = parseInt(event.data, 10);
          if (exitCode !== 0) {
            yield {
              type: 'error',
              message: `Codex exited with code ${exitCode}`,
            };
          }
        }
      }
    } catch (error) {
      console.error(`[Codex ${session.id}] Error:`, error);
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
    const session = this.createSession('planning', {
      id: options?.sessionId,
      abortController: options?.abortController,
    });
    yield { type: 'session', sessionId: session.id };

    const sessionCwd = await getSessionWorkDir(
      this.config.workDir || options?.cwd,
      prompt,
      options?.taskId
    );
    console.log(`[Codex ${session.id}] Working directory: ${sessionCwd}`);
    console.log(`[Codex ${session.id}] Planning phase started`);

    // For Codex, we'll use a simplified planning approach
    // Since Codex doesn't have a native planning mode, we'll ask it to generate a plan
    const planningPrompt = `${PLANNING_INSTRUCTION}${prompt}

Please respond ONLY with JSON in this exact format, no other text:
{
  "type": "plan",
  "goal": "brief description of the goal",
  "steps": [
    {"id": "1", "description": "first step"},
    {"id": "2", "description": "second step"}
  ],
  "notes": "any important notes"
}`;

    let fullResponse = '';

    // Ensure Codex CLI is installed
    const codexPath = await ensureCodex();
    if (!codexPath) {
      yield {
        type: 'error',
        message:
          'Codex CLI is not installed. Please install it with: npm install -g @openai/codex',
      };
      yield { type: 'done' };
      return;
    }

    try {
      const cliGenerator = await runCodex(
        codexPath,
        planningPrompt,
        sessionCwd,
        this.buildEnvConfig(),
        options?.abortController || session.abortController
      );

      for await (const event of cliGenerator) {
        if (session.abortController.signal.aborted) break;

        if (event.type === 'stdout') {
          fullResponse += event.data;
          yield { type: 'text', content: event.data };
        }
      }

      // Parse the planning response
      const planningResult = parsePlanningResponse(fullResponse);

      if (planningResult?.type === 'direct_answer') {
        console.log(`[Codex ${session.id}] Direct answer provided`);
        yield { type: 'direct_answer', content: planningResult.answer };
      } else if (
        planningResult?.type === 'plan' &&
        planningResult.plan.steps.length > 0
      ) {
        this.storePlan(planningResult.plan);
        console.log(
          `[Codex ${session.id}] Plan created: ${planningResult.plan.id}`
        );
        yield { type: 'plan', plan: planningResult.plan };
      } else {
        const plan = parsePlanFromResponse(fullResponse);
        if (plan && plan.steps.length > 0) {
          this.storePlan(plan);
          console.log(`[Codex ${session.id}] Plan created: ${plan.id}`);
          yield { type: 'plan', plan };
        } else {
          console.log(
            `[Codex ${session.id}] No plan found, treating as direct answer`
          );
          yield { type: 'direct_answer', content: fullResponse.trim() };
        }
      }
    } catch (error) {
      console.error(`[Codex ${session.id}] Planning error:`, error);
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
    const session = this.createSession('executing', {
      id: options.sessionId,
      abortController: options.abortController,
    });
    yield { type: 'session', sessionId: session.id };

    // Use the plan passed in options, or fall back to local lookup
    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      console.error(`[Codex ${session.id}] Plan not found: ${options.planId}`);
      yield { type: 'error', message: `Plan not found: ${options.planId}` };
      yield { type: 'done' };
      return;
    }

    console.log(`[Codex ${session.id}] Using plan: ${plan.id} (${plan.goal})`);

    const sessionCwd = await getSessionWorkDir(
      this.config.workDir || options.cwd,
      options.originalPrompt,
      options.taskId
    );
    console.log(`[Codex ${session.id}] Working directory: ${sessionCwd}`);

    // Build sandbox options for workspace instruction
    const sandboxOpts: SandboxOptions | undefined = options.sandbox?.enabled
      ? {
          enabled: true,
          image: options.sandbox.image,
          apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL,
        }
      : undefined;

    const executionPrompt =
      formatPlanForExecution(plan, sessionCwd, sandboxOpts) +
      '\n\nOriginal request: ' +
      options.originalPrompt;

    console.log(
      `[Codex ${session.id}] Execution phase started for plan: ${options.planId}`
    );

    // Ensure Codex CLI is installed
    const codexPath = await ensureCodex();
    if (!codexPath) {
      yield {
        type: 'error',
        message:
          'Codex CLI is not installed. Please install it with: npm install -g @openai/codex',
      };
      yield { type: 'done' };
      return;
    }

    try {
      const cliGenerator = await runCodex(
        codexPath,
        executionPrompt,
        sessionCwd,
        this.buildEnvConfig(),
        options.abortController || session.abortController
      );

      for await (const event of cliGenerator) {
        if (session.abortController.signal.aborted) break;

        if (event.type === 'stdout') {
          yield { type: 'text', content: event.data };
        } else if (event.type === 'exit') {
          const exitCode = parseInt(event.data, 10);
          if (exitCode !== 0) {
            yield {
              type: 'error',
              message: `Codex exited with code ${exitCode}`,
            };
          }
        }
      }
    } catch (error) {
      console.error(`[Codex ${session.id}] Execution error:`, error);
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      console.log(`[Codex ${session.id}] Execution done`);
      this.deletePlan(options.planId);
      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }
}

/**
 * Factory function to create Codex agent
 */
export function createCodexAgent(config: AgentConfig): CodexAgent {
  return new CodexAgent(config);
}

/**
 * Codex agent plugin definition
 */
export const codexPlugin: AgentPlugin = defineAgentPlugin({
  metadata: CODEX_METADATA,
  factory: (config) => createCodexAgent(config),
});
