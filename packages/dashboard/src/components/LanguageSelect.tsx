import { Languages } from 'lucide-react';
import { useLocale, SUPPORTED_LOCALES, type Locale } from '#lib/contexts/LocaleContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@insforge/ui';

// Endonyms on purpose — each language is shown in itself.
const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  es: 'Español',
};

export function LanguageSelect() {
  const { locale, setLocale } = useLocale();

  return (
    <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
      <SelectTrigger
        className="h-9 w-9 justify-center rounded-lg border-0 bg-transparent p-0 focus:ring-0 focus:ring-offset-0 [&>svg]:hidden"
        aria-label="Language"
      >
        <SelectValue aria-label={locale}>
          <Languages className="h-5 w-5 text-gray-600 dark:text-gray-400" />
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="center" className="w-36">
        {SUPPORTED_LOCALES.map((l) => (
          <SelectItem key={l} value={l}>
            {LOCALE_LABELS[l]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
