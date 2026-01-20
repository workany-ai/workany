import { useState, useEffect } from 'react';
import ImageLogo from '@/assets/logo.png';
import { ExternalLink } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getVersion } from '@tauri-apps/api/app';
import { useLanguage } from '@/shared/providers/language-provider';

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
    getVersion().then(setVersion).catch(() => setVersion('0.0.0'));
  }, []);

  return (
    <div className="space-y-6">
      {/* Product Info */}
      <div className="flex items-center gap-4">
        <img src={ImageLogo} alt="WorkAny" className="size-16 rounded-xl" />
        <div>
          <h2 className="text-foreground text-xl font-bold">WorkAny</h2>
          <p className="text-muted-foreground text-sm">{t.settings.aiPlatform}</p>
        </div>
      </div>

      {/* Version & Info */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border-border bg-muted/20 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs tracking-wider uppercase">
            {t.settings.version}
          </p>
          <p className="text-foreground mt-1 text-lg font-semibold">{version}</p>
        </div>
        <div className="border-border bg-muted/20 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs tracking-wider uppercase">
            {t.settings.build}
          </p>
          <p className="text-foreground mt-1 text-lg font-semibold">{__BUILD_DATE__}</p>
        </div>
      </div>

      {/* Author & Copyright */}
      <div className="space-y-3">
        <div className="border-border flex items-center justify-between rounded-lg border p-3">
          <span className="text-muted-foreground text-sm">{t.settings.author}</span>
          <button
            onClick={() => openExternalUrl('https://idoubi.ai?utm_source=workany_desktop')}
            className="text-foreground hover:text-primary flex cursor-pointer items-center gap-1 text-sm font-medium transition-colors"
          >
            idoubi
            <ExternalLink className="size-3" />
          </button>
        </div>
        <div className="border-border flex items-center justify-between rounded-lg border p-3">
          <span className="text-muted-foreground text-sm">{t.settings.copyright}</span>
          <span className="text-foreground text-sm font-medium">© 2026 ThinkAny</span>
        </div>
        <div className="border-border flex items-center justify-between rounded-lg border p-3">
          <span className="text-muted-foreground text-sm">{t.settings.license}</span>
          <span className="text-foreground text-sm font-medium">Apache 2.0</span>
        </div>
      </div>

      {/* Links */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => openExternalUrl('https://workany.ai')}
          className="border-border text-foreground hover:bg-accent flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors"
        >
          <ExternalLink className="size-4" />
          {t.settings.website}
        </button>
        <button
          onClick={() => openExternalUrl('https://github.com/workany-ai/workany/issues')}
          className="border-border text-foreground hover:bg-accent flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors"
        >
          <ExternalLink className="size-4" />
          {t.settings.reportIssue}
        </button>
      </div>

      {/* Built with ShipAny */}
      <div className="border-border border-t pt-4">
        <button
          onClick={() => openExternalUrl('https://shipany.ai?utm_source=workany_desktop')}
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
