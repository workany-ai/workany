/**
 * Preview Service
 *
 * Manages Vite dev server preview instances for live preview with HMR support.
 * Requires system Node.js/npm - Live Preview is only available when Node.js is installed.
 * Users without Node.js can still use Static Preview.
 */

import { execSync } from 'child_process';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface PreviewConfig {
  taskId: string;
  workDir: string; // Host path: ~/.workany/sessions/{taskId}
  port?: number; // Preferred port (auto-assign if unavailable)
}

export interface PreviewStatus {
  id: string;
  taskId: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  url?: string; // e.g., http://localhost:5173
  hostPort?: number;
  error?: string;
  startedAt?: Date;
  lastAccessedAt?: Date;
}

interface PreviewInstance {
  id: string;
  taskId: string;
  port: number;
  status: PreviewStatus['status'];
  error?: string;
  startedAt: Date;
  lastAccessedAt: Date;
  healthCheckInterval?: ReturnType<typeof setInterval>;
  idleTimeout?: ReturnType<typeof setTimeout>;
  process?: ReturnType<typeof import('child_process').spawn>;
}

/**
 * Check if system Node.js is available
 * Live Preview requires system Node.js - it's not bundled with the app
 * Users without Node.js can still use Static Preview
 */
export function isNodeAvailable(): boolean {
  try {
    execSync('node --version', { stdio: 'pipe' });
    execSync('npm --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Default Vite config for zero-config support
const DEFAULT_PACKAGE_JSON = {
  name: 'preview',
  type: 'module',
  scripts: {
    dev: 'vite',
  },
  devDependencies: {
    vite: '~5.4.0', // Pin to Vite 5.4.x to avoid breaking changes
  },
};

// Vite config will be generated dynamically with the correct port
function generateViteConfig(port: number): string {
  return `export default {
  server: {
    host: '0.0.0.0',
    port: ${port},
    strictPort: true,
    watch: {
      usePolling: true,
    },
  },
  appType: 'mpa',
}`;
}

// Port range for preview servers
const PORT_RANGE_START = 5173;
const PORT_RANGE_END = 5273;
const MAX_CONCURRENT_PREVIEWS = 5;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const HEALTH_CHECK_INTERVAL_MS = 10 * 1000; // 10 seconds
const STARTUP_TIMEOUT_MS = 120 * 1000; // 120 seconds (2 minutes) for npm install + vite start

/**
 * PreviewManager - Manages Vite dev server instances
 */
export class PreviewManager {
  private instances: Map<string, PreviewInstance> = new Map();
  private usedPorts: Set<number> = new Set();

  constructor() {
    // Cleanup on process exit
    process.on('SIGTERM', () => this.stopAll());
    process.on('SIGINT', () => this.stopAll());
  }

  /**
   * Start a Vite preview server for the given task
   */
  async startPreview(config: PreviewConfig): Promise<PreviewStatus> {
    const { taskId, workDir, port: preferredPort } = config;

    // Check if already running
    const existing = this.instances.get(taskId);
    if (existing && existing.status === 'running') {
      existing.lastAccessedAt = new Date();
      this.resetIdleTimeout(existing);
      return this.getStatusForInstance(existing);
    }

    // Check max concurrent previews
    const runningCount = Array.from(this.instances.values()).filter(
      (i) => i.status === 'running' || i.status === 'starting'
    ).length;

    if (runningCount >= MAX_CONCURRENT_PREVIEWS) {
      // Try to stop the oldest idle preview
      const oldestIdle = this.findOldestIdlePreview();
      if (oldestIdle) {
        await this.stopPreview(oldestIdle.taskId);
      } else {
        return {
          id: `preview-${taskId}`,
          taskId,
          status: 'error',
          error: `Maximum concurrent previews (${MAX_CONCURRENT_PREVIEWS}) reached. Please stop an existing preview first.`,
        };
      }
    }

    // Allocate port
    const port = this.allocatePort(preferredPort);
    if (!port) {
      return {
        id: `preview-${taskId}`,
        taskId,
        status: 'error',
        error: 'No available ports in range 5173-5273',
      };
    }

    // Create instance
    const instance: PreviewInstance = {
      id: `preview-${taskId}`,
      taskId,
      port,
      status: 'starting',
      startedAt: new Date(),
      lastAccessedAt: new Date(),
    };

    this.instances.set(taskId, instance);

    // Start the server asynchronously
    this.startViteServer(instance, workDir).catch((error) => {
      console.error(`[Preview] Failed to start preview for ${taskId}:`, error);
      instance.status = 'error';
      instance.error = error instanceof Error ? error.message : String(error);
      this.releasePort(port);
    });

    return this.getStatusForInstance(instance);
  }

  /**
   * Start the Vite server
   */
  private async startViteServer(
    instance: PreviewInstance,
    workDir: string
  ): Promise<void> {
    try {
      // Ensure project files exist (zero-config support)
      await this.ensureProjectFiles(workDir, instance.port);

      console.log(
        `[Preview] Starting Vite server for ${instance.taskId} on port ${instance.port}`
      );

      await this.startViteProcess(instance, workDir);
    } catch (error) {
      console.error(`[Preview] Error starting Vite server:`, error);
      instance.status = 'error';
      instance.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Start Vite process
   */
  private async startViteProcess(
    instance: PreviewInstance,
    workDir: string
  ): Promise<void> {
    const { spawn } = await import('child_process');

    // Install dependencies if vite is not installed
    const viteBinPath = path.join(workDir, 'node_modules', '.bin', 'vite');
    let needsInstall = false;

    try {
      await fs.access(viteBinPath);
      console.log('[Preview] Vite already installed, skipping npm install');
    } catch {
      needsInstall = true;
    }

    if (needsInstall) {
      console.log('[Preview] Vite not found, installing dependencies...');
      const installStart = Date.now();

      // Use system npm (Live Preview requires Node.js to be installed)
      console.log('[Preview] Running: npm install');

      await new Promise<void>((resolve, reject) => {
        const npmInstall = spawn('npm', ['install'], {
          cwd: workDir,
          shell: true,
          stdio: 'pipe',
        });

        let stderr = '';

        npmInstall.stdout?.on('data', (data) => {
          // Log progress
          const line = data.toString().trim();
          if (line) {
            console.log(`[Preview:npm] ${line}`);
          }
        });

        npmInstall.stderr?.on('data', (data) => {
          stderr += data.toString();
          // npm often outputs to stderr even for non-errors
          const line = data.toString().trim();
          if (line) {
            console.log(`[Preview:npm] ${line}`);
          }
        });

        // Set a timeout for npm install (2 minutes)
        const timeout = setTimeout(() => {
          npmInstall.kill();
          reject(new Error('npm install timed out after 2 minutes'));
        }, 120000);

        npmInstall.on('close', (code) => {
          clearTimeout(timeout);
          const elapsed = ((Date.now() - installStart) / 1000).toFixed(1);
          if (code === 0) {
            console.log(`[Preview] npm install completed in ${elapsed}s`);
            resolve();
          } else {
            reject(
              new Error(`npm install failed (exit code ${code}): ${stderr}`)
            );
          }
        });

        npmInstall.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    }

    // Start Vite
    console.log(
      `[Preview] Starting Vite dev server on port ${instance.port}...`
    );

    // Run Vite using system Node.js (Live Preview requires Node.js to be installed)
    const viteCliPath = path.join(
      workDir,
      'node_modules',
      'vite',
      'bin',
      'vite.js'
    );

    let viteCmd: string;
    let viteArgs: string[];

    if (fsSync.existsSync(viteCliPath)) {
      // Run local Vite directly with node
      viteCmd = 'node';
      viteArgs = [viteCliPath];
      console.log(`[Preview] Running: node ${viteCliPath}`);
    } else {
      // Fallback to npx
      viteCmd = 'npx';
      viteArgs = ['vite'];
      console.log('[Preview] Running: npx vite');
    }

    const viteProcess = spawn(viteCmd, viteArgs, {
      cwd: workDir,
      shell: true,
      stdio: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    instance.process = viteProcess;

    // Log output for debugging
    viteProcess.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`[Preview:vite] ${output}`);
      }
    });

    viteProcess.stderr?.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`[Preview:vite] ${output}`);
      }
    });

    viteProcess.on('close', (code) => {
      if (instance.status === 'running' || instance.status === 'starting') {
        console.log(`[Preview] Vite process exited with code ${code}`);
        instance.status = 'stopped';
        this.cleanup(instance);
      }
    });

    viteProcess.on('error', (error) => {
      console.error(`[Preview] Vite process error:`, error);
      instance.status = 'error';
      instance.error = error.message;
      this.cleanup(instance);
    });

    // Wait for server to be ready
    const isReady = await this.waitForServerReady(instance.port);
    if (isReady) {
      instance.status = 'running';
      this.startHealthCheck(instance);
      this.resetIdleTimeout(instance);
      console.log(
        `[Preview] Vite server running at http://localhost:${instance.port}`
      );
    } else {
      instance.status = 'error';
      instance.error = 'Server failed to start within timeout';
      viteProcess.kill();
      this.cleanup(instance);
    }
  }

  /**
   * Wait for the server to be ready
   */
  private async waitForServerReady(
    port: number,
    timeout: number = STARTUP_TIMEOUT_MS
  ): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 1000; // Check every 1 second
    let attempts = 0;

    console.log(
      `[Preview] Waiting for server on port ${port} (timeout: ${timeout / 1000}s)...`
    );

    while (Date.now() - startTime < timeout) {
      attempts++;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(`http://localhost:${port}`, {
          method: 'GET',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok || response.status === 404) {
          // 404 is OK - means server is running but no index.html
          console.log(
            `[Preview] Server ready on port ${port} after ${attempts} attempts (${((Date.now() - startTime) / 1000).toFixed(1)}s)`
          );
          return true;
        }
      } catch {
        // Server not ready yet - only log every 10 attempts
        if (attempts % 10 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(
            `[Preview] Still waiting for server... (${elapsed}s elapsed, ${attempts} attempts)`
          );
        }
      }
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    console.log(
      `[Preview] Server failed to start within ${timeout / 1000}s (${attempts} attempts)`
    );
    return false;
  }

  /**
   * Ensure project has required files for Vite
   */
  private async ensureProjectFiles(
    workDir: string,
    port: number
  ): Promise<void> {
    // Check and create package.json
    const packageJsonPath = path.join(workDir, 'package.json');
    try {
      await fs.access(packageJsonPath);
      console.log('[Preview] package.json exists');
    } catch {
      console.log('[Preview] Creating default package.json');
      await fs.writeFile(
        packageJsonPath,
        JSON.stringify(DEFAULT_PACKAGE_JSON, null, 2)
      );
    }

    // Always write vite.config.js with the correct port
    // First, remove any existing vite.config.ts to avoid conflicts (JS config takes precedence)
    const viteConfigTsPath = path.join(workDir, 'vite.config.ts');
    const viteConfigMtsPath = path.join(workDir, 'vite.config.mts');
    const viteConfigMjsPath = path.join(workDir, 'vite.config.mjs');

    // Remove TypeScript/ESM config files that might override our JS config
    for (const configPath of [
      viteConfigTsPath,
      viteConfigMtsPath,
      viteConfigMjsPath,
    ]) {
      try {
        await fs.unlink(configPath);
        console.log(`[Preview] Removed conflicting config: ${configPath}`);
      } catch {
        // File doesn't exist, ignore
      }
    }

    const viteConfigPath = path.join(workDir, 'vite.config.js');
    console.log(`[Preview] Writing vite.config.js with port ${port}`);
    await fs.writeFile(viteConfigPath, generateViteConfig(port));

    // Ensure index.html exists - create a minimal one if not
    const indexHtmlPath = path.join(workDir, 'index.html');
    try {
      await fs.access(indexHtmlPath);
      console.log('[Preview] index.html exists');
    } catch {
      // Look for any HTML file
      const files = await fs.readdir(workDir);
      const htmlFile = files.find((f) => f.endsWith('.html'));
      if (htmlFile && htmlFile !== 'index.html') {
        // Create index.html that redirects to the found HTML file
        const redirectHtml = `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="refresh" content="0; url='./${htmlFile}'">
</head>
<body>
  <p>Redirecting to <a href="./${htmlFile}">${htmlFile}</a>...</p>
</body>
</html>`;
        await fs.writeFile(indexHtmlPath, redirectHtml);
        console.log(`[Preview] Created index.html redirecting to ${htmlFile}`);
      } else {
        console.log('[Preview] Warning: No HTML file found in workDir');
      }
    }
  }

  /**
   * Stop a preview server
   */
  async stopPreview(taskId: string): Promise<PreviewStatus> {
    const instance = this.instances.get(taskId);
    if (!instance) {
      return {
        id: `preview-${taskId}`,
        taskId,
        status: 'stopped',
      };
    }

    console.log(`[Preview] Stopping preview for ${taskId}`);
    await this.cleanup(instance);
    instance.status = 'stopped';

    return this.getStatusForInstance(instance);
  }

  /**
   * Get status of a preview server
   */
  getStatus(taskId: string): PreviewStatus {
    const instance = this.instances.get(taskId);
    if (!instance) {
      return {
        id: `preview-${taskId}`,
        taskId,
        status: 'stopped',
      };
    }

    // Update last accessed time
    instance.lastAccessedAt = new Date();
    this.resetIdleTimeout(instance);

    return this.getStatusForInstance(instance);
  }

  /**
   * Stop all preview servers
   */
  async stopAll(): Promise<void> {
    console.log('[Preview] Stopping all preview servers...');
    const stopPromises = Array.from(this.instances.keys()).map((taskId) =>
      this.stopPreview(taskId)
    );
    await Promise.all(stopPromises);
    console.log('[Preview] All preview servers stopped');
  }

  /**
   * Allocate an available port
   */
  private allocatePort(preferred?: number): number | null {
    if (preferred && !this.usedPorts.has(preferred)) {
      if (preferred >= PORT_RANGE_START && preferred <= PORT_RANGE_END) {
        this.usedPorts.add(preferred);
        return preferred;
      }
    }

    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }

    return null;
  }

  /**
   * Release a port
   */
  private releasePort(port: number): void {
    this.usedPorts.delete(port);
  }

  /**
   * Start health check for an instance
   */
  private startHealthCheck(instance: PreviewInstance): void {
    if (instance.healthCheckInterval) {
      clearInterval(instance.healthCheckInterval);
    }

    instance.healthCheckInterval = setInterval(async () => {
      if (instance.status !== 'running') {
        return;
      }

      try {
        const response = await fetch(`http://localhost:${instance.port}`, {
          method: 'HEAD',
        });
        if (!response.ok && response.status !== 404) {
          throw new Error(`Health check failed: ${response.status}`);
        }
      } catch (error) {
        console.log(
          `[Preview] Health check failed for ${instance.taskId}:`,
          error
        );
        instance.status = 'error';
        instance.error = 'Server health check failed';
        this.cleanup(instance);
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Reset idle timeout for an instance
   */
  private resetIdleTimeout(instance: PreviewInstance): void {
    if (instance.idleTimeout) {
      clearTimeout(instance.idleTimeout);
    }

    instance.idleTimeout = setTimeout(() => {
      console.log(`[Preview] Idle timeout reached for ${instance.taskId}`);
      this.stopPreview(instance.taskId);
    }, IDLE_TIMEOUT_MS);
  }

  /**
   * Find the oldest idle preview
   */
  private findOldestIdlePreview(): PreviewInstance | null {
    let oldest: PreviewInstance | null = null;
    let oldestTime = Date.now();

    for (const instance of this.instances.values()) {
      if (
        instance.status === 'running' &&
        instance.lastAccessedAt.getTime() < oldestTime
      ) {
        oldest = instance;
        oldestTime = instance.lastAccessedAt.getTime();
      }
    }

    return oldest;
  }

  /**
   * Cleanup an instance
   */
  private async cleanup(instance: PreviewInstance): Promise<void> {
    if (instance.healthCheckInterval) {
      clearInterval(instance.healthCheckInterval);
      instance.healthCheckInterval = undefined;
    }

    if (instance.idleTimeout) {
      clearTimeout(instance.idleTimeout);
      instance.idleTimeout = undefined;
    }

    if (instance.process) {
      try {
        instance.process.kill('SIGTERM');
      } catch (error) {
        console.error(`[Preview] Error killing process:`, error);
      }
      instance.process = undefined;
    }

    this.releasePort(instance.port);
    this.instances.delete(instance.taskId);
  }

  /**
   * Get status object for an instance
   */
  private getStatusForInstance(instance: PreviewInstance): PreviewStatus {
    return {
      id: instance.id,
      taskId: instance.taskId,
      status: instance.status,
      url:
        instance.status === 'running'
          ? `http://localhost:${instance.port}`
          : undefined,
      hostPort: instance.port,
      error: instance.error,
      startedAt: instance.startedAt,
      lastAccessedAt: instance.lastAccessedAt,
    };
  }
}

// Global preview manager instance
let globalPreviewManager: PreviewManager | null = null;

/**
 * Get the global preview manager instance
 */
export function getPreviewManager(): PreviewManager {
  if (!globalPreviewManager) {
    globalPreviewManager = new PreviewManager();
  }
  return globalPreviewManager;
}
