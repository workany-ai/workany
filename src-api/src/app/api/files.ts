/**
 * Files API Routes
 *
 * Provides HTTP endpoints for file system operations.
 * Uses Node.js fs module for reliable filesystem access.
 */

import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import { Hono } from 'hono';

import {
  getAllSkillsDirs,
  getHomeDir,
  getWorkanySkillsDir,
} from '@/config/constants';

const execAsync = promisify(exec);

const files = new Hono();

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileEntry[];
}

/**
 * Common files/folders to ignore (similar to .gitignore patterns)
 */
const IGNORED_NAMES = new Set([
  // Dependencies
  'node_modules',
  'bower_components',
  'jspm_packages',
  'vendor',
  '__pycache__',
  '.pnpm',

  // Build outputs
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.output',
  '.vercel',
  '.netlify',

  // Cache directories
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.swc',
  '.eslintcache',
  '.stylelintcache',

  // IDE/Editor
  '.idea',
  '.vscode',
  '.vs',
  '*.sublime-*',

  // OS files
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',

  // Logs
  'logs',
  '*.log',
  'npm-debug.log*',
  'yarn-debug.log*',
  'yarn-error.log*',

  // Environment/secrets
  '.env.local',
  '.env.*.local',

  // Test coverage
  'coverage',
  '.nyc_output',

  // Temporary files
  'tmp',
  'temp',
  '.tmp',
  '.temp',

  // Lock files (optional, but often noisy)
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'Cargo.lock',
]);

/**
 * Check if a file/folder should be ignored
 */
function shouldIgnore(name: string): boolean {
  // Skip hidden files/folders (starting with .)
  if (name.startsWith('.')) return true;

  // Check exact match
  if (IGNORED_NAMES.has(name)) return true;

  // Check pattern matches (for wildcards like *.log)
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith('.log')) return true;
  if (lowerName.endsWith('.lock')) return true;
  if (lowerName.startsWith('npm-debug')) return true;
  if (lowerName.startsWith('yarn-debug')) return true;
  if (lowerName.startsWith('yarn-error')) return true;

  return false;
}

/**
 * Recursively read a directory
 */
async function readDirRecursive(
  dirPath: string,
  depth: number = 0,
  maxDepth: number = 3
): Promise<FileEntry[]> {
  if (depth > maxDepth) return [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files: FileEntry[] = [];

    for (const entry of entries) {
      // Skip ignored files/folders
      if (shouldIgnore(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);
      const isDirectory = entry.isDirectory();

      const file: FileEntry = {
        name: entry.name,
        path: fullPath,
        isDir: isDirectory,
      };

      // Recursively read subdirectories
      if (isDirectory && depth < maxDepth) {
        try {
          file.children = await readDirRecursive(fullPath, depth + 1, maxDepth);
        } catch {
          file.children = [];
        }
      }

      files.push(file);
    }

    // Sort: directories first, then by name
    return files.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    console.error(`[Files API] Failed to read ${dirPath}:`, err);
    return [];
  }
}

/**
 * Read directory contents recursively
 * POST /files/readdir
 * Body: { path: string, maxDepth?: number }
 */
files.post('/readdir', async (c) => {
  try {
    const body = await c.req.json<{
      path: string;
      maxDepth?: number;
    }>();

    const { path: dirPath, maxDepth = 3 } = body;

    if (!dirPath) {
      return c.json({ error: 'Path is required' }, 400);
    }

    // Security check: only allow reading from home directory
    const homedir = process.env.HOME || process.env.USERPROFILE || '';
    if (!dirPath.startsWith(homedir) && !dirPath.startsWith('/tmp')) {
      return c.json(
        { error: 'Access denied: path must be within home directory' },
        403
      );
    }

    // Check if directory exists
    try {
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) {
        return c.json({ error: 'Path is not a directory' }, 400);
      }
    } catch {
      return c.json({ error: 'Directory does not exist', files: [] }, 200);
    }

    const files = await readDirRecursive(dirPath, 0, maxDepth);

    return c.json({
      success: true,
      path: dirPath,
      files,
    });
  } catch (error) {
    console.error('[Files API] Error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        files: [],
      },
      500
    );
  }
});

