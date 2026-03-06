import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/lib/contexts/ThemeContext';

const CYCLE: Record<string, 'light' | 'dark' | 'system'> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

const LABELS: Record<string, string> = {
  light: 'Switch to dark',
  dark: 'Switch to system',
  system: 'Switch to light',
};

export function ThemeSelect() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const Icon = theme === 'system' ? Monitor : resolvedTheme === 'light' ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={() => setTheme(CYCLE[theme] ?? 'system')}
      aria-label={LABELS[theme]}
      className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-alpha-4 transition-colors"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
