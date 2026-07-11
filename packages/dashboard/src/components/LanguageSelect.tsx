import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocale, SUPPORTED_LOCALES, type Locale } from '#lib/contexts/LocaleContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@insforge/ui';

// Endonyms on purpose — each language is shown in itself.
const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  es: 'Español',
};

// Immediate feedback in the chosen language. Deliberately states only the
// switch itself: account persistence is fire-and-forget over postMessage and
// may be dropped by an older shell, so the toast must not overclaim it.
const CONFIRMATIONS: Record<Locale, string> = {
  en: 'Language set to English',
  'zh-CN': '语言已切换为简体中文',
  'zh-TW': '語言已切換為繁體中文',
  es: 'Idioma cambiado a Español',
};

export function LanguageSelect() {
  const { t } = useTranslation('chrome');
  const { locale, setLocale } = useLocale();
  const { showToast } = useToast();

  const handleChange = (value: string) => {
    const next = value as Locale;
    if (next === locale) {
      return;
    }
    setLocale(next);
    showToast(CONFIRMATIONS[next], 'success');
  };

  return (
    <Select value={locale} onValueChange={handleChange}>
      <SelectTrigger
        className="h-9 w-9 justify-center rounded-lg border-0 bg-transparent p-0 focus:ring-0 focus:ring-offset-0 [&>svg]:hidden"
        aria-label={t('header.language')}
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
