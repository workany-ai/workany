/**
 * Claude Agent SDK Adapter
 *
 * Implementation of the IAgent interface using @anthropic-ai/claude-agent-sdk
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { arch, homedir, platform } from 'os';
import { dirname, join } from 'path';
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
// Skills are loaded directly by Claude SDK from ~/.claude/skills/ via settingSources: ['user']
// No custom loading needed
// ============================================================================
// Logging - uses shared logger (writes to ~/.workany/logs/workany.log)
// ============================================================================
import { createLogger, LOG_FILE_PATH } from '@/shared/utils/logger';

const logger = createLogger('ClaudeAgent');

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
 * Check if running in a packaged Tauri app environment
 */
function isPackagedApp(): boolean {
  // Check if running from a bundled binary (via pkg)
  // @ts-expect-error - pkg specific property
  if (process.pkg) {
    return true;
  }

  // Check for Tauri environment
  if (process.env.TAURI_ENV || process.env.TAURI) {
    return true;
  }

  // Check if executable path contains typical app bundle paths
  const execPath = process.execPath;
  if (
    execPath.includes('.app/Contents/MacOS') ||
    execPath.includes('\\WorkAny\\') ||
    execPath.includes('/WorkAny/')
  ) {
    return true;
  }

  // Check for production environment
  if (process.env.NODE_ENV === 'production') {
    return true;
  }

  return false;
}

/**
 * Get the target triple for the current platform
 */
function getTargetTriple(): string {
  const os = platform();
  const cpuArch = arch();

  if (os === 'darwin') {
    return cpuArch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  } else if (os === 'linux') {
    return cpuArch === 'arm64'
      ? 'aarch64-unknown-linux-gnu'
      : 'x86_64-unknown-linux-gnu';
  } else if (os === 'win32') {
    return 'x86_64-pc-windows-msvc';
  }

  return 'unknown';
}

/**
 * Get the path to bundled sidecar Claude Code executable
 * The bundle structure is:
 * - claude-{target} or claude (launcher script)
 * - claude-bundle/
 *   - node (Node.js binary)
 *   - node_modules/@anthropic-ai/claude-code/ (Claude Code package)
 */
