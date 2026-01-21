/**
 * Sandbox API Routes
 *
 * Provides HTTP endpoints for sandbox execution operations.
 * Uses the extensible sandbox provider system.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import {
  getBestProvider,
  getSandboxInfo,
  getSandboxProvider,
  initSandbox,
  SANDBOX_IMAGES,
  stopAllSandboxProviders,
  type SandboxExecOptions,
  type SandboxProviderType,
  type ScriptOptions,
} from '@/core/sandbox/index';

const sandbox = new Hono();

// Initialize sandbox module on first request
let initialized = false;
async function ensureInitialized() {
  if (!initialized) {
    await initSandbox();
    initialized = true;
  }
}

/**
 * Get sandbox provider with fallback to native if preferred provider fails
 */
async function getProviderWithFallback(
  preferredProvider?: SandboxProviderType
): Promise<{ provider: Awaited<ReturnType<typeof getSandboxProvider>>; usedFallback: boolean }> {
  console.log(`[Sandbox] getProviderWithFallback called with: ${preferredProvider || 'auto'}`);

  if (!preferredProvider) {
    console.log(`[Sandbox] No preferred provider, using getBestProvider()`);
    return { provider: await getBestProvider(), usedFallback: false };
  }

  try {
    console.log(`[Sandbox] Attempting to get provider: ${preferredProvider}`);
    const provider = await getSandboxProvider(preferredProvider);
    console.log(`[Sandbox] Got provider instance, checking availability...`);

    // Check if provider is available
    const isAvailable = await provider.isAvailable();
    console.log(`[Sandbox] Provider ${preferredProvider} isAvailable: ${isAvailable}`);

    if (isAvailable) {
      console.log(`[Sandbox] ✅ Using provider: ${preferredProvider}`);
      return { provider, usedFallback: false };
    }
    console.log(`[Sandbox] ⚠️ Provider ${preferredProvider} not available, falling back to native`);
  } catch (error) {
    console.log(`[Sandbox] ❌ Failed to get provider ${preferredProvider}:`, error);
  }

  // Fallback to native
  console.log(`[Sandbox] Using native fallback`);
  const nativeProvider = await getSandboxProvider('native');
  return { provider: nativeProvider, usedFallback: true };
}

/**
 * Debug endpoint to check codex paths
 */
sandbox.get('/debug/codex-paths', async (c) => {
  const os = await import('os');
  const path = await import('path');
  const fs = await import('fs');

  const platform = os.platform();
  const arch = process.arch;
  const execDir = process.execPath ? path.dirname(process.execPath) : '';

  // Target triple
  let targetTriple = '';
  if (platform === 'darwin') {
    targetTriple = arch === 'arm64' ? '-aarch64-apple-darwin' : '-x86_64-apple-darwin';
  } else if (platform === 'linux') {
    targetTriple = '-x86_64-unknown-linux-gnu';
  } else if (platform === 'win32') {
    targetTriple = '-x86_64-pc-windows-msvc';
  }

  const pathsToCheck = [
    path.join(execDir, `codex${targetTriple}`),
    path.join(execDir, 'codex'),
    path.join(execDir, '..', 'Resources', 'cli-bundle', 'node'),
    path.join(execDir, 'cli-bundle', 'node'),
    // Legacy paths
    path.join(execDir, '..', 'Resources', 'codex-bundle', 'node'),
    path.join(execDir, 'codex-bundle', 'node'),
    '/usr/local/bin/codex',
  ];

  const results = pathsToCheck.map(p => ({
    path: p,
    exists: fs.existsSync(p),
  }));

  return c.json({
    platform,
    arch,
    execDir,
    targetTriple,
    execPath: process.execPath,
    cwd: process.cwd(),
    pathsChecked: results,
  });
});

/**
 * Check if sandbox is available on this platform
 * Returns detailed info about which provider is being used
 */
sandbox.get('/available', async (c) => {
  await ensureInitialized();
  const info = await getSandboxInfo();

  return c.json({
    available: info.available,
    provider: info.provider,
    providerName: info.providerName,
    isolation: info.isolation,
    mode:
      info.isolation === 'vm'
        ? 'vm'
        : info.isolation === 'container'
          ? 'container'
          : 'fallback',
    message: info.message,
    usedFallback: info.usedFallback,
    fallbackReason: info.fallbackReason,
  });
});

/**
 * Get available sandbox images
 */
sandbox.get('/images', (c) => {
  return c.json({
    images: SANDBOX_IMAGES,
    default: SANDBOX_IMAGES.node,
  });
});

/**
 * Execute a command in sandbox
 */
