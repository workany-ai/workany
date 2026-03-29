import { exec } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { arch, platform } from 'os';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { Hono } from 'hono';

const execAsync = promisify(exec);

// Detect platform
const isWindows = process.platform === 'win32';
const pathSeparator = isWindows ? ';' : ':';

const health = new Hono();

health.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ============================================================================
// Dependency Types
// ============================================================================

interface DependencyInfo {
  id: string;
  name: string;
  description: string;
  required: boolean;
  checkCommand: string;
  versionCommand?: string;
  installCommands: {
    npm?: string;
    brew?: string;
    manual?: string;
  };
  installUrl: string;
}

interface DependencyStatus {
  id: string;
  name: string;
  description: string;
  required: boolean;
  installed: boolean;
  version?: string;
  installUrl: string;
}

// ============================================================================
// Supported Dependencies
// ============================================================================

const DEPENDENCIES: DependencyInfo[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Agent Runtime for task processing',
    required: true,
    checkCommand: isWindows ? 'where claude' : 'which claude',
    versionCommand: isWindows
      ? 'claude --version 2>nul || echo unknown'
      : 'claude --version 2>/dev/null || echo "unknown"',
    installCommands: {
      npm: 'npm install -g @anthropic-ai/claude-code',
      brew: 'brew install claude-code',
      manual: 'Visit https://docs.anthropic.com/claude-code/install',
    },
    installUrl:
      'https://docs.anthropic.com/en/docs/claude-code/getting-started',
  },
  {
    id: 'codex',
    name: 'Codex',
    description: 'Sandbox for script execution',
    required: false,
    checkCommand: isWindows ? 'where codex' : 'which codex',
    versionCommand: isWindows
      ? 'codex --version 2>nul || echo unknown'
      : 'codex --version 2>/dev/null || echo "unknown"',
    installCommands: {
      npm: 'npm install -g @openai/codex',
      manual: 'Visit https://github.com/openai/codex-cli',
    },
    installUrl: 'https://github.com/openai/codex-cli',
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

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
 * Check if bundled sidecar Claude Code exists
 * The bundle structure is:
 * - claude-{target} or claude (launcher script)
 * - cli-bundle/
 *   - node (Node.js binary)
 *   - node_modules/@anthropic-ai/claude-code/ (Claude Code package)
 */
function checkSidecarClaudeCode(): boolean {
  const os = platform();
  const targetTriple = getTargetTriple();
  const claudeName =
    os === 'win32' ? `claude-${targetTriple}.exe` : `claude-${targetTriple}`;

  // Get the directory where this process (workany-api) is running from
  const execDir = dirname(process.execPath);

  // Possible locations for the bundled Claude Code launcher
  const possibleLauncherPaths = [
    join(execDir, claudeName),
    join(execDir, 'claude'),
  ];

  // For macOS .app bundles, also check Resources directory
  if (os === 'darwin') {
    const resourcesDir = join(execDir, '..', 'Resources');
    possibleLauncherPaths.push(join(resourcesDir, claudeName));
    possibleLauncherPaths.push(join(resourcesDir, 'claude'));
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

    // Check if cli-bundle directory exists alongside the launcher
    const bundleDir = join(launcherDir, 'cli-bundle');
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
      console.log(`[Health] Found bundled Claude Code at: ${launcherPath}`);
      return true;
    }

    // If launcher exists without bundle dir, it might be a standalone binary
    if (existsSync(launcherPath)) {
      console.log(`[Health] Found Claude Code launcher at: ${launcherPath}`);
      return true;
    }
  }

  // Also try direct check for cli-bundle in common locations
  const bundleLocations = [
    join(execDir, 'cli-bundle'),
    join(execDir, '..', 'Resources', 'cli-bundle'),
    join(execDir, '..', 'Resources', '_up_', 'src-api', 'dist', 'cli-bundle'),
    // Windows: Tauri places resources relative to exe with preserved path structure
    join(execDir, '_up_', 'src-api', 'dist', 'cli-bundle'),
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
      console.log(`[Health] Found bundled Claude Code at: ${bundleDir}`);
      return true;
    }
  }

  return false;
}

