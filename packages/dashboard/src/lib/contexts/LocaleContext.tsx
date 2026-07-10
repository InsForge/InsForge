import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { LOCAL_STORAGE_KEYS } from '#lib/utils/constants';
import { getLocalStorageItem, setLocalStorageItem } from '#lib/utils/local-storage';

export const SUPPORTED_LOCALES = ['en', 'zh-CN', 'zh-TW', 'es'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Map an arbitrary locale-ish value (account preference, localStorage,
 * navigator.language) onto a supported locale. Exact tag match wins;
 * otherwise fall back to the first supported locale sharing the language
 * ('zh' -> 'zh-CN', 'es-MX' -> 'es'); null when nothing matches.
 */
export function normalizeLocale(value: unknown): Locale | null {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  const lower = value.toLowerCase();
  const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === lower);
  if (exact) {
    return exact;
  }
  // Traditional-Chinese regions/scripts map to zh-TW, not the first zh match.
  if (/^zh(-|$)/.test(lower)) {
    return /hant|tw|hk|mo/.test(lower) ? 'zh-TW' : 'zh-CN';
  }
  const language = lower.split('-')[0];
  return SUPPORTED_LOCALES.find((l) => l.split('-')[0] === language) ?? null;
}

interface LocaleContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

/**
 * Locale preference with the same shape as ThemeContext. Resolution order:
 * account preference from the cloud shell (cloud-hosting mode) >
 * localStorage > navigator.language > 'en'. Changing it persists to
 * localStorage and, in cloud-hosting mode, back to the account through the
 * host's onUpdatePreferredLocale callback so every surface stays in sync.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const host = useDashboardHost();
  const isCloudHosting = host.mode === 'cloud-hosting';
  const onRequestUserInfo = isCloudHosting ? host.onRequestUserInfo : undefined;
  const onUpdatePreferredLocale = isCloudHosting ? host.onUpdatePreferredLocale : undefined;

  const [locale, setLocaleState] = useState<Locale>(
    () =>
      normalizeLocale(getLocalStorageItem(LOCAL_STORAGE_KEYS.locale)) ??
      normalizeLocale(typeof navigator !== 'undefined' ? navigator.language : null) ??
      'en'
  );
  // An explicit user selection must win over a late-arriving account value
  // from the shell (the adoption request below resolves asynchronously).
  const userTouchedRef = useRef(false);

  // Cloud mode: adopt the account-level preference once user info arrives.
  useEffect(() => {
    if (!onRequestUserInfo) {
      return;
    }
    let cancelled = false;
    onRequestUserInfo()
      .then((info) => {
        const accountLocale = normalizeLocale(info.preferredLocale);
        if (accountLocale && !cancelled && !userTouchedRef.current) {
          setLocaleState(accountLocale);
          setLocalStorageItem(LOCAL_STORAGE_KEYS.locale, accountLocale);
        }
      })
      .catch(() => {
        // No account preference available; keep the local resolution.
      });
    return () => {
      cancelled = true;
    };
  }, [onRequestUserInfo]);

  const setLocale = (next: Locale) => {
    userTouchedRef.current = true;
    setLocaleState(next);
    setLocalStorageItem(LOCAL_STORAGE_KEYS.locale, next);
    onUpdatePreferredLocale?.(next);
  };

  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (context === undefined) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
}
