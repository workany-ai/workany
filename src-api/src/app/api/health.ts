import { exec } from 'child_process';
import { existsSync, readdirSync } from 'fs';
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
  try {
    await execAsync(command, {
      env: {
        ...process.env,
        PATH: getExtendedPath(),
      },
      shell: isWindows ? 'cmd.exe' : '/bin/sh',
    });
    return true;
  } catch {
    return false;
  }
}

// Check dependency with fallback to WSL on Windows
async function checkDependency(nativeCommand: string, binaryName: string): Promise<{ installed: boolean; location: 'native' | 'wsl' | null }> {
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
      } else {
        version = await getVersion(dep.versionCommand);
      }
    }

    statuses.push({
      id: dep.id,
      name: dep.name,
      description: dep.description,
      required: dep.required,
      installed,
      version: version ? `${version}${location === 'wsl' ? ' (WSL)' : ''}` : undefined,
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
    } else {
      version = await getVersion(dep.versionCommand);
    }
  }

  return c.json({
    success: true,
    id: dep.id,
    name: dep.name,
    description: dep.description,
    required: dep.required,
    installed,
    version: version ? `${version}${location === 'wsl' ? ' (WSL)' : ''}` : undefined,
    location: location,
    installUrl: dep.installUrl,
  });
});

export default health;
