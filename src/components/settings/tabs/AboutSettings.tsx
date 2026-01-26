import { useEffect, useState } from 'react';
import ImageLogo from '@/assets/logo.png';
import { useLanguage } from '@/shared/providers/language-provider';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  Download,
  ExternalLink,
  Github,
  Globe,
  MessageSquareWarning,
} from 'lucide-react';

// Helper function to open external URLs
const openExternalUrl = async (url: string) => {
  try {
    await openUrl(url);
  } catch {
    window.open(url, '_blank');
  }
};

export function AboutSettings() {
  const { t } = useLanguage();
  const [version, setVersion] = useState('0.0.0');

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion('0.0.0'));
  }, []);

  return (
    <div className="space-y-6">
      {/* Product Info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <img src={ImageLogo} alt="WorkAny" className="size-16 rounded-xl" />
          <div>
            <h2 className="text-foreground text-xl font-bold">WorkAny</h2>
            <p className="text-muted-foreground text-sm">
              {t.settings.aiPlatform}
            </p>
          </div>
        </div>
        <button
          onClick={() =>
            openExternalUrl(
              'https://workany.ai/download?utm_source=workany_desktop'
            )
          }
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          <Download className="size-4" />
          {t.settings.downloadNewVersion}
        </button>
      </div>

      {/* Version & Info */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border-border bg-muted/20 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs tracking-wider uppercase">
            {t.settings.version}
          </p>
          <p className="text-foreground mt-1 text-lg font-semibold">
            {version}
          </p>
        </div>
        <div className="border-border bg-muted/20 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs tracking-wider uppercase">
            {t.settings.build}
          </p>
          <p className="text-foreground mt-1 text-lg font-semibold">
            {__BUILD_DATE__}
          </p>
        </div>
      </div>

      {/* Author & Copyright */}
      <div className="space-y-3">
        <div className="border-border flex items-center justify-between rounded-lg border p-3">
          <span className="text-muted-foreground text-sm">
            {t.settings.author}
          </span>
          <button
            onClick={() =>
              openExternalUrl('https://idoubi.ai?utm_source=workany_desktop')
            }
            className="text-foreground hover:text-primary flex cursor-pointer items-center gap-1 text-sm font-medium transition-colors"
          >
            idoubi
            <ExternalLink className="size-3" />
          </button>
        </div>
        <div className="border-border flex items-center justify-between rounded-lg border p-3">
          <span className="text-muted-foreground text-sm">
            {t.settings.copyright}
          </span>
          <button
            onClick={() =>
              openExternalUrl('https://thinkany.ai?utm_source=workany_desktop')
            }
            className="text-foreground hover:text-primary flex cursor-pointer items-center gap-1 text-sm font-medium transition-colors"
          >
            © 2026 ThinkAny
            <ExternalLink className="size-3" />
          </button>
        </div>
        <div className="border-border flex items-center justify-between rounded-lg border p-3">
          <span className="text-muted-foreground text-sm">
            {t.settings.license}
          </span>
          <button
            onClick={() =>
              openExternalUrl(
                'https://github.com/workany-ai/workany/blob/main/LICENSE'
              )
            }
            className="text-foreground hover:text-primary flex cursor-pointer items-center gap-1 text-sm font-medium transition-colors"
          >
            WorkAny Community License
            <ExternalLink className="size-3" />
          </button>
        </div>
      </div>

      {/* Links */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() =>
            openExternalUrl('https://workany.ai?utm_source=workany_desktop')
          }
          className="border-border text-foreground hover:bg-accent flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors"
        >
          <Globe className="size-4" />
          {t.settings.website}
        </button>
        <button
          onClick={() =>
            openExternalUrl('https://github.com/workany-ai/workany')
          }
          className="border-border text-foreground hover:bg-accent flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors"
        >
          <Github className="size-4" />
          {t.settings.viewSource}
        </button>
        <button
          onClick={() => openExternalUrl('https://discord.gg/rDSmZ8HS39')}
          className="border-border text-foreground hover:bg-accent flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors"
        >
          <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
          </svg>
          {t.settings.joinCommunity}
        </button>
        <button
          onClick={() => openExternalUrl('https://x.com/workanyai')}
          className="border-border text-foreground hover:bg-accent flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors"
        >
          <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          {t.settings.followUs}
        </button>
        <button
          onClick={() =>
            openExternalUrl('https://github.com/workany-ai/workany/issues')
          }
          className="border-border text-foreground hover:bg-accent flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors"
        >
          <MessageSquareWarning className="size-4" />
          {t.settings.reportIssue}
        </button>
      </div>

      {/* Built with ShipAny */}
      <div className="border-border border-t pt-4">
        <button
          onClick={() =>
            openExternalUrl('https://shipany.ai?utm_source=workany_desktop')
          }
          className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 text-sm transition-colors"
        >
          {t.settings.builtWith}
          <span className="font-medium">ShipAny</span>
          {t.settings.built}
          <ExternalLink className="size-3" />
        </button>
      </div>
    </div>
  );
}