function getSidecarClaudeCodePath(): string | undefined {
  const os = platform();
  const targetTriple = getTargetTriple();
  const claudeName =
    os === 'win32' ? `claude-${targetTriple}.exe` : `claude-${targetTriple}`;

  // Get the directory where this process (workany-api) is running from
  // In a packaged app, this would be the MacOS directory or the app directory
  const execDir = dirname(process.execPath);

  // Possible locations for the bundled Claude Code launcher
  const possibleLauncherPaths = [
    join(execDir, claudeName),
    join(execDir, 'claude'),
  ];

  // For Windows, also check for .cmd batch files
  if (os === 'win32') {
    possibleLauncherPaths.push(join(execDir, 'claude.cmd'));
    possibleLauncherPaths.push(join(execDir, '_up_', 'src-api', 'dist', 'claude.cmd'));
  }

  // For macOS .app bundles, also check Resources directory
  if (os === 'darwin') {
    const resourcesDir = join(execDir, '..', 'Resources');
    possibleLauncherPaths.push(join(resourcesDir, claudeName));
    possibleLauncherPaths.push(join(resourcesDir, 'claude'));
  }

  // For Linux deb/rpm packages, launcher is in /usr/bin/
  if (os === 'linux') {
    possibleLauncherPaths.push('/usr/bin/claude');
    possibleLauncherPaths.push(join(execDir, '..', 'bin', 'claude'));
  }

  // For pkg bundled apps
  // @ts-expect-error - pkg specific property
  if (process.pkg) {
    const pkgDir = dirname(process.argv[0]);
    possibleLauncherPaths.push(join(pkgDir, claudeName));
    possibleLauncherPaths.push(join(pkgDir, 'claude'));
  }

  // Check each possible launcher path
  for (const launcherPath of possibleLauncherPaths) {
    if (!existsSync(launcherPath)) continue;

    // Get the directory containing the launcher
    const launcherDir = dirname(launcherPath);

    // Check if cli-bundle or claude-bundle directory exists alongside the launcher
    const bundleNames = ['cli-bundle', 'claude-bundle'];
    for (const bundleName of bundleNames) {
      const bundleDir = join(launcherDir, bundleName);
      const claudeCliPath = join(
        bundleDir,
        'node_modules',
        '@anthropic-ai',
        'claude-code',
        'cli.js'
      );
      const nodeBinPath = join(bundleDir, os === 'win32' ? 'node.exe' : 'node');

      if (
        existsSync(bundleDir) &&
        existsSync(claudeCliPath) &&
        existsSync(nodeBinPath)
      ) {
        console.log(`[Claude] Found bundled Claude Code at: ${launcherPath}`);
        console.log(`[Claude] Bundle directory: ${bundleDir}`);
        console.log(`[Claude] Node.js binary: ${nodeBinPath}`);
        return launcherPath;
      }
    }

    // If no bundle dir but launcher exists, it might be a standalone binary
    if (existsSync(launcherPath)) {
      console.log(`[Claude] Found Claude Code launcher at: ${launcherPath}`);
      return launcherPath;
    }
  }

  // Also try direct check for cli-bundle/claude-bundle in common locations
  const bundleLocations = [
    // New unified cli-bundle structure
    join(execDir, 'cli-bundle'),
    join(execDir, '..', 'Resources', 'cli-bundle'),
    // macOS: Tauri places resources with preserved path structure
    join(execDir, '..', 'Resources', '_up_', 'src-api', 'dist', 'cli-bundle'),
    // Windows: Tauri places resources relative to exe with preserved path structure
    join(execDir, '_up_', 'src-api', 'dist', 'cli-bundle'),
    // Linux: Tauri deb/rpm places resources in /usr/lib/<AppName>/
    // execDir is /usr/bin, so ../lib/WorkAny/ -> /usr/lib/WorkAny/
    join(execDir, '..', 'lib', 'WorkAny', '_up_', 'src-api', 'dist', 'cli-bundle'),
    join(execDir, '..', 'lib', 'workany', '_up_', 'src-api', 'dist', 'cli-bundle'),
    // Legacy claude-bundle for backward compatibility
    join(execDir, 'claude-bundle'),
    join(execDir, '..', 'Resources', 'claude-bundle'),
  ];

  for (const bundleDir of bundleLocations) {
    if (!existsSync(bundleDir)) continue;

    const claudeCliPath = join(
      bundleDir,
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'cli.js'
    );
    const nodeBinPath = join(bundleDir, os === 'win32' ? 'node.exe' : 'node');

    if (existsSync(claudeCliPath) && existsSync(nodeBinPath)) {
      // Create a path that points to using the bundled node to run claude
      // The launcher script should be in the parent directory or a few levels up
      const possibleLauncherDirs = [
        dirname(bundleDir), // Direct parent
        join(dirname(bundleDir), '..', '..', '..'), // For _up_/src-api/dist/cli-bundle structure
        '/usr/bin', // Linux: launcher is in /usr/bin/
      ];

      // On Windows, look for .cmd files; on Unix, look for shell scripts
      const launcherNames = os === 'win32'
        ? ['claude.cmd', claudeName]
        : [claudeName, 'claude'];

      for (const launcherDir of possibleLauncherDirs) {
        for (const launcherName of launcherNames) {
          const launcherPath = join(launcherDir, launcherName);
          if (existsSync(launcherPath)) {
            console.log(
              `[Claude] Found bundled Claude Code launcher at: ${launcherPath}`
            );
            return launcherPath;
          }
        }
      }

      // If no launcher found, return undefined instead of BUNDLE: prefix
      // The BUNDLE: prefix is not understood by the Claude SDK
      console.warn(`[Claude] Found Claude Code bundle at: ${bundleDir} but no launcher script found`);
      return undefined;
    }
  }

  return undefined;
}

/**
 * Build extended PATH that includes common package manager bin locations
 */
function getExtendedPath(): string {
  const home = homedir();
  const os = platform();
  const isWindows = os === 'win32';
  const pathSeparator = isWindows ? ';' : ':';

  const paths = [process.env.PATH || ''];

  if (isWindows) {
    // Windows paths
    paths.push(
      join(home, 'AppData', 'Roaming', 'npm'),
      join(home, 'AppData', 'Local', 'Programs', 'nodejs'),
      join(home, '.volta', 'bin'),
      'C:\\Program Files\\nodejs',
      'C:\\Program Files (x86)\\nodejs'
    );
  } else {
    // Unix paths
    paths.push(
      '/usr/local/bin',
      '/opt/homebrew/bin',
      `${home}/.local/bin`,
      `${home}/.npm-global/bin`,
      `${home}/.volta/bin`,
      `${home}/code/node/npm_global/bin`
    );

    // Add nvm paths (Unix only)
    const nvmDir = join(home, '.nvm', 'versions', 'node');
    try {
      if (existsSync(nvmDir)) {
        const versions = readdirSync(nvmDir);
        for (const version of versions) {
          paths.push(join(nvmDir, version, 'bin'));
        }
      }
    } catch {
      // nvm not installed
    }
  }

  return paths.join(pathSeparator);
}

