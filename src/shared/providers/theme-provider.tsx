import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  accentColors,
  getSettings,
  saveSettings,
  type AccentColor,
  type BackgroundStyle,
} from '@/shared/db/settings';

async function syncTauriTheme(theme: 'light' | 'dark' | 'system') {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    // Pass null to follow system theme
    await getCurrentWindow().setTheme(theme === 'system' ? null : theme);
  } catch (e) {
    console.warn('[Theme] Failed to sync Tauri window theme:', e);
  }
}

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  accentColor: AccentColor;
  backgroundStyle: BackgroundStyle;
  setTheme: (theme: Theme) => void;
  setAccentColor: (color: AccentColor) => void;
  setBackgroundStyle: (style: BackgroundStyle) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') {
    return getSystemTheme();
  }
  return theme;
}

function applyTheme(resolvedTheme: ResolvedTheme) {
  const root = document.documentElement;
  if (resolvedTheme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

function applyAccentColor(colorId: AccentColor, resolvedTheme: ResolvedTheme) {
  const colorConfig = accentColors.find((c) => c.id === colorId);
  if (!colorConfig) return;

  const root = document.documentElement;
  const color =
    resolvedTheme === 'dark' ? colorConfig.darkColor : colorConfig.color;

  // Set primary color CSS variable
  root.style.setProperty('--primary', color);
  root.style.setProperty('--ring', color);
  root.style.setProperty('--sidebar-primary', color);
  root.style.setProperty('--sidebar-ring', color);
}

function applyBackgroundStyle(style: BackgroundStyle) {
  const root = document.documentElement;
  // Remove existing background style classes
  root.classList.remove('bg-warm', 'bg-cool');
  // Apply new background style class (default has no class)
  if (style !== 'default') {
    root.classList.add(`bg-${style}`);
  }
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const settings = getSettings();
    return settings.theme;
  });

  const [accentColor, setAccentColorState] = useState<AccentColor>(() => {
    const settings = getSettings();
    return settings.accentColor || 'orange';
  });

  const [backgroundStyle, setBackgroundStyleState] = useState<BackgroundStyle>(
    () => {
      const settings = getSettings();
      return settings.backgroundStyle || 'default';
    }
  );

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    const settings = getSettings();
    return resolveTheme(settings.theme);
  });

  // Apply theme, accent color, and background style on mount and when they change
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyTheme(resolved);
    applyAccentColor(accentColor, resolved);
    applyBackgroundStyle(backgroundStyle);
  }, [theme, accentColor, backgroundStyle]);

  useEffect(() => {
    void syncTauriTheme(theme);
  }, [theme]);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      const newResolvedTheme: ResolvedTheme = e.matches ? 'dark' : 'light';
      setResolvedTheme(newResolvedTheme);
      applyTheme(newResolvedTheme);
      applyAccentColor(accentColor, newResolvedTheme);
      applyBackgroundStyle(backgroundStyle);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, accentColor, backgroundStyle]);

  // Apply on initial load
  useEffect(() => {
    applyTheme(resolvedTheme);
    applyAccentColor(accentColor, resolvedTheme);
    applyBackgroundStyle(backgroundStyle);
  }, []);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    const settings = getSettings();
    saveSettings({ ...settings, theme: newTheme });
  };

  const setAccentColor = (newColor: AccentColor) => {
    setAccentColorState(newColor);
    const settings = getSettings();
    saveSettings({ ...settings, accentColor: newColor });
    applyAccentColor(newColor, resolvedTheme);
  };

  const setBackgroundStyle = (newStyle: BackgroundStyle) => {
    setBackgroundStyleState(newStyle);
    const settings = getSettings();
    saveSettings({ ...settings, backgroundStyle: newStyle });
    applyBackgroundStyle(newStyle);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        accentColor,
        backgroundStyle,
        setTheme,
        setAccentColor,
        setBackgroundStyle,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
