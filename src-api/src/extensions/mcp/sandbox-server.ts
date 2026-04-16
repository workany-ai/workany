#!/usr/bin/env node
/**
 * Sandbox MCP Server
 *
 * Provides sandbox execution tools for the Claude Agent.
 * This allows the agent to run scripts in isolated containers
 * without needing to use curl commands.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { DEFAULT_API_HOST, DEFAULT_API_PORT } from '@/config/constants';

// API port: 2620 for production, 2026 for development
// In dev mode (NODE_ENV=development), use 2026; otherwise use 2620
const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
const API_PORT =
  process.env.PORT || (isDev ? '2026' : String(DEFAULT_API_PORT));
const SANDBOX_API_URL =
  process.env.SANDBOX_API_URL || `http://${DEFAULT_API_HOST}:${API_PORT}`;

const server = new McpServer(
  {
    name: 'sandbox',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register run_script tool
server.registerTool(
  'run_script',
  {
    description:
      'Run a script file in an isolated sandbox container. Automatically detects the runtime (Python, Node.js, Bun) based on file extension. The script file must already exist on disk.',
    inputSchema: z.object({
      filePath: z.string().describe('Absolute path to the script file to execute'),
      workDir: z.string().describe('Working directory containing the script (use the directory where the script file is located)'),
      args: z.array(z.string()).optional().describe('Optional command line arguments to pass to the script'),
      packages: z.array(z.string()).optional().describe('Optional packages to install before running (npm packages for Node.js/Bun)'),
      timeout: z.number().optional().describe('Execution timeout in milliseconds (default: 120000)'),
    }),
  },
  async ({ filePath, workDir, args: scriptArgs, packages, timeout }) => {
    try {
      const response = await fetch(`${SANDBOX_API_URL}/sandbox/run/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath,
          workDir,
          args: scriptArgs,
          packages,
          timeout,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        return {
          content: [
            {
              type: 'text',
              text: `Sandbox API error (${response.status}): ${errorText}`,
            },
          ],
          isError: true,
        };
      }

      const result = await response.json();

      if (!result) {
        return {
          content: [
            { type: 'text', text: 'Sandbox API returned empty response' },
          ],
          isError: true,
        };
      }

      // Format the output nicely
      let output = '';
      if (result.success) {
        output = `✅ Script executed successfully (exit code: ${result.exitCode})\n`;
        output += `Runtime: ${result.runtime}\n`;
        output += `Duration: ${result.duration}ms\n`;
        output += `📁 Output files are saved to: ${workDir}\n\n`;
        if (result.stdout) {
          output += `--- stdout ---\n${result.stdout}\n`;
        }
        if (result.stderr) {
          output += `--- stderr ---\n${result.stderr}\n`;
        }
      } else {
        output = `❌ Script execution failed (exit code: ${result.exitCode})\n`;
        if (result.error) {
          output += `Error: ${result.error}\n`;
        }
        if (result.stderr) {
          output += `--- stderr ---\n${result.stderr}\n`;
        }
        if (result.stdout) {
          output += `--- stdout ---\n${result.stdout}\n`;
        }
      }

      return {
        content: [{ type: 'text', text: output }],
        isError: !result.success,
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing run_script: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Register run_command tool
server.registerTool(
  'run_command',
  {
    description:
      'Execute a shell command in an isolated sandbox container. Use this for running commands that need specific dependencies or isolation.',
    inputSchema: z.object({
      command: z.string().describe("The command to execute (e.g., 'python', 'node', 'npm')"),
      args: z.array(z.string()).optional().describe('Arguments for the command'),
      workDir: z.string().describe('Working directory for command execution (use absolute paths)'),
      image: z.string().optional().describe('Container image to use (default: auto-detected, options: node:18-alpine, python:3.11-slim, oven/bun:latest)'),
      timeout: z.number().optional().describe('Execution timeout in milliseconds (default: 120000)'),
    }),
  },
  async ({ command, args: cmdArgs, workDir, image, timeout }) => {
    try {
      const response = await fetch(`${SANDBOX_API_URL}/sandbox/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          args: cmdArgs,
          cwd: workDir,
          image,
          timeout,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        return {
          content: [
            {
              type: 'text',
              text: `Sandbox API error (${response.status}): ${errorText}`,
            },
          ],
          isError: true,
        };
      }

      const result = await response.json();

      if (!result) {
        return {
          content: [
            { type: 'text', text: 'Sandbox API returned empty response' },
          ],
          isError: true,
        };
      }

      let output = '';
      if (result.success) {
        output = `Command executed successfully (exit code: ${result.exitCode})\n`;
        output += `Duration: ${result.duration}ms\n\n`;
        if (result.stdout) {
          output += `--- stdout ---\n${result.stdout}\n`;
        }
        if (result.stderr) {
          output += `--- stderr ---\n${result.stderr}\n`;
        }
      } else {
        output = `Command failed (exit code: ${result.exitCode})\n`;
        if (result.error) {
          output += `Error: ${result.error}\n`;
        }
        if (result.stderr) {
          output += `--- stderr ---\n${result.stderr}\n`;
        }
      }

      return {
        content: [{ type: 'text', text: output }],
        isError: !result.success,
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing run_command: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Sandbox MCP] Server started');
}

main().catch((error) => {
  console.error('[Sandbox MCP] Fatal error:', error);
  process.exit(1);
});