/**
 * Get the path to the claude-code executable.
 * Priority order:
 * 1. User-installed Claude Code (via which/where, npm global, common paths, nvm, etc.)
 * 2. Bundled sidecar Claude Code (if app was built with --with-claude)
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

  // Priority 5: Check for bundled sidecar Claude Code (if built with --with-claude)
  const sidecarPath = getSidecarClaudeCodePath();
  if (sidecarPath) {
    console.log(`[Claude] Using bundled sidecar Claude Code: ${sidecarPath}`);
    return sidecarPath;
  }

  console.warn(
    '[Claude] Claude Code not found. Please install it or rebuild the app with --with-claude flag.'
  );
  return undefined;
}

/**
 * Ensure Claude Code is available, install if necessary
 * Note: If app was built with --with-claude, sidecar will be used automatically
 */
async function ensureClaudeCode(): Promise<string | undefined> {
  let path = getClaudeCodePath();

  if (!path) {
    // Check if we're in a packaged app without sidecar Claude Code
    // In this case, we can still try to install if the user has npm available
    if (isPackagedApp()) {
      console.log(
        '[Claude] Claude Code not found in packaged app. ' +
          'The app was built without --with-claude flag. ' +
          'Attempting automatic installation...'
      );
    } else {
      console.log(
        '[Claude] Claude Code not found, attempting automatic installation...'
      );
    }

    const installed = await installClaudeCode();
    if (installed) {
      // Re-check after installation
      path = getClaudeCodePath();
    }
  }

  return path;
}

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
 * NOTE: This function only computes the path, it does NOT create the directory
 */
