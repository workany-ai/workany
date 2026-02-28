/**
 * Kimi CLI Utilities
 *
 * Path detection and utility functions for Kimi CLI integration
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { arch, homedir, platform } from 'os';
import { join } from 'path';

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

    // Add Python package paths for Kimi CLI
    paths.push(
      `${home}/.local/bin`,
      `${home}/Library/Python/3.11/bin`,
      `${home}/Library/Python/3.12/bin`,
      `${home}/Library/Python/3.13/bin`,
      '/usr/local/bin',
      '/opt/homebrew/bin'
    );
  }

  return paths.join(pathSeparator);
}

/**
 * Get the path to the kimi CLI executable.
 * Priority order:
 * 1. User-installed Kimi CLI (via which/where with extended PATH)
 * 2. Common Python package locations
 * 3. Environment variable KIMI_CLI_PATH
 */
export function getKimiCliPath(): string | undefined {
  const os = platform();
  const extendedEnv = { ...process.env, PATH: getExtendedPath() };

  // Priority 1: Check for user-installed Kimi CLI via 'which'/'where' with extended PATH
  try {
    if (os === 'win32') {
      const whereResult = execSync('where kimi', {
        encoding: 'utf-8',
        stdio: 'pipe',
        env: extendedEnv,
      }).trim();
      const firstPath = whereResult.split('\n')[0];
      if (firstPath && existsSync(firstPath)) {
        console.log(
          `[Kimi] Found user-installed Kimi CLI at: ${firstPath}`
        );
        return firstPath;
      }
    } else {
      // Try with login shell to get user's PATH
      try {
        const shellWhichResult = execSync('bash -l -c "which kimi"', {
          encoding: 'utf-8',
          stdio: 'pipe',
          env: extendedEnv,
        }).trim();
        if (shellWhichResult && existsSync(shellWhichResult)) {
          console.log(
            `[Kimi] Found user-installed Kimi CLI at: ${shellWhichResult}`
          );
          return shellWhichResult;
        }
      } catch {
        // Try zsh if bash fails
        try {
          const zshWhichResult = execSync('zsh -l -c "which kimi"', {
            encoding: 'utf-8',
            stdio: 'pipe',
            env: extendedEnv,
          }).trim();
          if (zshWhichResult && existsSync(zshWhichResult)) {
            console.log(
              `[Kimi] Found user-installed Kimi CLI at: ${zshWhichResult}`
            );
            return zshWhichResult;
          }
        } catch {
          // Fall through to other checks
        }
      }

      // Fallback: simple which with extended PATH
      const whichResult = execSync('which kimi', {
        encoding: 'utf-8',
        stdio: 'pipe',
        env: extendedEnv,
      }).trim();
      if (whichResult && existsSync(whichResult)) {
        console.log(
          `[Kimi] Found user-installed Kimi CLI at: ${whichResult}`
        );
        return whichResult;
      }
    }
  } catch {
    // 'which kimi' failed, user doesn't have kimi installed globally
  }

  // Priority 2: Check common install locations
  const home = homedir();
  const commonPaths =
    os === 'win32'
      ? [
          join(home, 'AppData', 'Local', 'Programs', 'kimi', 'kimi.exe'),
          join(home, 'AppData', 'Roaming', 'Python', 'Scripts', 'kimi.exe'),
        ]
      : [
          '/usr/local/bin/kimi',
          '/opt/homebrew/bin/kimi',
          join(home, '.local', 'bin', 'kimi'),
          // Python user-site directories
          join(home, 'Library', 'Python', '3.11', 'bin', 'kimi'),
          join(home, 'Library', 'Python', '3.12', 'bin', 'kimi'),
          join(home, 'Library', 'Python', '3.13', 'bin', 'kimi'),
          // pyenv paths
          join(home, '.pyenv', 'shims', 'kimi'),
        ];

  for (const path of commonPaths) {
    if (existsSync(path)) {
      console.log(`[Kimi] Found Kimi CLI at: ${path}`);
      return path;
    }
  }

  // Priority 3: Check if KIMI_CLI_PATH env var is set
  if (
    process.env.KIMI_CLI_PATH &&
    existsSync(process.env.KIMI_CLI_PATH)
  ) {
    console.log(
      `[Kimi] Using KIMI_CLI_PATH: ${process.env.KIMI_CLI_PATH}`
    );
    return process.env.KIMI_CLI_PATH;
  }

  console.warn(
    '[Kimi] Kimi CLI not found. Please install it: pip install kimi-cli'
  );
  return undefined;
}

/**
 * Install Kimi CLI automatically
 * Returns true if installation was successful
 */
export async function installKimiCli(): Promise<boolean> {
  console.log('[Kimi] Attempting to install Kimi CLI...');

  try {
    // Try pip install
    console.log('[Kimi] Installing via pip...');
    execSync('curl -L code.kimi.com/install.sh | bash', {
      encoding: 'utf-8',
      stdio: 'inherit',
    });
    return true;
  } catch (error) {
    console.log('[Kimi] bash failed, trying pip3...');
    console.error('[Kimi] Failed to install Kimi CLI:', error);
    return false;
  }
}

/**
 * Ensure Kimi CLI is available, install if necessary
 */
export async function ensureKimiCli(): Promise<string | undefined> {
  let path = getKimiCliPath();

  if (!path) {
    console.log(
      '[Kimi] Kimi CLI not found, attempting automatic installation...'
    );

    const installed = await installKimiCli();
    if (installed) {
      // Re-check after installation
      path = getKimiCliPath();
    }
  }

  return path;
}

/**
 * Check if running in a packaged app environment
 */
export function isPackagedApp(): boolean {
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