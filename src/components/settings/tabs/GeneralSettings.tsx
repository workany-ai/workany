import type { Language } from '@/core/i18n/translations';
import {
  accentColors,
  backgroundStyles,
  type AccentColor,
  type BackgroundStyle,
} from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { useTheme } from '@/shared/providers/theme-provider';

import type { SettingsTabProps } from '../types';

export function GeneralSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const {
    theme,
    setTheme,
    accentColor,
    setAccentColor,
    backgroundStyle,
    setBackgroundStyle,
  } = useTheme();
  const { t, language, setLanguage } = useLanguage();

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    onSettingsChange({ ...settings, theme: newTheme });
  };

  const handleAccentColorChange = (newColor: AccentColor) => {
    setAccentColor(newColor);
    onSettingsChange({ ...settings, accentColor: newColor });
  };

  const handleLanguageChange = (newLang: Language) => {
    setLanguage(newLang);
    onSettingsChange({ ...settings, language: newLang });
  };

  const handleBackgroundStyleChange = (newStyle: BackgroundStyle) => {
    setBackgroundStyle(newStyle);
    onSettingsChange({ ...settings, backgroundStyle: newStyle });
  };

  return (
    <div className="space-y-8">
      {/* Language */}
      <div className="flex flex-col gap-2">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.language}
        </label>
        <select
          value={language}
          onChange={(e) => handleLanguageChange(e.target.value as Language)}
          className="border-input bg-background text-foreground focus:ring-ring block h-10 w-full max-w-xs cursor-pointer rounded-lg border px-3 text-sm focus:border-transparent focus:ring-2 focus:outline-none"
        >
          <option value="en-US">English</option>
          <option value="zh-CN">简体中文</option>
        </select>
      </div>

      {/* Theme Color */}
      <div className="flex flex-col gap-3">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.themeColor}
        </label>
        <div className="flex gap-3">
          {accentColors.map((colorOption) => (
            <button
              key={colorOption.id}
              onClick={() => handleAccentColorChange(colorOption.id)}
              className={cn(
                'group flex cursor-pointer flex-col items-center gap-2 focus:outline-none'
              )}
            >
              <div
                className={cn(
                  'flex size-10 items-center justify-center rounded-full transition-all',
                  accentColor === colorOption.id
                    ? 'ring-offset-background ring-2 ring-offset-2'
                    : 'hover:scale-110'
                )}
                style={{
                  backgroundColor: colorOption.color,
                  // @ts-expect-error CSS custom property
                  '--tw-ring-color':
                    accentColor === colorOption.id
                      ? colorOption.color
                      : undefined,
                }}
              >
                {accentColor === colorOption.id && (
                  <svg
                    className="size-5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
              <span
                className={cn(
                  'text-xs',
                  accentColor === colorOption.id
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground'
                )}
              >
                {colorOption.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Appearance */}
      <div className="flex flex-col gap-3">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.appearance}
        </label>
        <div className="flex gap-3">
          {/* Light */}
          <button
            onClick={() => handleThemeChange('light')}
            className="group flex cursor-pointer flex-col items-center gap-2 focus:outline-none"
          >
            <div
              className={cn(
                'flex h-20 w-28 items-center justify-center rounded-lg border-2 bg-white transition-all',
                theme === 'light'
                  ? 'border-primary ring-primary/20 ring-2'
                  : 'border-border hover:border-primary/50'
              )}
            >
              <div className="flex h-12 w-20 flex-col gap-1 rounded border border-gray-200 bg-gray-100 p-1.5">
                <div className="flex gap-1">
                  <div className="h-3 w-3 rounded-sm bg-gray-300" />
                  <div className="h-3 flex-1 rounded-sm bg-gray-200" />
                </div>
                <div className="flex-1 rounded-sm border border-gray-200 bg-white" />
              </div>
            </div>
            <span
              className={cn(
                'text-sm',
                theme === 'light'
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground'
              )}
            >
              {t.settings.light}
            </span>
          </button>

          {/* Dark */}
          <button
            onClick={() => handleThemeChange('dark')}
            className="group flex cursor-pointer flex-col items-center gap-2 focus:outline-none"
          >
            <div
              className={cn(
                'flex h-20 w-28 items-center justify-center rounded-lg border-2 bg-gray-900 transition-all',
                theme === 'dark'
                  ? 'border-primary ring-primary/20 ring-2'
                  : 'hover:border-primary/50 border-gray-700'
              )}
            >
              <div className="flex h-12 w-20 flex-col gap-1 rounded border border-gray-700 bg-gray-800 p-1.5">
                <div className="flex gap-1">
                  <div className="h-3 w-3 rounded-sm bg-gray-600" />
                  <div className="h-3 flex-1 rounded-sm bg-gray-700" />
                </div>
                <div className="flex-1 rounded-sm border border-gray-700 bg-gray-900" />
              </div>
            </div>
            <span
              className={cn(
                'text-sm',
                theme === 'dark'
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground'
              )}
            >
              {t.settings.dark}
            </span>
          </button>

          {/* System */}
          <button
            onClick={() => handleThemeChange('system')}
            className="group flex cursor-pointer flex-col items-center gap-2 focus:outline-none"
          >
            <div
              className={cn(
                'flex h-20 w-28 items-center justify-center overflow-hidden rounded-lg border-2 transition-all',
                theme === 'system'
                  ? 'border-primary ring-primary/20 ring-2'
                  : 'border-border hover:border-primary/50'
              )}
            >
              <div className="flex h-full w-full">
                {/* Left half - light */}
                <div className="flex h-full w-1/2 items-center justify-center bg-white">
                  <div className="flex h-12 w-10 flex-col gap-0.5 rounded-l border-y border-l border-gray-200 bg-gray-100 p-1">
                    <div className="h-2 w-2 rounded-sm bg-gray-300" />
                    <div className="flex-1 rounded-sm border border-gray-200 bg-white" />
                  </div>
                </div>
                {/* Right half - dark */}
                <div className="flex h-full w-1/2 items-center justify-center bg-gray-900">
                  <div className="flex h-12 w-10 flex-col gap-0.5 rounded-r border-y border-r border-gray-700 bg-gray-800 p-1">
                    <div className="h-2 w-2 rounded-sm bg-gray-600" />
                    <div className="flex-1 rounded-sm border border-gray-700 bg-gray-900" />
                  </div>
                </div>
              </div>
            </div>
            <span
              className={cn(
                'text-sm',
                theme === 'system'
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground'
              )}
            >
              {t.settings.system}
            </span>
          </button>
        </div>
      </div>

      {/* Background Style */}
      <div className="flex flex-col gap-3">
        <label className="text-foreground block text-sm font-medium">
          {t.settings.backgroundStyle || 'Background Style'}
        </label>
        <div className="flex gap-3">
          {backgroundStyles.map((styleOption) => (
            <button
              key={styleOption.id}
              onClick={() => handleBackgroundStyleChange(styleOption.id)}
              className="group flex cursor-pointer flex-col items-center gap-2 focus:outline-none"
            >
              <div
                className={cn(
                  'flex h-20 w-28 items-center justify-center rounded-lg border-2 transition-all',
                  styleOption.id === 'default'
                    ? 'bg-white'
                    : styleOption.id === 'warm'
                      ? 'bg-amber-50'
                      : 'bg-slate-50',
                  backgroundStyle === styleOption.id
                    ? 'border-primary ring-primary/20 ring-2'
                    : 'border-border hover:border-primary/50'
                )}
              >
                <div
                  className={cn(
                    'flex h-12 w-20 flex-col gap-1 rounded border p-1.5',
                    styleOption.id === 'default'
                      ? 'border-gray-200 bg-gray-100'
                      : styleOption.id === 'warm'
                        ? 'border-amber-200 bg-amber-100/50'
                        : 'border-slate-200 bg-slate-100'
                  )}
                >
                  <div className="flex gap-1">
                    <div
                      className={cn(
                        'h-3 w-3 rounded-sm',
                        styleOption.id === 'default'
                          ? 'bg-gray-300'
                          : styleOption.id === 'warm'
                            ? 'bg-amber-300'
                            : 'bg-slate-300'
                      )}
                    />
                    <div
                      className={cn(
                        'h-3 flex-1 rounded-sm',
                        styleOption.id === 'default'
                          ? 'bg-gray-200'
                          : styleOption.id === 'warm'
                            ? 'bg-amber-200'
                            : 'bg-slate-200'
                      )}
                    />
                  </div>
                  <div
                    className={cn(
                      'flex-1 rounded-sm border',
                      styleOption.id === 'default'
                        ? 'border-gray-200 bg-white'
                        : styleOption.id === 'warm'
                          ? 'border-amber-100 bg-amber-50/50'
                          : 'border-slate-200 bg-white'
                    )}
                  />
                </div>
              </div>
              <span
                className={cn(
                  'text-sm',
                  backgroundStyle === styleOption.id
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground'
                )}
              >
                {styleOption.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