sandbox.post('/exec', async (c) => {
  try {
    await ensureInitialized();

    const body = await c.req.json<{
      command: string;
      args?: string[];
      image?: string;
      cwd?: string;
      env?: Record<string, string>;
      provider?: SandboxProviderType;
      timeout?: number;
    }>();

    const {
      command,
      args = [],
      image,
      cwd,
      env,
      provider: preferredProvider,
      timeout,
    } = body;

    if (!command) {
      return c.json({ error: 'Command is required' }, 400);
    }

    // Get the appropriate provider with fallback
    const { provider: sandboxProvider, usedFallback } = await getProviderWithFallback(preferredProvider);
    if (usedFallback) {
      console.log(`[Sandbox] Using native fallback for exec`);
    }

    const execOptions: SandboxExecOptions = {
      command,
      args,
      cwd: cwd || '/workspace',
      env,
      image: image || SANDBOX_IMAGES.node,
      timeout,
    };

    const result = await sandboxProvider.exec(execOptions);
    const caps = sandboxProvider.getCapabilities();
    const isolationLabel = caps.isolation === 'vm'
      ? 'VM 硬件隔离'
      : caps.isolation === 'container'
      ? '容器隔离'
      : caps.isolation === 'process'
      ? '进程隔离'
      : '无隔离';

    return c.json({
      success: result.exitCode === 0,
      provider: sandboxProvider.type,
      providerName: sandboxProvider.name,
      providerInfo: {
        type: sandboxProvider.type,
        name: sandboxProvider.name,
        isolation: caps.isolation,
        isolationLabel,
      },
      ...result,
    });
  } catch (error) {
    console.error('[Sandbox] Exec error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        stdout: '',
        stderr: String(error),
        duration: 0,
      },
      500
    );
  }
});

/**
 * Run a script file in sandbox with auto-detected runtime
 */
sandbox.post('/run/file', async (c) => {
  try {
    await ensureInitialized();

    const body = await c.req.json<{
      filePath: string;
      args?: string[];
      workDir: string;
      env?: Record<string, string>;
      packages?: string[];
      provider?: SandboxProviderType;
      timeout?: number;
    }>();

    const {
      filePath,
      args = [],
      workDir,
      env,
      packages,
      provider: preferredProvider,
      timeout,
    } = body;

    if (!filePath || !workDir) {
      return c.json({ error: 'filePath and workDir are required' }, 400);
    }

    // Detect runtime from file extension
    const ext = filePath.split('.').pop()?.toLowerCase();
    let runtime = 'node';

    if (ext === 'py') {
      runtime = 'python';
    } else if (ext === 'ts' || ext === 'mts') {
      runtime = 'bun';
    }

    console.log(`[Sandbox] Running file: ${filePath}`);
    console.log(`[Sandbox] Working directory: ${workDir}`);
    console.log(`[Sandbox] Runtime: ${runtime}`);

    // Packages that require network access
    const networkPackages = [
      'requests',
      'httpx',
      'aiohttp',
      'urllib3',
      'beautifulsoup4',
      'bs4',
      'scrapy',
      'selenium',
      'playwright',
      'httplib2',
      'pycurl',
      'axios',
      'node-fetch',
      'got',
      'superagent',
      'puppeteer',
    ];

    // Auto-detect if network packages are used - if so, use native provider
    // because codex sandbox blocks all network connections
    const needsNetwork = packages?.some((pkg) =>
      networkPackages.some((np) => pkg.toLowerCase().includes(np))
    );

    let effectiveProvider = preferredProvider;
    if (!preferredProvider && needsNetwork) {
      console.log(
        `[Sandbox] Network packages detected, using native provider for proxy support`
      );
      effectiveProvider = 'native';
    }

    // Get the appropriate provider with fallback
    // Note: Sandbox cannot write files to host - scripts should output to stdout
    // and agent will use Write tool to save results
    const { provider: sandboxProvider, usedFallback } = await getProviderWithFallback(effectiveProvider);
    if (usedFallback) {
      console.log(`[Sandbox] Using native fallback for run/file`);
    }

    // Set up volume mounts if the provider supports it
    if (sandboxProvider.setVolumes) {
      sandboxProvider.setVolumes([
        {
          hostPath: workDir,
          guestPath: '/workspace',
          readOnly: false,
        },
      ]);
    }

    const scriptOptions: ScriptOptions = {
      args,
      env,
      packages,
      timeout: timeout || 120000,
    };

    const result = await sandboxProvider.runScript(
      filePath,
      workDir,
      scriptOptions
    );

    const caps = sandboxProvider.getCapabilities();
    const isolationLabel = caps.isolation === 'vm'
      ? 'VM 硬件隔离'
      : caps.isolation === 'container'
      ? '容器隔离'
      : caps.isolation === 'process'
      ? '进程隔离'
      : '无隔离';

    return c.json({
      success: result.exitCode === 0,
      runtime,
      provider: sandboxProvider.type,
      providerName: sandboxProvider.name,
      providerInfo: {
        type: sandboxProvider.type,
        name: sandboxProvider.name,
        isolation: caps.isolation,
        isolationLabel,
      },
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: result.duration,
    });
  } catch (error) {
    console.error('[Sandbox] File run error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        stdout: '',
        stderr: String(error),
        duration: 0,
      },
      500
    );
  }
});

