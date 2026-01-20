import type { ComponentType } from 'react';
import type { SettingsCategory } from './types';
import {
  Cpu,
  FolderOpen,
  Info,
  Layers,
  Plug,
  Settings,
  User,
} from 'lucide-react';

// MCP icon component
export const McpIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
  </svg>
);

// Category icons mapping
export const categoryIcons: Record<
  SettingsCategory,
  ComponentType<{ className?: string }>
> = {
  account: User,
  general: Settings,
  workplace: FolderOpen,
  model: Cpu,
  mcp: McpIcon,
  skills: Layers,
  connector: Plug,
  about: Info,
};

// Provider icons mapping
export const providerIcons: Record<string, string> = {
  openrouter: '<',
};

// Provider API Key settings URLs
export const providerApiKeyUrls: Record<string, string> = {
  openrouter: 'https://openrouter.ai/keys',
};

// Default provider IDs that cannot be deleted
export const defaultProviderIds = [
  'openrouter',
];

// Popular models for each provider (for suggestions)
export const providerDefaultModels: Record<string, string[]> = {
  openrouter: [
    'anthropic/claude-sonnet-4-5-20250514',
    'anthropic/claude-opus-4-5-20250514',
    'anthropic/claude-sonnet-4-20250514',
    'openai/gpt-4o',
  ],
  anthropic: [
    'claude-sonnet-4-5-20250514',
    'claude-opus-4-5-20250514',
    'claude-sonnet-4-20250514',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'o1-preview',
  ],
  // Custom providers - provide common model name patterns
  default: [
    'claude-sonnet-4-5-20250514',
    'gpt-4o',
    'deepseek-chat',
  ],
};

// Model suggestions for custom providers (matched by name pattern)
export const customProviderModels: Record<string, string[]> = {
  '火山': [
    'doubao-1-5-pro-256k-250115',
    'doubao-1-5-lite-32k-250115',
    'deepseek-v3-250324',
  ],
  'volcengine': [
    'doubao-1-5-pro-256k-250115',
    'doubao-1-5-lite-32k-250115',
    'deepseek-v3-250324',
  ],
  'deepseek': [
    'deepseek-chat',
    'deepseek-coder',
    'deepseek-reasoner',
  ],
  'moonshot': [
    'moonshot-v1-8k',
    'moonshot-v1-32k',
    'moonshot-v1-128k',
  ],
  'zhipu': [
    'glm-4-plus',
    'glm-4-flash',
    'glm-4-long',
  ],
  'qwen': [
    'qwen-max',
    'qwen-plus',
    'qwen-turbo',
  ],
};

// Re-export API config
export { API_PORT, API_BASE_URL } from '@/config';
