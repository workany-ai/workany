import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  RefreshCw,
  Shield,
  Zap,
} from 'lucide-react';

import { API_BASE_URL as SETTINGS_API_BASE_URL } from '../constants';
import type {
  AIProvider,
  OpenClawConfig,
  SettingsTabProps,
  SettingsType,
} from '../types';

const DEFAULT_GATEWAY_URL = 'ws://127.0.0.1:18789';
const WORKANY_BOT_URL = 'https://workany.ai/bot';

export function OpenClawSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const { t } = useLanguage();
  const [showToken, setShowToken] = useState(false);

  const [config, setConfig] = useState<OpenClawConfig>(() => {
    const stored = localStorage.getItem('openclaw_config');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // If there's stored config with gatewayUrl, consider it enabled
        return {
          gatewayUrl: parsed.gatewayUrl || DEFAULT_GATEWAY_URL,
          authToken: parsed.authToken || '',
          enabled: !!parsed.gatewayUrl, // Auto-enable if gatewayUrl is set
        };
      } catch {
        // Ignore parse errors
      }
    }
    return {
      gatewayUrl: DEFAULT_GATEWAY_URL,
      authToken: '',
      enabled: false,
    };
  });

  const [detectStatus, setDetectStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [detectMessage, setDetectMessage] = useState('');

  const saveConfig = (newConfig: OpenClawConfig) => {
    localStorage.setItem('openclaw_config', JSON.stringify(newConfig));
  };

  const resetDetectStatus = () => {
    setTimeout(() => {
      setDetectStatus('idle');
    }, 5000);
  };

  const updateAgentRuntimes = (
    settings: SettingsType,
    openclawConfig: OpenClawConfig
  ): SettingsType => {
    const openclawProvider: AIProvider = {
      id: 'openclaw',
      name: 'OpenClaw Bot',
      type: 'openclaw',
      enabled: openclawConfig.enabled,
      config: {
        gatewayUrl: openclawConfig.gatewayUrl,
        authToken: openclawConfig.authToken,
      },
    };

    const existingIndex =
      settings.agentRuntimes?.findIndex((r) => r.id === 'openclaw') ?? -1;
    const updatedAgentRuntimes = [...(settings.agentRuntimes || [])];

    if (existingIndex >= 0) {
      updatedAgentRuntimes[existingIndex] = {
        ...updatedAgentRuntimes[existingIndex],
        enabled: openclawConfig.enabled,
        config: openclawProvider.config,
      };
    } else {
      updatedAgentRuntimes.push({
        id: 'openclaw',
        type: 'openclaw',
        name: 'OpenClaw Bot',
        enabled: openclawConfig.enabled,
        config: openclawProvider.config,
      });
    }

    return { ...settings, agentRuntimes: updatedAgentRuntimes };
  };

  const handleDetectConnection = async () => {
    if (!config.gatewayUrl) {
      setDetectStatus('error');
      setDetectMessage(
        t.settings.openclawEnterGatewayUrl || 'Please enter gateway URL'
      );
      resetDetectStatus();
      return;
    }

    setDetectStatus('loading');
    setDetectMessage('');

    try {
      const response = await fetch(`${SETTINGS_API_BASE_URL}/openclaw/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gatewayUrl: config.gatewayUrl,
          authToken: config.authToken,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setDetectStatus('success');
        setDetectMessage(
          t.settings.openclawConnectionSuccess || 'Connection successful!'
        );

        if (!config.enabled) {
          const newConfig = { ...config, enabled: true };
          setConfig(newConfig);
          saveConfig(newConfig);
          onSettingsChange(updateAgentRuntimes(settings, newConfig));
        }
      } else {
        setDetectStatus('error');
        setDetectMessage(
          data.message ||
            t.settings.openclawConnectionFailed ||
            'Connection failed'
        );
      }
    } catch (error) {
      setDetectStatus('error');
      setDetectMessage(
        t.settings.openclawConnectionError ||
          'Connection error: ' + (error as Error).message
      );
    }

    resetDetectStatus();
  };

  const handleConfigChange = (
    field: keyof OpenClawConfig,
    value: string | boolean
  ) => {
    const newConfig = { ...config, [field]: value };

    // Auto-enable when gatewayUrl or authToken is set
    if ((field === 'gatewayUrl' || field === 'authToken') && value) {
      newConfig.enabled = true;
    }

    setConfig(newConfig);
    saveConfig(newConfig);

    const updatedSettings = updateAgentRuntimes(settings, newConfig);
    onSettingsChange(updatedSettings);
  };

  return (
    <div className="space-y-6">
      {/* Get OpenClaw Bot Section */}
      <div className="border-border bg-gradient-to-r from-primary/5 to-primary/10 rounded-xl border p-4">
        <div className="flex items-start gap-4">
          <div className="bg-primary/20 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
            <Zap className="size-5" />
          </div>
          <div className="flex-1">
            <h4 className="text-foreground text-sm font-semibold">
              {t.settings.openclawGetBot || 'Get OpenClaw Bot'}
            </h4>
            <p className="text-muted-foreground mt-1 text-sm">
              {t.settings.openclawGetBotDesc ||
                'Get your OpenClaw Bot instance from WorkAny and start using AI-powered automation today.'}
            </p>
            <button
              onClick={() => openUrl(WORKANY_BOT_URL)}
              className="text-primary hover:bg-primary/10 mt-3 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              <ExternalLink className="size-4" />
              {t.settings.openclawVisitWorkany || 'Visit WorkAny Bot'}
            </button>
          </div>
        </div>
      </div>

      {/* Header Section */}
      <div className="border-border flex items-center gap-3 border-b pb-4">
        <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
          <Zap className="size-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-foreground text-lg font-semibold">
            {t.settings.openclawTitle || 'OpenClaw Bot'}
          </h3>
          <p className="text-muted-foreground text-sm">
            {t.settings.openclawDescription ||
              'Configure OpenClaw Gateway connection for AI bot capabilities'}
          </p>
        </div>
      </div>

      {/* Gateway URL Input */}
      <div className="space-y-2">
        <label className="text-foreground text-sm font-medium">
          {t.settings.openclawGatewayUrl || 'Gateway URL'}
        </label>
        <input
          type="text"
          value={config.gatewayUrl}
          onChange={(e) => handleConfigChange('gatewayUrl', e.target.value)}
          placeholder={DEFAULT_GATEWAY_URL}
          className="border-border bg-background text-foreground focus:border-primary focus:ring-primary/20 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
        <p className="text-muted-foreground text-xs">
          {t.settings.openclawGatewayUrlHint ||
            'WebSocket URL of the OpenClaw Gateway (default: ws://127.0.0.1:18789)'}
        </p>
      </div>

      {/* Auth Token Input */}
      <div className="space-y-2">
        <label className="text-foreground text-sm font-medium">
          {t.settings.openclawAuthToken || 'Authentication Token (Optional)'}
        </label>
        <div className="relative">
          <input
            type={showToken ? 'text' : 'password'}
            value={config.authToken || ''}
            onChange={(e) => handleConfigChange('authToken', e.target.value)}
            placeholder={
              t.settings.openclawAuthTokenPlaceholder || 'Enter your auth token'
            }
            className="border-border bg-background text-foreground focus:border-primary focus:ring-primary/20 w-full rounded-lg border px-3 py-2 pr-10 text-sm focus:ring-2 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors"
          >
            {showToken ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
        <p className="text-muted-foreground text-xs">
          {t.settings.openclawAuthTokenHint ||
            'Leave empty if your gateway does not require authentication'}
        </p>
      </div>

      {/* Connection Status Card */}
      <div className="border-border bg-muted/30 rounded-xl border p-4">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="text-muted-foreground size-5" />
            <span className="text-foreground text-sm font-medium">
              {t.settings.openclawConnectionStatus || 'Connection Status'}
            </span>
          </div>
          <button
            onClick={handleDetectConnection}
            disabled={detectStatus === 'loading'}
            className={cn(
              'text-foreground inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              'hover:bg-accent',
              'disabled:cursor-not-allowed disabled:opacity-50',
              detectStatus === 'success' &&
                'bg-green-500/10 text-green-600 hover:bg-green-500/20',
              detectStatus === 'error' &&
                'bg-red-500/10 text-red-600 hover:bg-red-500/20'
            )}
          >
            {detectStatus === 'loading' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : detectStatus === 'success' ? (
              <Check className="size-4" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {detectStatus === 'loading'
              ? t.settings.openclawDetecting || 'Detecting...'
              : detectStatus === 'success'
                ? t.settings.openclawConnected || 'Connected'
                : detectStatus === 'error'
                  ? t.settings.openclawFailed || 'Failed'
                  : t.settings.openclawDetect || 'Detect Connection'}
          </button>
        </div>

        {detectMessage && (
          <div
            className={cn(
              'text-sm',
              detectStatus === 'success' ? 'text-green-600' : 'text-red-600'
            )}
          >
            {detectMessage}
          </div>
        )}

        {!detectMessage && detectStatus === 'idle' && (
          <div className="text-muted-foreground text-sm">
            {t.settings.openclawStatusIdle ||
              'Click "Detect Connection" to verify your OpenClaw Gateway configuration'}
          </div>
        )}
      </div>

      {/* Help Section */}
      <div className="border-border bg-muted/20 rounded-lg border p-4">
        <p className="text-muted-foreground text-sm">
          <strong className="text-foreground">
            {t.settings.openclawHelpTitle || 'About OpenClaw Bot:'}
          </strong>
          <br />
          {t.settings.openclawHelpText ||
            'OpenClaw Bot provides advanced AI capabilities through the Gateway protocol. Make sure the Gateway is running before detecting the connection.'}
        </p>
      </div>
    </div>
  );
}
