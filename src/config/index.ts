/**
 * Application Configuration
 *
 * Centralized configuration for the application.
 */

// =============================================================================
// API Configuration
// =============================================================================

/**
 * API port configuration
 * - Development: 2026 (run `pnpm dev:api` separately)
 * - Production: 2620 (bundled sidecar)
 */
export const API_PORT = import.meta.env.PROD ? 2620 : 2026;

/**
 * API base URL
 */
export const API_BASE_URL = `http://localhost:${API_PORT}`;

// =============================================================================
// App Configuration
// =============================================================================

/**
 * App name
 */
export const APP_NAME = 'WorkAny';

/**
 * App identifier (must match tauri.conf.json)
 */
export const APP_IDENTIFIER = 'ai.thinkany.workany';