function getSessionWorkDir(
  workDir: string = DEFAULT_WORK_DIR,
  prompt?: string,
  taskId?: string
): string {
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
  // Support both Unix (/) and Windows (\) path separators
  const hasSessionsPath = expandedPath.includes('/sessions/') || expandedPath.includes('\\sessions\\');
  const endsWithSessions = expandedPath.endsWith('/sessions') || expandedPath.endsWith('\\sessions');
  if (hasSessionsPath && !endsWithSessions) {
    // Frontend already provided a proper session path, use it directly
    console.log('[Claude] Using frontend-provided session path:', expandedPath);
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
 * This should be called only when actually writing files
 */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    console.error('Failed to create directory:', error);
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
 * @param sandboxProvider - The sandbox provider to use (e.g., 'codex', 'claude', 'native')
 */
function createSandboxMcpServer(sandboxProvider?: string) {
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
                body: JSON.stringify({ ...args, provider: sandboxProvider }),
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
                provider: sandboxProvider,
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
    console.log('[ClaudeAgent] Created with config:', {
      provider: config.provider,
      hasApiKey: !!config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      workDir: config.workDir,
    });
  }

  /**
   * Build settingSources for Claude SDK
   * Skills are loaded from ~/.claude/skills/ via 'user' source
   *
   * IMPORTANT: When custom API is configured, we should be careful about
   * loading user settings from ~/.claude/settings.json as it may contain
   * model settings that conflict with the custom API (e.g., model: "opus"
   * won't work with third-party APIs like 火山引擎/OpenRouter)
   */
  private buildSettingSources(skillsConfig?: SkillsConfig): ('user' | 'project')[] {
    // If skills are globally disabled, use project only (no user skills)
    if (skillsConfig && !skillsConfig.enabled) {
      logger.info('[ClaudeAgent] Skills disabled, using project only');
      return ['project'];
    }

    // Always load from user directory (~/.claude/skills/)
    // This is the only supported skills directory
    return ['user', 'project'];
  }

  /**
   * Check if using custom (non-Anthropic) API
   */
  private isUsingCustomApi(): boolean {
    return !!(this.config.baseUrl && this.config.apiKey);
  }

  /**
   * Build environment variables for the SDK query
   * Supports custom API endpoint and API key (including OpenRouter)
   * Also includes extended PATH for packaged app compatibility
   *
   * NOTE: SDK expects Record<string, string>, so we filter out undefined values
   */
  private buildEnvConfig(): Record<string, string> {
    const env: Record<string, string | undefined> = { ...process.env };

    // Extend PATH for packaged app to find node and other binaries
    env.PATH = getExtendedPath();

    // When user configures custom API in settings, we need to ensure it takes priority
    // over any config from ~/.claude/settings.json (which is read via settingSources: ['user'])
    // Delete env vars to prevent them from being overridden by ~/.claude/settings.json
    if (this.config.apiKey) {
      // Use ANTHROPIC_AUTH_TOKEN for custom API key
      env.ANTHROPIC_AUTH_TOKEN = this.config.apiKey;
      // Delete ANTHROPIC_API_KEY to ensure AUTH_TOKEN takes priority
      delete env.ANTHROPIC_API_KEY;

      // Handle base URL: set if configured, delete if not (to use default Anthropic API)
      if (this.config.baseUrl) {
        env.ANTHROPIC_BASE_URL = this.config.baseUrl;
        logger.info('[ClaudeAgent] Using custom API from settings:', {
          baseUrl: this.config.baseUrl,
        });
      } else {
        // Delete to ensure default Anthropic API is used, not from ~/.claude/settings.json
        delete env.ANTHROPIC_BASE_URL;
        logger.info('[ClaudeAgent] Using custom API key with default Anthropic base URL');
      }
    } else {
      logger.info(
        '[ClaudeAgent] Using API config from environment:',
        env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY
          ? 'key present'
          : 'key missing'
      );
    }

    // Set model configuration
    if (this.config.model) {
      env.ANTHROPIC_MODEL = this.config.model;
      // Also set default models for different tiers (useful for OpenRouter model names)
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = this.config.model;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = this.config.model;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = this.config.model;
      logger.info('[ClaudeAgent] Model configured:', this.config.model);
    } else if (this.config.apiKey) {
      // When using custom API but no model specified, clear any model from ~/.claude/settings.json
      // to let the third-party API use its default model
      delete env.ANTHROPIC_MODEL;
      delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
      delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
      delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;
      logger.info('[ClaudeAgent] Custom API without model: cleared local model settings');
    } else {
      logger.info(
        '[ClaudeAgent] Model to use:',
        env.ANTHROPIC_MODEL || 'default from SDK'
      );
    }

    // When using custom API, disable telemetry and non-essential traffic
    // This helps avoid potential issues with third-party API compatibility
    if (this.isUsingCustomApi()) {
      env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
      // Force the SDK to not use any cached/stored API configuration
      env.CLAUDE_CODE_SKIP_CONFIG = '1';
      // Set longer timeout for third-party APIs (10 minutes)
      env.API_TIMEOUT_MS = '600000';
      // Disable model validation for third-party APIs
      env.CLAUDE_CODE_SKIP_MODEL_VALIDATION = '1';
      logger.info('[ClaudeAgent] Custom API mode: disabled non-essential traffic, set timeout to 600s');
    }

    // Debug: Log final environment variables for API configuration
    logger.info('[ClaudeAgent] Final env config:', {
      ANTHROPIC_API_KEY:
        env.ANTHROPIC_API_KEY === undefined
          ? '(deleted)'
          : env.ANTHROPIC_API_KEY
            ? `${env.ANTHROPIC_API_KEY.slice(0, 10)}...`
            : 'not set',
      ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN
        ? `${env.ANTHROPIC_AUTH_TOKEN.slice(0, 10)}...`
        : 'not set',
      ANTHROPIC_BASE_URL:
        env.ANTHROPIC_BASE_URL === undefined
          ? '(deleted - use default)'
          : env.ANTHROPIC_BASE_URL || 'not set',
      ANTHROPIC_MODEL: env.ANTHROPIC_MODEL || 'not set',
    });

    // Filter out undefined values - SDK expects Record<string, string>
    const filteredEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) {
        filteredEnv[key] = value;
      }
    }
    return filteredEnv;
  }

  /**
   * Estimate token count for a text string (rough approximation)
   * This is a simple estimation: 1 token ≈ 4 characters for English text
   */
  private estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Format conversation history for inclusion in prompt with token length limits
   */
  private formatConversationHistory(
    conversation?: ConversationMessage[]
  ): string {
    if (!conversation || conversation.length === 0) {
      return '';
    }

    // Get token limits from agent config, fallback to defaults
    const maxHistoryTokens = this.config.providerConfig?.maxHistoryTokens as number || 2000;
    const minMessagesToKeep = 3; // Always keep at least 3 most recent messages
    
    // Format all messages first
    const allFormattedMessages = conversation.map((msg) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      let messageContent = `${role}: ${msg.content}`;

      // Include image references if present
      if (msg.imagePaths && msg.imagePaths.length > 0) {
        const imageRefs = msg.imagePaths
          .map((p, i) => `  - Image ${i + 1}: ${p}`)
          .join('\n');
        messageContent += `\n[Attached images in this message:\n${imageRefs}\nUse Read tool to view these images if needed]`;
      }

      return messageContent;
    });

    // Calculate tokens for each message
    const messageTokens = allFormattedMessages.map(msg => ({
      content: msg,
      tokens: this.estimateTokenCount(msg)
    }));

    // Start with the most recent messages and work backwards
    let totalTokens = 0;
    const selectedMessages: string[] = [];
    
    // Always keep at least minMessagesToKeep messages
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

    // If we have room for more messages, try to add older ones
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

    const sessionCwd = getSessionWorkDir(
      options?.cwd || this.config.workDir,
      prompt,
      options?.taskId
    );
    // Ensure the working directory exists before calling SDK
    await ensureDir(sessionCwd);
    logger.info(`[Claude ${session.id}] Working directory: ${sessionCwd}`);
    logger.info(`[Claude ${session.id}] Direct execution started`);
    if (options?.conversation && options.conversation.length > 0) {
      logger.info(
        `[Claude ${session.id}] Conversation history: ${options.conversation.length} messages`
      );
    }
    // Log sandbox config for debugging
    logger.info(`[Claude ${session.id}] Sandbox config received:`, {
      hasOptions: !!options,
      hasSandbox: !!options?.sandbox,
      sandboxEnabled: options?.sandbox?.enabled,
      sandboxProvider: options?.sandbox?.provider,
    });
    if (options?.sandbox?.enabled) {
      logger.info(
        `[Claude ${session.id}] Sandbox mode enabled with provider: ${options.sandbox.provider}`
      );
    } else {
      logger.warn(
        `[Claude ${session.id}] Sandbox mode NOT enabled - scripts will run locally`
      );
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
      console.log(
        `[Claude ${session.id}] Processing ${options.images.length} image(s)`
      );
      options.images.forEach((img, i) => {
        console.log(
          `[Claude ${session.id}] Image ${i}: mimeType=${img.mimeType}, dataLength=${img.data?.length || 0}`
        );
      });
      const imagePaths = await saveImagesToDisk(options.images, sessionCwd);
      console.log(
        `[Claude ${session.id}] Saved ${imagePaths.length} images to disk: ${imagePaths.join(', ')}`
      );
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
    const conversationContext = this.formatConversationHistory(
      options?.conversation
    );

    // Add workspace instruction to prompt so skills know where to save files
    // If images are attached, put image instruction FIRST (highest priority)
    const enhancedPrompt = imageInstruction
      ? imageInstruction +
        prompt +
        '\n\n' +
        getWorkspaceInstruction(sessionCwd, sandboxOpts) +
        conversationContext
      : getWorkspaceInstruction(sessionCwd, sandboxOpts) +
        conversationContext +
        prompt;

    // Ensure Claude Code is installed
    const claudeCodePath = await ensureClaudeCode();
    if (!claudeCodePath) {
      yield {
        type: 'error',
        message: '__CLAUDE_CODE_NOT_FOUND__',
      };
      yield { type: 'done' };
      return;
    }

    // Load user-configured MCP servers based on mcpConfig settings
    const userMcpServers = await loadMcpServers(options?.mcpConfig as McpConfig | undefined);

    // Build query options
    // Use settingSources based on skillsConfig to control skill loading
    // - 'user' source loads from ~/.claude directory (User skills)
    // - 'project' source loads from project/.claude directory
    // User's custom API settings from WorkAny settings page are passed via env config
    // which takes priority over ~/.claude/settings.json because we set ANTHROPIC_API_KEY directly
    const settingSources: ('user' | 'project')[] = this.buildSettingSources(options?.skillsConfig);
    logger.info(`[Claude ${session.id}] Skills config:`, options?.skillsConfig);
    logger.info(`[Claude ${session.id}] Setting sources: ${settingSources.join(', ')}`);

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
      pathToClaudeCodeExecutable: claudeCodePath,
      maxTurns: 200, // Allow more agentic turns before stopping
      // Capture stderr for debugging
      stderr: (data: string) => {
        logger.error(`[Claude ${session.id}] STDERR: ${data}`);
      },
    };

    // Initialize MCP servers with user-configured servers
    const mcpServers: Record<
      string,
      McpServerConfig | ReturnType<typeof createSandboxMcpServer>
    > = {
      ...userMcpServers,
    };

    // Add sandbox MCP server if sandbox is enabled
    if (options?.sandbox?.enabled) {
      mcpServers.sandbox = createSandboxMcpServer(options.sandbox.provider);
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
      logger.info(
        `[Claude ${session.id}] MCP servers loaded: ${Object.keys(mcpServers).join(', ')}`
      );
    } else {
      logger.warn(
        `[Claude ${session.id}] No MCP servers configured (sandbox disabled or no user MCP servers)`
      );
    }

    // Log detailed query options for debugging
    const envConfig = queryOptions.env || {};
    logger.info(`[Claude ${session.id}] ========== AGENT CONFIG START ==========`);
    logger.info(`[Claude ${session.id}] Claude Code Path: ${claudeCodePath}`);
    logger.info(`[Claude ${session.id}] Working Directory: ${queryOptions.cwd}`);
    logger.info(`[Claude ${session.id}] Model (from config): ${this.config.model || '(not set)'}`);
    logger.info(`[Claude ${session.id}] Model (queryOptions): ${queryOptions.model || '(not set)'}`);
    logger.info(`[Claude ${session.id}] API Config:`, {
      baseUrl: this.config.baseUrl || '(default Anthropic)',
      hasApiKey: !!this.config.apiKey,
      isCustomApi: this.isUsingCustomApi(),
    });
    logger.info(`[Claude ${session.id}] Environment Variables:`, {
      ANTHROPIC_AUTH_TOKEN: envConfig.ANTHROPIC_AUTH_TOKEN ? `${envConfig.ANTHROPIC_AUTH_TOKEN.slice(0, 15)}...` : '(not set)',
      ANTHROPIC_API_KEY: envConfig.ANTHROPIC_API_KEY ? `${envConfig.ANTHROPIC_API_KEY.slice(0, 15)}...` : '(not set)',
      ANTHROPIC_BASE_URL: envConfig.ANTHROPIC_BASE_URL || '(not set)',
      ANTHROPIC_MODEL: envConfig.ANTHROPIC_MODEL || '(not set)',
      ANTHROPIC_DEFAULT_SONNET_MODEL: envConfig.ANTHROPIC_DEFAULT_SONNET_MODEL || '(not set)',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: envConfig.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC || '(not set)',
    });
    logger.info(`[Claude ${session.id}] Setting Sources: ${queryOptions.settingSources?.join(', ') || '(none)'}`);
    logger.info(`[Claude ${session.id}] Permission Mode: ${queryOptions.permissionMode}`);
    logger.info(`[Claude ${session.id}] MCP Servers: ${queryOptions.mcpServers ? Object.keys(queryOptions.mcpServers).join(', ') : '(none)'}`);
    logger.info(`[Claude ${session.id}] Prompt Length: ${enhancedPrompt.length} chars`);
    logger.info(`[Claude ${session.id}] ========== AGENT CONFIG END ==========`);

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
      // Log detailed error information to file for debugging
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error(`[Claude ${session.id}] Error occurred`, {
        error: {
          name: error instanceof Error ? error.name : 'Unknown',
          message: errorMessage,
          stack: errorStack,
        },
        config: {
          baseUrl: this.config.baseUrl || '(default)',
          apiKey: this.config.apiKey ? 'configured' : 'not set',
          model: this.config.model || '(default)',
        },
        env: {
          ANTHROPIC_BASE_URL: this.buildEnvConfig().ANTHROPIC_BASE_URL || '(not set)',
          ANTHROPIC_MODEL: this.buildEnvConfig().ANTHROPIC_MODEL || '(not set)',
          hasAuthToken: !!this.buildEnvConfig().ANTHROPIC_AUTH_TOKEN,
        },
      });

      // Check for API key related errors (including Chinese error messages from third-party APIs)
      // If no API key is configured and process exits with error, it's likely an auth issue
      const noApiKeyConfigured = !this.config.apiKey && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN;
      const processExitError = errorMessage.includes('exited with code');

      // Check if using custom API - process exit with custom API is likely API compatibility issue
      const usingCustomApi = this.isUsingCustomApi();

      const isApiKeyError =
        errorMessage.includes('Invalid API key') ||
        errorMessage.includes('invalid_api_key') ||
        errorMessage.includes('API key') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('Please run /login') ||
        errorMessage.includes('Unauthorized') ||
        errorMessage.includes('401') ||
        errorMessage.includes('403') ||
        errorMessage.includes('身份验证') ||
        errorMessage.includes('认证失败') ||
        errorMessage.includes('鉴权失败') ||
        errorMessage.includes('密钥无效') ||
        errorMessage.includes('token') ||
        errorMessage.includes('credential') ||
        (noApiKeyConfigured && processExitError);  // No API key + process exit = likely auth issue

      // Custom API + process exit error = likely API compatibility issue
      const isApiCompatibilityError = usingCustomApi && processExitError;

      if (isApiKeyError) {
        yield {
          type: 'error',
          message: '__API_KEY_ERROR__',
        };
      } else if (isApiCompatibilityError) {
        // Custom API compatibility error - show more specific message
        logger.error(`[Claude ${session.id}] Custom API compatibility error. Check if the API endpoint supports Claude Code SDK format.`);
        yield {
          type: 'error',
          message: `__CUSTOM_API_ERROR__|${this.config.baseUrl}|${LOG_FILE_PATH}`,
        };
      } else {
        // Show simple user-friendly error message
        // Detailed error info is already logged to file
        yield {
          type: 'error',
          message: `__INTERNAL_ERROR__|${LOG_FILE_PATH}`,
        };
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
    const session = this.createSession('planning', {
      id: options?.sessionId,
      abortController: options?.abortController,
    });
    yield { type: 'session', sessionId: session.id };

    // Get session working directory
    const sessionCwd = getSessionWorkDir(
      options?.cwd || this.config.workDir,
      prompt,
      options?.taskId
    );
    // Ensure the working directory exists before calling SDK
    await ensureDir(sessionCwd);
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
        message: '__CLAUDE_CODE_NOT_FOUND__',
      };
      yield { type: 'done' };
      return;
    }

    // Always use ['user', 'project'] to load skills and MCP from user's ~/.claude directory
    const planSettingSources: ('user' | 'project')[] = ['user', 'project'];

    const queryOptions: Options = {
      cwd: sessionCwd, // Set working directory for planning phase
      settingSources: planSettingSources,
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
    const session = this.createSession('executing', {
      id: options.sessionId,
      abortController: options.abortController,
    });
    yield { type: 'session', sessionId: session.id };

    // Use the plan passed in options, or fall back to local lookup
    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      console.error(`[Claude ${session.id}] Plan not found: ${options.planId}`);
      yield { type: 'error', message: `Plan not found: ${options.planId}` };
      yield { type: 'done' };
      return;
    }

    console.log(`[Claude ${session.id}] Using plan: ${plan.id} (${plan.goal})`);

    const sessionCwd = getSessionWorkDir(
      options.cwd || this.config.workDir,
      options.originalPrompt,
      options.taskId
    );
    // Ensure the working directory exists before calling SDK
    await ensureDir(sessionCwd);
    logger.info(`[Claude ${session.id}] Working directory: ${sessionCwd}`);
    // Log sandbox config for debugging
    logger.info(`[Claude ${session.id}] Execute sandbox config:`, {
      hasSandbox: !!options.sandbox,
      sandboxEnabled: options.sandbox?.enabled,
      sandboxProvider: options.sandbox?.provider,
    });
    if (options.sandbox?.enabled) {
      logger.info(
        `[Claude ${session.id}] Sandbox mode enabled with provider: ${options.sandbox.provider}`
      );
    } else {
      logger.warn(`[Claude ${session.id}] Sandbox NOT enabled for execution`);
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
    logger.info(
      `[Claude ${session.id}] Execution phase started for plan: ${options.planId}`
    );

    const sentTextHashes = new Set<string>();
    const sentToolIds = new Set<string>();

    // Ensure Claude Code is installed
    const claudeCodePath = await ensureClaudeCode();
    if (!claudeCodePath) {
      yield {
        type: 'error',
        message: '__CLAUDE_CODE_NOT_FOUND__',
      };
      yield { type: 'done' };
      return;
    }

    // Load user-configured MCP servers based on mcpConfig settings
    const userMcpServers = await loadMcpServers(options.mcpConfig as McpConfig | undefined);

    // Build query options
    // Use settingSources based on skillsConfig to control skill loading
    const execSettingSources: ('user' | 'project')[] = this.buildSettingSources(options.skillsConfig);
    logger.info(`[Claude ${session.id}] Execute skills config:`, options.skillsConfig);
    logger.info(`[Claude ${session.id}] Execute setting sources: ${execSettingSources.join(', ')}`);

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
      pathToClaudeCodeExecutable: claudeCodePath,
      maxTurns: 200, // Allow more agentic turns before stopping
      // Capture stderr for debugging
      stderr: (data: string) => {
        logger.error(`[Claude ${session.id}] STDERR: ${data}`);
      },
    };

    // Initialize MCP servers with user-configured servers
    const mcpServers: Record<
      string,
      McpServerConfig | ReturnType<typeof createSandboxMcpServer>
    > = {
      ...userMcpServers,
    };

    // Add sandbox MCP server if sandbox is enabled
    if (options.sandbox?.enabled) {
      mcpServers.sandbox = createSandboxMcpServer(options.sandbox.provider);
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
      logger.info(
        `[Claude ${session.id}] Execute MCP servers loaded: ${Object.keys(mcpServers).join(', ')}`
      );
    } else {
      logger.warn(`[Claude ${session.id}] Execute: No MCP servers configured`);
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
   * Sanitize text content to remove internal implementation details
   * that should not be exposed to users
   */
  private sanitizeText(text: string): string {
    let sanitized = text;

    // Check for API key related errors first - these should show config prompt
    const apiKeyErrorPatterns = [
      /Invalid API key/i,
      /invalid_api_key/i,
      /API key.*invalid/i,
      /authentication.*fail/i,
      /Unauthorized/i,
      /身份验证失败/,
      /认证失败/,
      /鉴权失败/,
      /密钥无效/,
    ];

    const hasApiKeyError = apiKeyErrorPatterns.some((pattern) =>
      pattern.test(sanitized)
    );

    // Replace "Claude Code process exited with code X" with a special marker
    // The marker will be replaced with localized text on the frontend
    sanitized = sanitized.replace(
      /Claude Code process exited with code \d+/gi,
      '__AGENT_PROCESS_ERROR__'
    );

    // Remove "Please run /login" messages - not relevant for custom API users
    sanitized = sanitized.replace(/\s*[·•\-–—]\s*Please run \/login\.?/gi, '');
    sanitized = sanitized.replace(/Please run \/login\.?/gi, '');

    // If API key error detected, replace entire message with special marker
    // This ensures frontend shows the config prompt instead of raw error
    if (hasApiKeyError) {
      return '__API_KEY_ERROR__';
    }

    return sanitized;
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
          const sanitizedText = this.sanitizeText(block.text as string);
          const textHash = sanitizedText.slice(0, 100);
          if (!sentTextHashes.has(textHash)) {
            sentTextHashes.add(textHash);
            console.log(
              `[Claude ${sessionId}] Text: ${sanitizedText.slice(0, 50)}...`
            );
            yield { type: 'text', content: sanitizedText };
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
          const toolUseIdSnake = (block as { tool_use_id?: unknown })
            .tool_use_id;
          const toolUseIdCamel = (block as { toolUseId?: unknown }).toolUseId;
          const isErrorSnake = (block as { is_error?: unknown }).is_error;
          const isErrorCamel = (block as { isError?: unknown }).isError;
          const toolUseId = toolUseIdSnake ?? toolUseIdCamel;
          const rawIsError = isErrorSnake ?? isErrorCamel;
          const isError = typeof rawIsError === 'boolean' ? rawIsError : false;

          console.log(
            `[Claude ${sessionId}] Tool result for: ${String(toolUseId)}`
          );
          yield {
            type: 'tool_result',
            toolUseId: (toolUseId ?? '') as string,
            output:
              typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content),
            isError,
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
