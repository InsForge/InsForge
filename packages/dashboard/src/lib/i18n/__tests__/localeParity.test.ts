import { describe, expect, it } from 'vitest';
import en from '#lib/i18n/locales/en.json';
import zhCN from '#lib/i18n/locales/zh-CN.json';
import zhTW from '#lib/i18n/locales/zh-TW.json';
import es from '#lib/i18n/locales/es.json';

// Every key present in en must exist in every other locale (and vice versa),
// so a string added in one file can't silently ship untranslated. Plural
// suffixes are normalized first: Chinese has no plural forms, so zh files
// carry only `_other` where en has `_one`/`_other`.
function keysOf(obj: Record<string, unknown>, prefix = ''): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') {
      for (const nested of keysOf(v as Record<string, unknown>, key)) {
        out.add(nested);
      }
    } else {
      out.add(key.replace(/_(one|other)$/, ''));
    }
  }
  return out;
}

const enKeys = keysOf(en);

describe.each([
  ['zh-CN', zhCN],
  ['zh-TW', zhTW],
  ['es', es],
] as const)('locale parity: %s', (_name, locale) => {
  const localeKeys = keysOf(locale as Record<string, unknown>);

  it('contains every en key', () => {
    expect([...enKeys].filter((k) => !localeKeys.has(k))).toEqual([]);
  });

  it('contains no keys missing from en', () => {
    expect([...localeKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });
});
