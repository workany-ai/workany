/**
 * Provider Management API Routes
 *
 * Provides REST endpoints for managing sandbox and agent providers.
 */

import { Hono } from 'hono';

import { getAgentRegistry } from '@/core/agent/registry';
import { getSandboxRegistry } from '@/core/sandbox/registry';
import { getConfigLoader } from '@/config/loader';
import { getProviderManager } from '@/shared/provider/manager';

// ============================================================================
// Constants
// ============================================================================

const API_TIMEOUT_MS = 60000;
const DEFAULT_TEST_MODEL = 'gpt-3.5-turbo';
const DETECT_TEST_MESSAGE = 'OK';

// ============================================================================
// Types
// ============================================================================

interface ProviderSwitchBody {
  type: string;
  config?: Record<string, unknown>;
}

interface ProviderMetadataWithStatus {
  type: string;
  name: string;
  description: string;
  available: boolean;
  current: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatProviderMetadata(
  metadata: Array<{ type: string; name: string; description?: string }>,
  availableTypes: string[],
  currentType: string | null
): ProviderMetadataWithStatus[] {
  return metadata.map((m) => ({
    ...m,
    description: m.description || '',
    available: availableTypes.includes(m.type),
    current: currentType === m.type,
  }));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

// ============================================================================
// Routes
// ============================================================================

const providersRoutes = new Hono();

// Global error handler for providers routes
providersRoutes.onError((err, c) => {
  console.error('[ProvidersAPI] Unhandled error:', err);
  return c.json(
    { error: err instanceof Error ? err.message : 'Internal server error' },
    500
  );
});

// ----------------------------------------------------------------------------
// Sandbox Provider Routes
// ----------------------------------------------------------------------------

/**
 * GET /providers/sandbox
 * List all sandbox providers with their metadata
 */
providersRoutes.get('/sandbox', async (c) => {
  const registry = getSandboxRegistry();
  const manager = getProviderManager();

  const metadata = registry.getAllSandboxMetadata();
  const available = await registry.getAvailable();
  const currentType = manager.getConfig().sandbox?.type || null;

  const providers = formatProviderMetadata(metadata, available, currentType);

  return c.json({ providers, current: currentType });
});

/**
 * GET /providers/sandbox/available
 * List available sandbox providers (those that can actually run on this system)
 */
providersRoutes.get('/sandbox/available', async (c) => {
  const registry = getSandboxRegistry();
  const available = await registry.getAvailable();
  return c.json({ available });
});

/**
 * GET /providers/sandbox/:type
 * Get details about a specific sandbox provider
 */
providersRoutes.get('/sandbox/:type', async (c) => {
  const type = c.req.param('type');
  const registry = getSandboxRegistry();
  const metadata = registry.getSandboxMetadata(type);

  if (!metadata) {
    return c.json({ error: `Sandbox provider not found: ${type}` }, 404);
  }

  const available = await registry.getAvailable();
  const currentType = getProviderManager().getConfig().sandbox?.type;

  return c.json({
    ...metadata,
    available: available.includes(type),
    current: currentType === type,
  });
});

/**
 * POST /providers/sandbox/switch
 * Switch to a different sandbox provider
 */
providersRoutes.post('/sandbox/switch', async (c) => {
  const body = await c.req.json<ProviderSwitchBody>();

  if (!body.type) {
    return c.json({ error: 'Provider type is required' }, 400);
  }

  const manager = getProviderManager();
  await manager.switchSandboxProvider(body.type, body.config);

  getConfigLoader().updateFromSettings({
    sandboxProvider: body.type,
    sandboxConfig: body.config,
  });

  return c.json({
    success: true,
    current: body.type,
    message: `Switched to sandbox provider: ${body.type}`,
  });
});

// ----------------------------------------------------------------------------
// Agent Provider Routes
// ----------------------------------------------------------------------------

/**
 * GET /providers/agents
 * List all agent providers with their metadata
 */
providersRoutes.get('/agents', async (c) => {
  const registry = getAgentRegistry();
  const manager = getProviderManager();

  const metadata = registry.getAllAgentMetadata();
  const available = await registry.getAvailable();
  const currentType = manager.getConfig().agent?.type || null;

  const providers = formatProviderMetadata(metadata, available, currentType);

  return c.json({ providers, current: currentType });
});

/**
 * GET /providers/agents/available
 * List available agent providers
 */
providersRoutes.get('/agents/available', async (c) => {
  const registry = getAgentRegistry();
  const available = await registry.getAvailable();
  return c.json({ available });
});

/**
 * GET /providers/agents/:type
 * Get details about a specific agent provider
 */
providersRoutes.get('/agents/:type', async (c) => {
  const type = c.req.param('type');
  const registry = getAgentRegistry();
  const metadata = registry.getAgentMetadata(type);

  if (!metadata) {
    return c.json({ error: `Agent provider not found: ${type}` }, 404);
  }

  const available = await registry.getAvailable();
  const currentType = getProviderManager().getConfig().agent?.type;

  return c.json({
    ...metadata,
    available: available.includes(type),
    current: currentType === type,
  });
});

/**
 * POST /providers/agents/switch
 * Switch to a different agent provider
 */
providersRoutes.post('/agents/switch', async (c) => {
  const body = await c.req.json<ProviderSwitchBody>();

  if (!body.type) {
    return c.json({ error: 'Provider type is required' }, 400);
  }

  const manager = getProviderManager();
  await manager.switchAgentProvider(body.type, body.config);

  getConfigLoader().updateFromSettings({
    agentProvider: body.type,
    agentConfig: body.config,
  });

  return c.json({
    success: true,
    current: body.type,
    message: `Switched to agent provider: ${body.type}`,
  });
});

// ----------------------------------------------------------------------------
// Settings Routes
// ----------------------------------------------------------------------------

interface SettingsSyncBody {
  sandboxProvider?: string;
  sandboxConfig?: Record<string, unknown>;
  agentProvider?: string;
  agentConfig?: Record<string, unknown>;
  defaultProvider?: string;
  defaultModel?: string;
}

/**
 * POST /providers/settings/sync
 * Sync frontend settings with the backend
 */
providersRoutes.post('/settings/sync', async (c) => {
  const body = await c.req.json<SettingsSyncBody>();

  const manager = getProviderManager();
  const configLoader = getConfigLoader();

  if (body.sandboxProvider) {
    await manager.switchSandboxProvider(body.sandboxProvider, body.sandboxConfig);
  }

  if (body.agentProvider) {
    await manager.switchAgentProvider(body.agentProvider, body.agentConfig);
  }

  configLoader.updateFromSettings({
    ...body,
    agentConfig: body.agentConfig,
  });

  console.log('[ProvidersAPI] Settings synced:', {
    agentProvider: body.agentProvider,
    defaultProvider: body.defaultProvider,
    defaultModel: body.defaultModel,
    hasApiKey: !!body.agentConfig?.apiKey,
    hasBaseUrl: !!body.agentConfig?.baseUrl,
  });

  return c.json({
    success: true,
    config: manager.getConfig(),
  });
});

/**
 * GET /providers/config
 * Get current provider configuration
 */
providersRoutes.get('/config', (c) => {
  const manager = getProviderManager();
  return c.json(manager.getConfig());
});

// ----------------------------------------------------------------------------
// Detection Routes
// ----------------------------------------------------------------------------

interface DetectBody {
  baseUrl: string;
  apiKey: string;
  model?: string;
}

interface DetectSuccessResponse {
  success: true;
  message: string;
  model: string;
  response: unknown;
}

interface DetectErrorResponse {
  success: false;
  error: string;
}

// Union type for future use if needed
// type DetectResponse = DetectSuccessResponse | DetectErrorResponse;

/**
 * Build API URL from base URL
 * Handles various base URL formats and ensures proper /v1/messages path
 */
function buildApiUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, '');

