import { Languages } from 'lucide-react';
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

// Immediate feedback in the chosen language: the preference saves before the
// UI itself is translated, so the switch must not feel like a no-op.
const CONFIRMATIONS: Record<Locale, string> = {
  en: 'Language preference saved. Interface translation is coming soon.',
  'zh-CN': '语言偏好已保存，界面翻译即将推出。',
  'zh-TW': '語言偏好已儲存，介面翻譯即將推出。',
  es: 'Preferencia de idioma guardada. La traducción de la interfaz llegará pronto.',
};

export function LanguageSelect() {
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
