import { Sun, Moon, Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '#lib/contexts/ThemeContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@insforge/ui';

export function ThemeSelect() {
  const { t } = useTranslation('chrome');
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <Select value={theme} onValueChange={setTheme}>
      <SelectTrigger
        className="h-9 w-9 justify-center rounded-lg border-0 bg-transparent p-0 focus:ring-0 focus:ring-offset-0 [&>svg]:hidden"
        aria-label="Toggle theme"
      >
        <SelectValue aria-label={theme}>
          {resolvedTheme === 'light' ? (
            <Sun className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          ) : (
            <Moon className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="center" className="w-36">
        <SelectItem value="light" icon={<Sun />}>
          {t('theme.light')}
        </SelectItem>
        <SelectItem value="dark" icon={<Moon />}>
          {t('theme.dark')}
        </SelectItem>
        <SelectItem value="system" icon={<Monitor />}>
          {t('theme.system')}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
