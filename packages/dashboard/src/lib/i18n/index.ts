import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import es from './locales/es.json';

// Dashboard UI translations, bundled with the package so cloud users and
// self-hosters both get them. The active language is driven by LocaleContext
// (account preference / localStorage / browser), not by i18next detection.
void i18n.use(initReactI18next).init({
  resources: {
    en: { chrome: en },
    'zh-CN': { chrome: zhCN },
    'zh-TW': { chrome: zhTW },
    es: { chrome: es },
  },
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'chrome',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
