/**
 * Provider API Client
 *
 * Client for interacting with the Provider management API endpoints.
 */

import { API_BASE_URL } from '@/config';

// ============================================================================
// Types
// ============================================================================

export interface ProviderMetadata {
  type: string;
  name: string;
  version: string;
  description: string;
  configSchema: Record<string, unknown>;
  icon?: string;
  docsUrl?: string;
  builtin?: boolean;
  tags?: string[];
  available?: boolean;
  current?: boolean;
}

export interface SandboxProviderMetadata extends ProviderMetadata {
  isolation: 'vm' | 'container' | 'process' | 'none';
  supportedRuntimes: string[];
  supportsVolumeMounts: boolean;
  supportsNetworking: boolean;
  supportsPooling: boolean;
}

export interface AgentProviderMetadata extends ProviderMetadata {
  supportsPlan: boolean;
  supportsStreaming: boolean;
  supportsSandbox: boolean;
  supportedModels?: string[];
  defaultModel?: string;
}

export interface ProvidersListResponse {
  providers: ProviderMetadata[];
  current: string | null;
}

export interface SwitchProviderRequest {
  type: string;
  config?: Record<string, unknown>;
}

export interface SwitchProviderResponse {
  success: boolean;
  current: string;
  message: string;
}

export interface SettingsSyncRequest {
  sandboxProvider?: string;
  sandboxConfig?: Record<string, unknown>;
  agentProvider?: string;
  agentConfig?: Record<string, unknown>;
}

export interface ProvidersConfig {
  sandbox?: {
    category: string;
    type: string;
    config?: Record<string, unknown>;
  };
  agent?: {
    category: string;
    type: string;
    config?: Record<string, unknown>;
  };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get all sandbox providers
 */
export async function getSandboxProviders(): Promise<ProvidersListResponse> {
  const response = await fetch(`${API_BASE_URL}/providers/sandbox`);
  if (!response.ok) {
    throw new Error(`Failed to get sandbox providers: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get available sandbox providers
 */
export async function getAvailableSandboxProviders(): Promise<string[]> {
  const response = await fetch(`${API_BASE_URL}/providers/sandbox/available`);
  if (!response.ok) {
    throw new Error(
      `Failed to get available sandbox providers: ${response.statusText}`
    );
  }
  const data = await response.json();
  return data.available;
}

/**
 * Get a specific sandbox provider
 */
export async function getSandboxProvider(
  type: string
): Promise<SandboxProviderMetadata> {
  const response = await fetch(`${API_BASE_URL}/providers/sandbox/${type}`);
  if (!response.ok) {
    throw new Error(`Failed to get sandbox provider: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Switch sandbox provider
 */
export async function switchSandboxProvider(
  type: string,
  config?: Record<string, unknown>
): Promise<SwitchProviderResponse> {
  const response = await fetch(`${API_BASE_URL}/providers/sandbox/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, config }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.error || `Failed to switch sandbox provider: ${response.statusText}`
    );
  }
  return response.json();
}

/**
 * Get all agent providers
 */
export async function getAgentProviders(): Promise<ProvidersListResponse> {
  const response = await fetch(`${API_BASE_URL}/providers/agents`);
  if (!response.ok) {
    throw new Error(`Failed to get agent providers: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get available agent providers
 */
export async function getAvailableAgentProviders(): Promise<string[]> {
  const response = await fetch(`${API_BASE_URL}/providers/agents/available`);
  if (!response.ok) {
    throw new Error(
      `Failed to get available agent providers: ${response.statusText}`
    );
  }
  const data = await response.json();
  return data.available;
}

/**
 * Get a specific agent provider
 */
export async function getAgentProvider(
  type: string
): Promise<AgentProviderMetadata> {
  const response = await fetch(`${API_BASE_URL}/providers/agents/${type}`);
  if (!response.ok) {
    throw new Error(`Failed to get agent provider: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Switch agent provider
 */
export async function switchAgentProvider(
  type: string,
  config?: Record<string, unknown>
): Promise<SwitchProviderResponse> {
  const response = await fetch(`${API_BASE_URL}/providers/agents/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, config }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.error || `Failed to switch agent provider: ${response.statusText}`
    );
  }
  return response.json();
}

/**
 * Sync settings with backend
 */
export async function syncSettings(
  settings: SettingsSyncRequest
): Promise<ProvidersConfig> {
  const response = await fetch(`${API_BASE_URL}/providers/settings/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.error || `Failed to sync settings: ${response.statusText}`
    );
  }
  const data = await response.json();
  return data.config;
}

/**
 * Get current provider configuration
 */
export async function getProvidersConfig(): Promise<ProvidersConfig> {
  const response = await fetch(`${API_BASE_URL}/providers/config`);
  if (!response.ok) {
    throw new Error(`Failed to get providers config: ${response.statusText}`);
  }
  return response.json();
}
