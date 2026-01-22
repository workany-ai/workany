import type { ComponentType } from 'react';
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
  data: Database,
  about: Info,
};

// Provider icons mapping
export const providerIcons: Record<string, string> = {
  openrouter: '<',
};

// Provider API Key settings URLs
export const providerApiKeyUrls: Record<string, string> = {
  openrouter: 'https://openrouter.ai/keys',
  volcengine: 'https://volcengine.com/L/Sq5rSgyFu_E',
};

// Default provider IDs that cannot be deleted
export const defaultProviderIds = ['openrouter', 'volcengine'];

// Popular models for each provider (for suggestions)
export const providerDefaultModels: Record<string, string[]> = {
  openrouter: [
    'anthropic/claude-sonnet-4-5-20250514',
    'anthropic/claude-opus-4-5-20250514',
  ],
  anthropic: ['claude-sonnet-4-5-20250514', 'claude-opus-4-5-20250514'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1-preview'],
  // Custom providers - provide common model name patterns
  default: ['claude-sonnet-4-5-20250514', 'claude-sonnet-4-20250514'],
};

// Model suggestions for custom providers (matched by name pattern)
export const customProviderModels: Record<string, string[]> = {
  火山: [
    'doubao-1-5-pro-256k-250115',
    'doubao-1-5-lite-32k-250115',
    'deepseek-v3-250324',
  ],
  volcengine: [
    'doubao-1-5-pro-256k-250115',
    'doubao-1-5-lite-32k-250115',
    'deepseek-v3-250324',
  ],
  deepseek: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
  moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  zhipu: ['glm-4-plus', 'glm-4-flash', 'glm-4-long'],
  qwen: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
};

// Re-export API config
export { API_PORT, API_BASE_URL } from '@/config';
