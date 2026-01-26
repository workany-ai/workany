/**
 * MCP Config Loader
 *
 * Loads MCP server configuration from ~/.workany/mcp.json
 */

import fs from 'fs/promises';

import { getWorkanyMcpConfigPath } from '@/config/constants';

// MCP Server Config Types (matching SDK types)
export interface McpStdioServerConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface McpSSEServerConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig | McpSSEServerConfig;

// WorkAny MCP Config file format
interface _WorkAnyMcpConfig {
  mcpServers: Record<
    string,
    {
      // Type field (optional, defaults to 'sse' for URL-based, 'stdio' for command-based)
      type?: 'stdio' | 'http' | 'sse';
      // Stdio config
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      // HTTP/SSE config
      url?: string;
      headers?: Record<string, string>;
    }
  >;
}

/**
 * Get the MCP config path
 */
export function getMcpConfigPath(): string {
  return getWorkanyMcpConfigPath();
}

/**
 * Load MCP servers from a single config file
 */
async function loadMcpServersFromFile(
  configPath: string,
  sourceName: string
): Promise<Record<string, McpServerConfig>> {
  try {
    await fs.access(configPath);
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    // Support both formats: { mcpServers: {...} } and direct { serverName: {...} }
    const mcpServers = config.mcpServers || config;

    if (!mcpServers || typeof mcpServers !== 'object') {
      return {};
    }

    const servers: Record<string, McpServerConfig> = {};

    for (const [name, serverConfig] of Object.entries(mcpServers)) {
      const cfg = serverConfig as Record<string, unknown>;
      if (cfg.url) {
        // Determine type: use explicit type if provided, otherwise default to 'http'
        // User can specify 'sse' in config if the server uses SSE protocol
        const urlType = (cfg.type as string) || 'http';
        if (urlType === 'sse') {
          servers[name] = {
            type: 'sse',
            url: cfg.url as string,
            headers: cfg.headers as Record<string, string>,
          };
          console.log(`[MCP] Loaded SSE server from ${sourceName}: ${name}`);
        } else {
          // Default to HTTP for URL-based MCP servers
          servers[name] = {
            type: 'http',
            url: cfg.url as string,
            headers: cfg.headers as Record<string, string>,
          };
          console.log(`[MCP] Loaded HTTP server from ${sourceName}: ${name}`);
        }
      } else if (cfg.command) {
        servers[name] = {
          type: 'stdio',
          command: cfg.command as string,
          args: cfg.args as string[],
          env: cfg.env as Record<string, string>,
        };
        console.log(`[MCP] Loaded stdio server from ${sourceName}: ${name}`);
      }
    }

    return servers;
  } catch {
    return {};
  }
}

/**
 * MCP configuration interface
 */
export interface McpConfig {
  enabled: boolean;
}

/**
 * Load MCP servers configuration from ~/.workany/mcp.json
 *
 * @param mcpConfig Optional config to control loading
 * @returns Record of server name to config
 */
export async function loadMcpServers(
  mcpConfig?: McpConfig
): Promise<Record<string, McpServerConfig>> {
  // If MCP is globally disabled, return empty
  if (mcpConfig && !mcpConfig.enabled) {
    console.log('[MCP] MCP disabled, skipping server load');
    return {};
  }

  const configPath = getMcpConfigPath();
  const servers = await loadMcpServersFromFile(configPath, 'workany');

  const serverCount = Object.keys(servers).length;
  if (serverCount > 0) {
    console.log(`[MCP] Loaded ${serverCount} MCP server(s)`);
  } else {
    console.log('[MCP] No MCP servers found');
  }

  return servers;
}
