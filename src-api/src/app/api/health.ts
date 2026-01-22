import { exec } from 'child_process';
import { promisify } from 'util';
import { Hono } from 'hono';

const execAsync = promisify(exec);

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
    description: 'Anthropic CLI for AI-powered coding assistance',
    required: true,
    checkCommand: 'which claude',
    versionCommand: 'claude --version 2>/dev/null || echo "unknown"',
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
    name: 'Codex CLI',
    description: 'OpenAI Codex command-line interface',
    required: false,
    checkCommand: 'which codex',
    versionCommand: 'codex --version 2>/dev/null || echo "unknown"',
    installCommands: {
      npm: 'npm install -g @openai/codex',
      manual: 'Visit https://github.com/openai/codex-cli',
    },
    installUrl: 'https://github.com/openai/codex-cli',
  },
  {
    id: 'node',
    name: 'Node.js',
    description: 'JavaScript runtime for executing scripts',
    required: true,
    checkCommand: 'which node',
    versionCommand: 'node --version',
    installCommands: {
      brew: 'brew install node',
      manual: 'Visit https://nodejs.org',
    },
    installUrl: 'https://nodejs.org',
  },
  {
    id: 'python',
    name: 'Python',
    description: 'Python runtime for executing scripts',
    required: false,
    checkCommand: 'which python3 || which python',
    versionCommand:
      'python3 --version 2>/dev/null || python --version 2>/dev/null',
    installCommands: {
      brew: 'brew install python',
      manual: 'Visit https://python.org',
    },
    installUrl: 'https://python.org',
  },
  {
    id: 'srt',
    name: 'Sandbox Runtime',
    description: 'Anthropic sandbox runtime for secure code execution',
    required: false,
    checkCommand: 'which srt',
    versionCommand: 'srt --version 2>/dev/null || echo "unknown"',
    installCommands: {
      npm: 'npm install -g @anthropic-ai/sandbox-runtime',
    },
    installUrl: 'https://github.com/anthropics/sandbox-runtime',
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

// Build extended PATH that includes common package manager bin locations
function getExtendedPath(): string {
  const home = process.env.HOME || '';
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
  const nvmDir = `${home}/.nvm/versions/node`;
  try {
    const fs = require('fs');
    if (fs.existsSync(nvmDir)) {
      const versions = fs.readdirSync(nvmDir);
      for (const version of versions) {
        paths.push(`${nvmDir}/${version}/bin`);
      }
    }
  } catch {
    // nvm not installed
  }

  return paths.join(':');
}

async function checkCommand(command: string): Promise<boolean> {
  try {
    await execAsync(command, {
      env: {
        ...process.env,
        PATH: getExtendedPath(),
      },
    });
    return true;
  } catch {
    return false;
  }
}

async function getVersion(command: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(command, {
      env: {
        ...process.env,
        PATH: getExtendedPath(),
      },
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
    const installed = await checkCommand(dep.checkCommand);
    let version: string | undefined;

    if (installed && dep.versionCommand) {
      version = await getVersion(dep.versionCommand);
    }

    statuses.push({
      id: dep.id,
      name: dep.name,
      description: dep.description,
      required: dep.required,
      installed,
      version,
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
      // Check if brew is available
      const brewAvailable = await checkCommand('which brew');
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

  const installed = await checkCommand(dep.checkCommand);
  let version: string | undefined;

  if (installed && dep.versionCommand) {
    version = await getVersion(dep.versionCommand);
  }

  return c.json({
    success: true,
    id: dep.id,
    name: dep.name,
    description: dep.description,
    required: dep.required,
    installed,
    version,
    installUrl: dep.installUrl,
  });
});

export default health;
