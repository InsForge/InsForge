import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { LOCAL_STORAGE_KEYS } from '../utils/constants';
import { getLocalStorageItem, setLocalStorageItem } from '../utils/local-storage';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
  forcedTheme?: ResolvedTheme;
  storageKey?: string;
}

export function ThemeProvider({
  children,
  forcedTheme,
  storageKey = LOCAL_STORAGE_KEYS.theme,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (forcedTheme) {
      return forcedTheme;
    }

    const stored = getLocalStorageItem(storageKey);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }

    return 'system';
  });

  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const systemTheme: ResolvedTheme = systemPrefersDark ? 'dark' : 'light';
  const resolvedTheme = forcedTheme ?? (theme === 'system' ? systemTheme : theme);

  useEffect(() => {
    const root = window.document.documentElement;

    // Remove both classes first
    root.classList.remove('light', 'dark');

    // Add the resolved theme class
    root.classList.add(resolvedTheme);

    // Update meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', resolvedTheme === 'dark' ? '#0a0a0a' : '#ffffff');
    }
  }, [resolvedTheme]);

  const setTheme = (newTheme: Theme) => {
    if (forcedTheme) {
      return;
    }

    setThemeState(newTheme);
    setLocalStorageItem(storageKey, newTheme);
  };

  const toggleTheme = () => {
    if (forcedTheme) {
      return;
    }

    const newTheme = resolvedTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