// Build extended PATH that includes common package manager bin locations
function getExtendedPath(): string {
  const paths = [process.env.PATH || ''];

  if (isWindows) {
    // Windows paths
    const userProfile = process.env.USERPROFILE || '';
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    paths.push(
      // npm global
      `${appData}\\npm`,
      `${localAppData}\\npm`,
      `${userProfile}\\.npm-global`,
      `${userProfile}\\.npm-global\\bin`,
      // pnpm
      `${localAppData}\\pnpm`,
      `${appData}\\pnpm`,
      // yarn
      `${localAppData}\\Yarn\\bin`,
      `${appData}\\Yarn\\bin`,
      // bun
      `${userProfile}\\.bun\\bin`,
      // volta
      `${userProfile}\\.volta\\bin`,
      `${localAppData}\\Volta\\bin`,
      // Node.js default install locations
      `${programFiles}\\nodejs`,
      `${programFilesX86}\\nodejs`,
      `${userProfile}\\AppData\\Local\\Programs\\node`
    );

    // Add nvm-windows paths
    const nvmHome = process.env.NVM_HOME || `${appData}\\nvm`;
    try {
      if (existsSync(nvmHome)) {
        const versions = readdirSync(nvmHome).filter(v => v.startsWith('v'));
        for (const version of versions) {
          paths.push(`${nvmHome}\\${version}`);
        }
        // Also add nvm symlink path
        const nvmSymlink = process.env.NVM_SYMLINK || `${programFiles}\\nodejs`;
        paths.push(nvmSymlink);
      }
    } catch {
      // nvm-windows not installed
    }

    // Add fnm paths
    const fnmDir = `${localAppData}\\fnm_multishells`;
    try {
      if (existsSync(fnmDir)) {
        const versions = readdirSync(fnmDir);
        for (const version of versions) {
          paths.push(`${fnmDir}\\${version}`);
        }
      }
    } catch {
      // fnm not installed
    }
  } else {
    // Unix/macOS paths
    const home = process.env.HOME || '';
    paths.push(
      '/usr/local/bin',
      '/opt/homebrew/bin',
      `${home}/.local/bin`,
      `${home}/.npm-global/bin`,
      `${home}/.bun/bin`,
      `${home}/.yarn/bin`,
      `${home}/.pnpm-global/bin`,
      `${home}/.volta/bin`,
      `${home}/code/node/npm_global/bin`
    );

    // Add nvm paths
    const nvmDir = `${home}/.nvm/versions/node`;
    try {
      if (existsSync(nvmDir)) {
        const versions = readdirSync(nvmDir);
        for (const version of versions) {
          paths.push(`${nvmDir}/${version}/bin`);
        }
      }
    } catch {
      // nvm not installed
    }
  }

  return paths.join(pathSeparator);
}

