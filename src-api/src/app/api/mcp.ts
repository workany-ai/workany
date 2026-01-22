import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Hono } from 'hono';

const mcp = new Hono();

// MCP config file path: ~/.workany/mcp.json
const getMcpConfigPath = (): string => {
  const homeDir = os.homedir();
  return path.join(homeDir, '.workany', 'mcp.json');
};

// Ensure directory exists
const ensureDir = async (filePath: string): Promise<void> => {
  const dir = path.dirname(filePath);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    // Directory might already exist
  }
};

// MCP Server Config Types
interface MCPServerStdio {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface MCPServerHttp {
  url: string;
  headers?: Record<string, string>;
}

type MCPServerConfig = MCPServerStdio | MCPServerHttp;

interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

// GET /mcp/config - Read MCP config
mcp.get('/config', async (c) => {
  const configPath = getMcpConfigPath();

  try {
    // Check if file exists
    try {
      await fs.access(configPath);
    } catch {
      // File doesn't exist, return empty config
      return c.json({
        success: true,
        data: { mcpServers: {} },
        path: configPath,
      });
    }

    // Read and parse config
    const content = await fs.readFile(configPath, 'utf-8');
    const config: MCPConfig = JSON.parse(content);

    return c.json({
      success: true,
      data: config,
      path: configPath,
    });
  } catch (err) {
    console.error('[MCP] Failed to read config:', err);
    return c.json(
      {
        success: false,
        error: 'Failed to read MCP config',
        path: configPath,
      },
      500
    );
  }
});

// POST /mcp/config - Write MCP config
mcp.post('/config', async (c) => {
  const configPath = getMcpConfigPath();

  try {
    const body = await c.req.json<MCPConfig>();

    // Validate structure
    if (!body || typeof body.mcpServers !== 'object') {
      return c.json(
        {
          success: false,
          error: 'Invalid config format: mcpServers object required',
        },
        400
      );
    }

    // Ensure directory exists
    await ensureDir(configPath);

    // Write config
    const configJson = JSON.stringify(body, null, 2);
    await fs.writeFile(configPath, configJson, 'utf-8');

    console.log('[MCP] Config saved to:', configPath);

    return c.json({
      success: true,
      message: 'MCP config saved',
      path: configPath,
    });
  } catch (err) {
    console.error('[MCP] Failed to write config:', err);
    return c.json(
      {
        success: false,
        error: 'Failed to write MCP config',
      },
      500
    );
  }
});

// GET /mcp/path - Get MCP config file path
mcp.get('/path', (c) => {
  return c.json({
    success: true,
    path: getMcpConfigPath(),
  });
});

export { mcp as mcpRoutes };