/**
 * Check if a path exists and get its type
 * POST /files/stat
 * Body: { path: string }
 */
files.post('/stat', async (c) => {
  try {
    const body = await c.req.json<{ path: string }>();
    const { path: filePath } = body;

    if (!filePath) {
      return c.json({ error: 'Path is required' }, 400);
    }

    try {
      const stat = await fs.stat(filePath);
      return c.json({
        exists: true,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    } catch {
      return c.json({ exists: false });
    }
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * Read file contents
 * POST /files/read
 * Body: { path: string }
 */
files.post('/read', async (c) => {
  try {
    const body = await c.req.json<{ path: string }>();
    const { path: filePath } = body;

    if (!filePath) {
      return c.json({ error: 'Path is required' }, 400);
    }

    // Security check
    const homedir = process.env.HOME || process.env.USERPROFILE || '';
    if (!filePath.startsWith(homedir) && !filePath.startsWith('/tmp')) {
      return c.json({ error: 'Access denied' }, 403);
    }

    const content = await fs.readFile(filePath, 'utf-8');
    return c.json({
      success: true,
      content,
    });
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

/**
 * Get all skills directories
 * GET /files/skills-dir
 * Returns paths for both ~/.workany/skills and ~/.claude/skills
 */
files.get('/skills-dir', async (c) => {
  const skillsDirs = getAllSkillsDirs();
  const results: { name: string; path: string; exists: boolean }[] = [];

  for (const dir of skillsDirs) {
    try {
      const stat = await fs.stat(dir.path);
      if (stat.isDirectory()) {
        results.push({ name: dir.name, path: dir.path, exists: true });
      } else {
        results.push({ name: dir.name, path: dir.path, exists: false });
      }
    } catch {
      // Directory doesn't exist
      if (dir.name === 'workany') {
        // Try to create workany skills dir
        try {
          await fs.mkdir(dir.path, { recursive: true });
          results.push({ name: dir.name, path: dir.path, exists: true });
        } catch {
          results.push({ name: dir.name, path: dir.path, exists: false });
        }
      } else {
        // For system directories like claude, just mark as not existing
        results.push({ name: dir.name, path: dir.path, exists: false });
      }
    }
  }

  // Return first existing directory for backward compatibility
  const firstExisting = results.find((r) => r.exists);
  return c.json({
    path: firstExisting?.path || '',
    exists: !!firstExisting,
    directories: results,
  });
});

/**
 * Read file as binary (base64)
 * POST /files/read-binary
 * Body: { path: string }
 */
files.post('/read-binary', async (c) => {
  try {
    const body = await c.req.json<{ path: string }>();
    const { path: filePath } = body;

    if (!filePath) {
      return c.json({ error: 'Path is required' }, 400);
    }

    // Security check
    const homedir = process.env.HOME || process.env.USERPROFILE || '';
    if (!filePath.startsWith(homedir) && !filePath.startsWith('/tmp')) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Check if file exists
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        return c.json({ error: 'Path is not a file' }, 400);
      }
    } catch {
      return c.json({ error: 'File does not exist' }, 404);
    }

    const content = await fs.readFile(filePath);
    const base64 = content.toString('base64');
    const fileName = path.basename(filePath);

    return c.json({
      success: true,
      fileName,
      content: base64,
      size: content.length,
    });
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

/**
 * Detect available code editors
 * GET /files/detect-editor
 */
files.get('/detect-editor', async (c) => {
  const platform = process.platform;

  // Common editors to check (in priority order)
  const editors = [
    {
      name: 'Cursor',
      command: 'cursor',
      check: platform === 'darwin' ? 'cursor' : 'cursor.cmd',
    },
    {
      name: 'VS Code',
      command: 'code',
      check: platform === 'darwin' ? 'code' : 'code.cmd',
    },
    {
      name: 'VS Code Insiders',
      command: 'code-insiders',
      check: 'code-insiders',
    },
    {
      name: 'Sublime Text',
      command: platform === 'darwin' ? 'subl' : 'subl',
      check: 'subl',
    },
    { name: 'Atom', command: 'atom', check: 'atom' },
    { name: 'WebStorm', command: 'webstorm', check: 'webstorm' },
    { name: 'PyCharm', command: 'pycharm', check: 'pycharm' },
  ];

  for (const editor of editors) {
    try {
      // Check if editor command exists
      const checkCmd =
        platform === 'win32'
          ? `where ${editor.check}`
          : `which ${editor.check}`;
      await execAsync(checkCmd);
      return c.json({
        success: true,
        editor: editor.name,
        command: editor.command,
      });
    } catch {
      // Editor not found, try next
      continue;
    }
  }

  // No editor found, will use system default
  return c.json({
    success: true,
    editor: 'Default Editor',
    command: null,
  });
});

/**
 * Open a file in code editor
 * POST /files/open-in-editor
 * Body: { path: string }
 */
files.post('/open-in-editor', async (c) => {
  try {
    const body = await c.req.json<{ path: string }>();
    const { path: filePath } = body;

    if (!filePath) {
      return c.json({ error: 'Path is required' }, 400);
    }

    // Security check
    const homedir = process.env.HOME || process.env.USERPROFILE || '';
    if (!filePath.startsWith(homedir) && !filePath.startsWith('/tmp')) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Check if file exists
    try {
      await fs.stat(filePath);
    } catch {
      return c.json({ error: 'File does not exist' }, 404);
    }

    const platform = process.platform;

    // Try to find an editor
    const editors = [
      { name: 'Cursor', command: 'cursor' },
      { name: 'VS Code', command: 'code' },
      { name: 'VS Code Insiders', command: 'code-insiders' },
      { name: 'Sublime Text', command: 'subl' },
    ];

    let editorCommand: string | null = null;
    let editorName = 'Default Editor';

    for (const editor of editors) {
      try {
        const checkCmd =
          platform === 'win32'
            ? `where ${editor.command}`
            : `which ${editor.command}`;
        await execAsync(checkCmd);
        editorCommand = editor.command;
        editorName = editor.name;
        break;
      } catch {
        continue;
      }
    }

    let command: string;
    if (editorCommand) {
      command = `${editorCommand} "${filePath}"`;
    } else {
      // Fallback to system default
      if (platform === 'darwin') {
        command = `open -t "${filePath}"`;
      } else if (platform === 'win32') {
        command = `start "" "${filePath}"`;
      } else {
        command = `xdg-open "${filePath}"`;
      }
    }

    console.log(`[Files API] Opening in editor (${editorName}): ${filePath}`);

    try {
      await execAsync(command);
      return c.json({ success: true, editor: editorName });
    } catch (execError) {
      console.error('[Files API] Failed to open in editor:', execError);
      return c.json({ success: false, error: String(execError) }, 500);
    }
  } catch (error) {
    console.error('[Files API] Error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * Open a file with system default application
 * POST /files/open
 * Body: { path: string }
 */
files.post('/open', async (c) => {
  try {
    const body = await c.req.json<{ path: string }>();
    let { path: filePath } = body;

    if (!filePath) {
      return c.json({ error: 'Path is required' }, 400);
    }

    // Expand ~ to home directory
    const homedir = getHomeDir();
    if (filePath.startsWith('~/')) {
      filePath = filePath.replace('~', homedir);
    } else if (filePath === '~') {
      filePath = homedir;
    }

    // Security check: only allow opening files from home directory
    if (!filePath.startsWith(homedir) && !filePath.startsWith('/tmp')) {
      return c.json(
        { error: 'Access denied: path must be within home directory' },
        403
      );
    }

    // Check if file exists
    try {
      await fs.stat(filePath);
    } catch {
      return c.json({ error: 'File does not exist' }, 404);
    }

    // Open file with system default application
    const platform = process.platform;
    let command: string;

    if (platform === 'darwin') {
      // macOS
      command = `open "${filePath}"`;
    } else if (platform === 'win32') {
      // Windows
      command = `start "" "${filePath}"`;
    } else {
      // Linux
      command = `xdg-open "${filePath}"`;
    }

    console.log(`[Files API] Opening file: ${filePath}`);

    try {
      await execAsync(command);
      console.log('[Files API] File opened successfully');
      return c.json({ success: true });
    } catch (execError) {
      console.error('[Files API] Failed to open file:', execError);
      return c.json({ success: false, error: String(execError) }, 500);
    }
  } catch (error) {
    console.error('[Files API] Error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

export { files as filesRoutes };