// Check if WSL is available on Windows
async function checkWslAvailable(): Promise<boolean> {
  if (!isWindows) return false;
  try {
    await execAsync('wsl --status', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// Check command in WSL
async function checkCommandInWsl(command: string): Promise<boolean> {
  try {
    await execAsync(`wsl -e which ${command}`, { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

async function checkCommand(command: string): Promise<boolean> {
  const extendedEnv = {
    ...process.env,
    PATH: getExtendedPath(),
  };

  try {
    await execAsync(command, {
      env: extendedEnv,
      shell: isWindows ? 'cmd.exe' : '/bin/sh',
    });
    return true;
  } catch {
    // Fallback: try login shell to pick up user's full PATH (e.g. from .bashrc, .zshrc)
    if (!isWindows) {
      const binaryName = command.split(' ').pop() || '';
      try {
        await execAsync(`bash -l -c "which ${binaryName}"`, {
          env: extendedEnv,
          stdio: 'pipe',
        } as Parameters<typeof execAsync>[1]);
        return true;
      } catch {
        try {
          await execAsync(`zsh -l -c "which ${binaryName}"`, {
            env: extendedEnv,
            stdio: 'pipe',
          } as Parameters<typeof execAsync>[1]);
          return true;
        } catch {
          // Not found in any shell
        }
      }
    }
    return false;
  }
}

// Check dependency with fallback to WSL on Windows and sidecar
async function checkDependency(nativeCommand: string, binaryName: string): Promise<{ installed: boolean; location: 'native' | 'wsl' | 'sidecar' | null }> {
  // First try native check
  const nativeInstalled = await checkCommand(nativeCommand);
  if (nativeInstalled) {
    return { installed: true, location: 'native' };
  }

  // On Windows, also check WSL
  if (isWindows) {
    const wslAvailable = await checkWslAvailable();
    if (wslAvailable) {
      const wslInstalled = await checkCommandInWsl(binaryName);
      if (wslInstalled) {
        return { installed: true, location: 'wsl' };
      }
    }
  }

  // Check for bundled sidecar (for claude-code specifically)
  if (binaryName === 'claude') {
    const sidecarInstalled = checkSidecarClaudeCode();
    if (sidecarInstalled) {
      return { installed: true, location: 'sidecar' };
    }
  }

  return { installed: false, location: null };
}

async function getVersion(command: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(command, {
      env: {
        ...process.env,
        PATH: getExtendedPath(),
      },
      shell: isWindows ? 'cmd.exe' : '/bin/sh',
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

async function runInstallCommand(
  command: string
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 120000, // 2 minutes timeout
      env: {
        ...process.env,
        PATH: getExtendedPath(),
      },
      shell: isWindows ? 'cmd.exe' : '/bin/sh',
    });
    return { success: true, output: stdout + stderr };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      output: err.stdout || '',
      error: err.stderr || err.message || 'Unknown error',
    };
  }
}

// ============================================================================
// Endpoints
// ============================================================================

/**
 * Check all dependencies status
 * GET /health/dependencies
 */
health.get('/dependencies', async (c) => {
  const statuses: DependencyStatus[] = [];
  const simpleStatus: Record<string, boolean> = {};

  for (const dep of DEPENDENCIES) {
    // Extract binary name from check command (e.g., 'where claude' -> 'claude')
    const binaryName = dep.checkCommand.split(' ').pop() || '';
    const { installed, location } = await checkDependency(dep.checkCommand, binaryName);
    let version: string | undefined;

    if (installed && dep.versionCommand) {
      // If installed in WSL, get version from WSL
      if (location === 'wsl') {
        version = await getVersion(`wsl -e ${binaryName} --version`);
      } else if (location !== 'sidecar') {
        // Skip version check for sidecar (bundled) as it may not be in PATH
        version = await getVersion(dep.versionCommand);
      }
    }

    // Build version string with location indicator
    let versionString: string | undefined;
    if (version) {
      versionString = location === 'wsl' ? `${version} (WSL)` : version;
    } else if (location === 'sidecar') {
      versionString = '(Bundled)';
    }

    statuses.push({
      id: dep.id,
      name: dep.name,
      description: dep.description,
      required: dep.required,
      installed,
      version: versionString,
      installUrl: dep.installUrl,
    });

    // Build simple status map (claudeCode, node, python, codex)
    const key = dep.id === 'claude-code' ? 'claudeCode' : dep.id;
    simpleStatus[key] = installed;
  }

  // Check if all required dependencies are installed
  const allRequiredInstalled = statuses
    .filter((s) => s.required)
    .every((s) => s.installed);

  return c.json({
    success: true,
    allRequiredInstalled,
    // Simple boolean format for frontend
    ...simpleStatus,
    // Full details
    dependencies: statuses,
  });
});

/**
 * Get install commands for a dependency
 * GET /health/dependencies/:id/install-commands
 */
health.get('/dependencies/:id/install-commands', (c) => {
  const { id } = c.req.param();
  const dep = DEPENDENCIES.find((d) => d.id === id);

  if (!dep) {
    return c.json({ success: false, error: 'Dependency not found' }, 404);
  }

  return c.json({
    success: true,
    id: dep.id,
    name: dep.name,
    commands: dep.installCommands,
    installUrl: dep.installUrl,
  });
});

/**
 * Install a dependency
 * POST /health/dependencies/:id/install
 * Body: { method: 'npm' | 'brew' | 'auto' }
 */
health.post('/dependencies/:id/install', async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<{ method?: 'npm' | 'brew' | 'auto' }>();
  const method = body.method || 'auto';

  const dep = DEPENDENCIES.find((d) => d.id === id);

  if (!dep) {
    return c.json({ success: false, error: 'Dependency not found' }, 404);
  }

  // Determine which command to use
  let command: string | undefined;

  if (method === 'auto') {
    // Try npm first, then brew
    if (dep.installCommands.npm) {
      command = dep.installCommands.npm;
    } else if (dep.installCommands.brew) {
      // Check if brew is available (brew is macOS/Linux only)
      const brewAvailable = !isWindows && await checkCommand('which brew');
      if (brewAvailable) {
        command = dep.installCommands.brew;
      }
    }
  } else {
    command = dep.installCommands[method];
  }

  if (!command) {
    return c.json(
      {
        success: false,
        error: `No ${method} install command available for ${dep.name}`,
        installUrl: dep.installUrl,
      },
      400
    );
  }

  console.log(`[Health] Installing ${dep.name} with command: ${command}`);

  const result = await runInstallCommand(command);

  if (result.success) {
    // Verify installation
    const installed = await checkCommand(dep.checkCommand);
    let version: string | undefined;
    if (installed && dep.versionCommand) {
      version = await getVersion(dep.versionCommand);
    }

    return c.json({
      success: installed,
      installed,
      version,
      output: result.output,
      message: installed
        ? `${dep.name} installed successfully`
        : `Installation completed but ${dep.name} not found in PATH`,
    });
  } else {
    return c.json(
      {
        success: false,
        error: result.error,
        output: result.output,
        installUrl: dep.installUrl,
        message: `Failed to install ${dep.name}. Please install manually.`,
      },
      500
    );
  }
});

/**
 * Check a single dependency
 * GET /health/dependencies/:id
 */
health.get('/dependencies/:id', async (c) => {
  const { id } = c.req.param();
  const dep = DEPENDENCIES.find((d) => d.id === id);

  if (!dep) {
    return c.json({ success: false, error: 'Dependency not found' }, 404);
  }

  const binaryName = dep.checkCommand.split(' ').pop() || '';
  const { installed, location } = await checkDependency(dep.checkCommand, binaryName);
  let version: string | undefined;

  if (installed && dep.versionCommand) {
    if (location === 'wsl') {
      version = await getVersion(`wsl -e ${binaryName} --version`);
    } else if (location !== 'sidecar') {
      // Skip version check for sidecar (bundled) as it may not be in PATH
      version = await getVersion(dep.versionCommand);
    }
  }

  // Build version string with location indicator
  let versionString: string | undefined;
  if (version) {
    versionString = location === 'wsl' ? `${version} (WSL)` : version;
  } else if (location === 'sidecar') {
    versionString = '(Bundled)';
  }

  return c.json({
    success: true,
    id: dep.id,
    name: dep.name,
    description: dep.description,
    required: dep.required,
    installed,
    version: versionString,
    location: location,
    installUrl: dep.installUrl,
  });
});

export default health;