/**
 * Run a Node.js script content in sandbox
 */
sandbox.post('/run/node', async (c) => {
  try {
    await ensureInitialized();

    const body = await c.req.json<{
      script: string;
      packages?: string[];
      cwd?: string;
      env?: Record<string, string>;
      provider?: SandboxProviderType;
      timeout?: number;
    }>();

    const {
      script,
      packages,
      cwd,
      env,
      provider: preferredProvider,
      timeout,
    } = body;

    if (!script) {
      return c.json({ error: 'Script content is required' }, 400);
    }

    // Get the appropriate provider with fallback
    const { provider: sandboxProvider } = await getProviderWithFallback(preferredProvider);

    // Write script to a temp file first
    const workDir = cwd || '/tmp';
    const scriptPath = `${workDir}/temp_script_${Date.now()}.js`;

    // Write the script using exec
    const writeResult = await sandboxProvider.exec({
      command: 'sh',
      args: ['-c', `echo '${script.replace(/'/g, "'\\''")}' > ${scriptPath}`],
      cwd: workDir,
    });

    if (writeResult.exitCode !== 0) {
      return c.json(
        {
          success: false,
          error: 'Failed to write script file',
          exitCode: 1,
          stdout: '',
          stderr: writeResult.stderr,
          duration: 0,
        },
        500
      );
    }

    // Run the script
    const result = await sandboxProvider.runScript(scriptPath, workDir, {
      env,
      packages,
      timeout: timeout || 120000,
    });

    return c.json({
      success: result.exitCode === 0,
      provider: sandboxProvider.type,
      ...result,
    });
  } catch (error) {
    console.error('[Sandbox] Node run error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        stdout: '',
        stderr: String(error),
        duration: 0,
      },
      500
    );
  }
});

/**
 * Stream execution output (for long-running commands)
 */
sandbox.post('/exec/stream', async (c) => {
  await ensureInitialized();

  const body = await c.req.json<{
    command: string;
    args?: string[];
    image?: string;
    cwd?: string;
    env?: Record<string, string>;
    provider?: SandboxProviderType;
  }>();

  const {
    command,
    args = [],
    image,
    cwd,
    env,
    provider: preferredProvider,
  } = body;

  if (!command) {
    return c.json({ error: 'Command is required' }, 400);
  }

  return streamSSE(c, async (stream) => {
    try {
      const { provider: sandboxProvider } = await getProviderWithFallback(preferredProvider);

      const caps = sandboxProvider.getCapabilities();
      const isolationLabel = caps.isolation === 'vm'
        ? 'VM 硬件隔离'
        : caps.isolation === 'container'
        ? '容器隔离'
        : caps.isolation === 'process'
        ? '进程隔离'
        : '无隔离';

      await stream.writeSSE({
        data: JSON.stringify({
          type: 'started',
          provider: sandboxProvider.type,
          providerName: sandboxProvider.name,
          providerInfo: {
            type: sandboxProvider.type,
            name: sandboxProvider.name,
            isolation: caps.isolation,
            isolationLabel,
          },
        }),
      });

      const result = await sandboxProvider.exec({
        command,
        args,
        cwd: cwd || '/workspace',
        env,
        image: image || SANDBOX_IMAGES.node,
      });

      // Stream stdout line by line
      if (result.stdout) {
        for (const line of result.stdout.split('\n')) {
          await stream.writeSSE({
            data: JSON.stringify({ type: 'stdout', content: line }),
          });
        }
      }

      // Stream stderr line by line
      if (result.stderr) {
        for (const line of result.stderr.split('\n')) {
          await stream.writeSSE({
            data: JSON.stringify({ type: 'stderr', content: line }),
          });
        }
      }

      await stream.writeSSE({
        data: JSON.stringify({
          type: 'done',
          exitCode: result.exitCode,
          duration: result.duration,
        }),
      });
    } catch (error) {
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
      });
    }
  });
});

/**
 * Stop all sandbox providers
 */
sandbox.post('/stop-all', async (c) => {
  try {
    await stopAllSandboxProviders();
    return c.json({ success: true, message: 'All sandbox providers stopped' });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

export { sandbox as sandboxRoutes };
