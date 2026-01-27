/**
 * Claude Agent SDK Adapter
 *
 * Implementation of the IAgent interface using @anthropic-ai/claude-agent-sdk
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
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
 * Find the actual JavaScript entry file for npm global @anthropic-ai/claude-code package
 */
function findClaudeCodeJsEntry(): string | undefined {
  try {
    const npmPrefix = execSync('npm config get prefix', {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
    if (!npmPrefix) {
      return undefined;
    }

    const packageDir = join(npmPrefix, 'node_modules', '@anthropic-ai', 'claude-code');
    if (!existsSync(packageDir)) {
      return undefined;
    }

    // Try to read package.json to find the bin entry
    try {
      const packageJsonPath = join(packageDir, 'package.json');
      if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        const binEntry = packageJson.bin?.claude || packageJson.bin?.claudeCode || packageJson.bin?.['claude-code'];
        if (binEntry) {
          const jsEntryPath = join(packageDir, binEntry);
          if (existsSync(jsEntryPath)) {
            return jsEntryPath;
          }
        }
      }
    } catch {
      // Failed to read package.json
    }

    // Fallback: try common locations for the JavaScript entry file
    const possibleJsPaths = [
      join(packageDir, 'bin', 'claude.js'),
      join(packageDir, 'bin', 'claude'),
      join(packageDir, 'dist', 'claude.js'),
      join(packageDir, 'dist', 'index.js'),
      join(packageDir, 'index.js'),
      join(packageDir, 'cli.js'),
    ];
    for (const possiblePath of possibleJsPaths) {
      if (existsSync(possiblePath)) {
        return possiblePath;
      }
    }
  } catch {
    // npm not available or error
  }
  return undefined;
}

/**
 * Normalize Windows path for spawn compatibility.
 * On Windows, .cmd files cannot be directly spawned, so we try to find the corresponding .exe file
 * or find the actual JavaScript entry file and use node to execute it.
 */
function normalizeWindowsPath(path: string): string {
  const os = platform();
  if (os !== 'win32') {
    return path;
  }

  // If it's a .cmd file, try to find the corresponding .exe file
  if (path.toLowerCase().endsWith('.cmd')) {
    const exePath = path.slice(0, -4) + '.exe';
    if (existsSync(exePath)) {
      console.log(`[Claude] Using .exe file instead of .cmd: ${exePath}`);
      return exePath;
    }
    
    // Try to find the actual executable in node_modules
    const dir = dirname(path);
    const nodeModulesExe = join(dir, 'node_modules', '.bin', 'claude.exe');
    if (existsSync(nodeModulesExe)) {
      console.log(`[Claude] Using node_modules executable: ${nodeModulesExe}`);
      return nodeModulesExe;
    }
    
    // Try to find claude.exe in the parent directory
    const parentDir = dirname(dir);
    const parentExe = join(parentDir, 'claude.exe');
    if (existsSync(parentExe)) {
      console.log(`[Claude] Using parent directory executable: ${parentExe}`);
      return parentExe;
    }
    
    // If no .exe found, try to find the actual JavaScript entry file
    // Since SDK's ProcessTransport cannot directly execute .bat files on Windows,
    // we need to use cmd.exe /c to execute the .bat file, or use node.exe directly
    const jsEntryPath = findClaudeCodeJsEntry();
    if (jsEntryPath) {
      console.log(`[Claude] Found JavaScript entry file: ${jsEntryPath}`);
      // Try to find node executable
      try {
        const nodePath = execSync('where.exe node', {
          encoding: 'utf-8',
          stdio: 'pipe',
        }).trim().split('\n')[0];
        if (nodePath && existsSync(nodePath)) {
          console.log(`[Claude] Node.js found at: ${nodePath}`);
          
          // SDK's ProcessTransport automatically uses node.exe to execute JavaScript files
          // According to SDK source code, if pathToClaudeCodeExecutable is not a native binary,
          // SDK will use the executable (default: node) to execute the JavaScript file
          // So we can directly return the JavaScript entry file path!
          console.log(`[Claude] SDK will use node.exe to execute JavaScript file: ${jsEntryPath}`);
          return jsEntryPath;
        }
      } catch {
        // node not found - this is a problem
        console.error(`[Claude] Node.js not found! Cannot execute JavaScript entry file.`);
      }
    }
    
    // If we can't find a solution, return the original path
    // SDK will need to handle .cmd files properly or we'll get an error
    console.warn(
      `[Claude] Warning: .cmd file found but no corresponding .exe or JS entry: ${path}. ` +
      `SDK may not be able to spawn .cmd files directly on Windows.`
    );
    return path;
  }

  return path;
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
    console.log(`[Claude] Checking for user-installed Claude Code...`);
    console.log(`[Claude] os: ${os}`);
    if (os === 'win32') {
      let whereResult: string;
      try {
        // Prefer where.exe (for Powershell compatibility)
        whereResult = execSync('where.exe claude', {
          encoding: 'utf-8',
          stdio: 'pipe',
          env: extendedEnv,
        }).trim();
      } catch {
        // Fallback to plain where (legacy/cmd environments)
        whereResult = execSync('where claude', {
          encoding: 'utf-8',
          stdio: 'pipe',
          env: extendedEnv,
        }).trim();
      }
      console.log(`[Claude] whereResult: ${whereResult}`);
      const paths = whereResult.split('\n').map(p => p.trim()).filter(p => p);
      // On Windows, prefer .exe files over .cmd files for spawn compatibility
      // But we need to check if files actually exist
      let preferredPath: string | undefined;
      
      // First, try to find .exe file
      preferredPath = paths.find(p => p.toLowerCase().endsWith('.exe') && existsSync(p));
      
      // If no .exe, try to find .cmd file
      if (!preferredPath) {
        preferredPath = paths.find(p => p.toLowerCase().endsWith('.cmd') && existsSync(p));
      }
      
      // If still no match, try to find any existing file
      if (!preferredPath) {
        preferredPath = paths.find(p => existsSync(p));
      }
      
      // Fallback to first path if all else fails (will be normalized and checked later)
      if (!preferredPath && paths.length > 0) {
        preferredPath = paths[0];
      }
      
      if (preferredPath) {
        // Verify the path exists before normalizing
        if (!existsSync(preferredPath)) {
          console.warn(`[Claude] Path does not exist: ${preferredPath}, trying other paths...`);
          // Try other paths
          for (const p of paths) {
            if (existsSync(p)) {
              preferredPath = p;
              console.log(`[Claude] Found existing path: ${preferredPath}`);
              break;
            }
          }
        }
        
        if (preferredPath && existsSync(preferredPath)) {
          // Always normalize the path (this will handle .cmd files by creating wrapper if needed)
          const normalizedPath = normalizeWindowsPath(preferredPath);
          // Verify the normalized path exists (or is a wrapper we created)
          if (existsSync(normalizedPath) || normalizedPath !== preferredPath) {
            console.log(
              `[Claude] Found user-installed Claude Code at: ${normalizedPath}`
            );
            return normalizedPath;
          } else {
            console.warn(`[Claude] Normalized path does not exist: ${normalizedPath}`);
          }
        }
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
          const normalizedPath = normalizeWindowsPath(shellWhichResult);
          console.log(
            `[Claude] Found user-installed Claude Code at: ${normalizedPath}`
          );
          return normalizedPath;
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
            const normalizedPath = normalizeWindowsPath(zshWhichResult);
            console.log(
              `[Claude] Found user-installed Claude Code at: ${normalizedPath}`
            );
            return normalizedPath;
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
        const normalizedPath = normalizeWindowsPath(whichResult);
        console.log(
          `[Claude] Found user-installed Claude Code at: ${normalizedPath}`
        );
        return normalizedPath;
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
    console.log(`[Claude] npmPrefix: ${npmPrefix}`);
    if (npmPrefix) {
      // On Windows, prefer .exe files over .cmd files for spawn compatibility
      const possiblePaths = [
        join(npmPrefix, 'bin', 'claude.exe'),
        join(npmPrefix, 'claude.exe'),
        join(npmPrefix, 'bin', 'claude.cmd'),
        join(npmPrefix, 'claude.cmd'),
      ];
      for (const possiblePath of possiblePaths) {
        if (existsSync(possiblePath)) {
          const normalizedPath = normalizeWindowsPath(possiblePath);
          console.log(`[Claude] Found Claude Code at npm global: ${normalizedPath}`);
          return normalizedPath;
        }
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
          const normalizedPath = normalizeWindowsPath(nvmPath);
          console.log(`[Claude] Found Claude Code at nvm path: ${normalizedPath}`);
          return normalizedPath;
        }
      }
    } catch {
      // nvm not installed or no versions
    }
  }

  for (const p of commonPaths) {
    if (existsSync(p)) {
      const normalizedPath = normalizeWindowsPath(p);
      console.log(`[Claude] Found Claude Code at: ${normalizedPath}`);
      return normalizedPath;
    }
  }

  // Priority 4: Check if CLAUDE_CODE_PATH env var is set
  if (
    process.env.CLAUDE_CODE_PATH &&
    existsSync(process.env.CLAUDE_CODE_PATH)
  ) {
    const normalizedPath = normalizeWindowsPath(process.env.CLAUDE_CODE_PATH);
    console.log(
      `[Claude] Using CLAUDE_CODE_PATH: ${normalizedPath}`
    );
    return normalizedPath;
  }

  // Priority 5: Check for bundled sidecar Claude Code (if built with --with-claude)
  const sidecarPath = getSidecarClaudeCodePath();
  if (sidecarPath) {
    const normalizedPath = normalizeWindowsPath(sidecarPath);
    console.log(`[Claude] Using bundled sidecar Claude Code: ${normalizedPath}`);
    return normalizedPath;
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
  if (
    expandedPath.includes('/sessions/') &&
    !expandedPath.endsWith('/sessions')
  ) {
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
   * Build environment variables for the SDK query
   * Supports custom API endpoint and API key (including OpenRouter)
   * Also includes extended PATH for packaged app compatibility
   */
  private buildEnvConfig(): Record<string, string | undefined> {
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
    } else {
      logger.info(
        '[ClaudeAgent] Model to use:',
        env.ANTHROPIC_MODEL || 'default from SDK'
      );
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

    return env;
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

    const formattedMessages = conversation
      .map((msg) => {
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
      })
      .join('\n\n');

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

    // Log query start for debugging
    logger.info(`[Claude ${session.id}] Starting query`, {
      claudeCodePath,
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      hasApiKey: !!this.config.apiKey,
      promptLength: enhancedPrompt.length,
    });

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
      logger.error(`[Claude ${session.id}] Error occurred`, {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
        config: {
          baseUrl: this.config.baseUrl || '(default)',
          apiKey: this.config.apiKey ? 'configured' : 'not set',
          model: this.config.model || '(default)',
        },
      });

      // Check for API key related errors (including Chinese error messages from third-party APIs)
      const errorMessage = error instanceof Error ? error.message : String(error);

      // If no API key is configured and process exits with error, it's likely an auth issue
      const noApiKeyConfigured = !this.config.apiKey && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN;
      const processExitError = errorMessage.includes('exited with code');

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

      if (isApiKeyError) {
        yield {
          type: 'error',
          message: '__API_KEY_ERROR__',
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
    const session = this.createSession('planning');
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
    const session = this.createSession('executing');
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
    // Replace "Claude Code process exited with code X" with a special marker
    // The marker will be replaced with localized text on the frontend
    return text.replace(
      /Claude Code process exited with code \d+/gi,
      '__AGENT_PROCESS_ERROR__'
    );
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
