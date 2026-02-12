import type { ComponentType } from 'react';
import {
  customProviderModels,
  defaultProviderIds,
  defaultProviders,
  providerDefaultModels,
} from '@/shared/db/settings';
import {
  Cpu,
  Database,
  FolderOpen,
  Info,
  Plug,
  Server,
  Settings,
  Sparkles,
  User,
  Zap,
} from 'lucide-react';

import type { SettingsCategory } from './types';

// Category icons mapping
export const categoryIcons: Record<
  SettingsCategory,
  ComponentType<{ className?: string }>
> = {
  account: User,
  general: Settings,
  workplace: FolderOpen,
  model: Cpu,
  mcp: Server,
  skills: Sparkles,
  connector: Plug,
  openclaw: Zap,
  data: Database,
  about: Info,
};

// Provider icons mapping (derived from defaultProviders)
export const providerIcons: Record<string, string> = Object.fromEntries(
  defaultProviders.filter((p) => p.icon).map((p) => [p.id, p.icon!])
);

// Provider API Key settings URLs (derived from defaultProviders)
export const providerApiKeyUrls: Record<string, string> = Object.fromEntries(
  defaultProviders.filter((p) => p.apiKeyUrl).map((p) => [p.id, p.apiKeyUrl!])
);

// Re-export from settings.ts for backward compatibility
export { customProviderModels, defaultProviderIds, providerDefaultModels };

// Re-export API config
export { API_PORT, API_BASE_URL } from '@/config';
