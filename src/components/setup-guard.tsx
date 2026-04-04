/**
 * Setup Guard Component
 *
 * Checks if an AI model provider is configured on app startup.
 * If not configured, shows a prompt to guide the user to model settings.
 */

import { useState, type ReactNode } from 'react';
import { isModelConfigured } from '@/shared/db/settings';
import { useLanguage } from '@/shared/providers/language-provider';
import { Settings2 } from 'lucide-react';

import { SettingsModal } from '@/components/settings';

interface SetupGuardProps {
  children: ReactNode;
}

// Kept for API compatibility with existing imports
export function clearDependencyCache() {
  // No-op
}

export function SetupGuard({ children }: SetupGuardProps) {
  const { t } = useLanguage();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Check if model is configured
  const configured = isModelConfigured();

  // If configured or user dismissed, pass through
  if (configured || dismissed) {
    return <>{children}</>;
  }

  return (
    <>
      <div className="bg-background flex min-h-svh items-center justify-center">
        <div className="flex max-w-md flex-col items-center gap-6 px-6 text-center">
          <div className="bg-primary/10 flex size-16 items-center justify-center rounded-2xl">
            <Settings2 className="text-primary size-8" />
          </div>
          <div className="space-y-2">
            <h1 className="text-foreground text-xl font-semibold">
              {t.setup?.modelNotConfigured || 'Model Not Configured'}
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t.setup?.modelNotConfiguredDescription ||
                'Please configure an AI model provider to get started.'}
            </p>
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center gap-2 rounded-lg px-6 text-sm font-medium transition-colors"
          >
            <Settings2 className="size-4" />
            {t.setup?.configureModel || 'Configure Model'}
          </button>
        </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          // When settings modal closes, re-check if model is now configured
          if (!open && isModelConfigured()) {
            setDismissed(true);
          }
        }}
        initialCategory="model"
      />
    </>
  );
}