  if (normalized.includes('/messages')) {
    return normalized;
  }

  if (normalized.endsWith('/v1')) {
    return `${normalized}/messages`;
  }

  return `${normalized}/v1/messages`;
}

/**
 * POST /providers/detect
 * Detect if an OpenAI-compatible API configuration is valid
 */
providersRoutes.post('/detect', async (c) => {
  const body = await c.req.json<DetectBody>();

  if (!body.baseUrl || !body.apiKey) {
    return c.json({ error: 'baseUrl and apiKey are required' }, 400);
  }

  const apiUrl = buildApiUrl(body.baseUrl);
  const testModel = body.model || DEFAULT_TEST_MODEL;

  console.log('[ProvidersAPI] Detecting API connection:', {
    baseUrl: body.baseUrl,
    apiUrl,
    model: testModel,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${body.apiKey}`,
      },
      body: JSON.stringify({
        model: testModel,
        messages: [{ role: 'user', content: DETECT_TEST_MESSAGE }],
        max_tokens: 1,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      const successResponse: DetectSuccessResponse = {
        success: true,
        message: 'Connection successful! Configuration valid',
        model: testModel,
        response: data,
      };
      return c.json(successResponse);
    }

    const errorData = await response.json().catch(() => ({}));
    console.error('[ProvidersAPI] Detection failed:', {
      status: response.status,
      error: errorData,
    });

    const errorResponse: DetectErrorResponse = {
      success: false,
      error: errorData.error?.message || `HTTP ${response.status}`,
    };
    return c.json(errorResponse, 200);
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('[ProvidersAPI] Detection error:', error);

    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutResponse: DetectErrorResponse = {
        success: false,
        error: 'Connection timeout (60s)',
      };
      return c.json(timeoutResponse, 200);
    }

    const errorResponse: DetectErrorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
    return c.json(errorResponse, 200);
  }
});

export { providersRoutes };
