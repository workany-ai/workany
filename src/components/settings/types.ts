import type {
  AIProvider,
  Settings as SettingsType,
} from '@/shared/db/settings';

export type { SettingsType, AIProvider };

// Settings category type
export type SettingsCategory =
  | 'account'
  | 'general'
  | 'workplace'
  | 'model'
  | 'mcp'
  | 'skills'
  | 'connector'
  | 'data'
  | 'about';

// Common props for settings tabs
export interface SettingsTabProps {
  settings: SettingsType;
  onSettingsChange: (settings: SettingsType) => void;
}

// Workplace settings props (includes default paths)
export interface WorkplaceSettingsProps extends SettingsTabProps {
  defaultPaths: {
    workDir: string;
    mcpConfigPath: string;
    skillsPath: string;
  };
}

// Dependency status for workspace settings
export interface DependencyStatus {
  claudeCode: boolean;
  node: boolean;
  python: boolean;
  codex: boolean;
  srt: boolean;
}

// MCP Server Config Types
export interface MCPServerStdio {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPServerHttp {
  url: string;
  headers?: Record<string, string>;
}

export type MCPServerConfig = MCPServerStdio | MCPServerHttp;

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

// Internal MCP server representation for UI
export interface MCPServerUI {
  id: string;
  name: string;
  type: 'stdio' | 'http' | 'sse';
  enabled: boolean;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  autoExecute?: boolean;
  source?: 'workany' | 'claude';
}

// Skill types
export interface SkillFile {
  name: string;
  path: string;
  isDir: boolean;
  children?: SkillFile[];
}

export interface SkillInfo {
  id: string;
  name: string;
  source: 'claude' | 'workany';
  path: string;
  files: SkillFile[];
  enabled: boolean;
}

// Sub-tab types
export type ModelSubTab = 'settings' | string;
export type MCPSubTab = 'settings' | string;
export type SkillsSubTab = 'settings' | string;
