import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardHostProvider } from '#lib/config/DashboardHostContext';
import { LOCAL_STORAGE_KEYS } from '#lib/utils/constants';
import {
  LocaleProvider,
  normalizeLocale,
  useLocale,
  type Locale,
} from '#lib/contexts/LocaleContext';

function Consumer() {
  const { locale, setLocale } = useLocale();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <button onClick={() => setLocale('es')}>set-es</button>
    </div>
  );
}

function renderWithHost(host: Record<string, unknown>) {
  return render(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <DashboardHostProvider value={host as any}>
      <LocaleProvider>
        <Consumer />
      </LocaleProvider>
    </DashboardHostProvider>
  );
}

describe('normalizeLocale', () => {
  it('matches exact tags case-insensitively', () => {
    expect(normalizeLocale('zh-TW')).toBe('zh-TW');
    expect(normalizeLocale('ZH-cn')).toBe('zh-CN');
  });

  it('falls back to language match', () => {
    expect(normalizeLocale('zh')).toBe('zh-CN');
    expect(normalizeLocale('es-MX')).toBe('es');
    expect(normalizeLocale('en-GB')).toBe('en');
  });

  it('maps Traditional-Chinese regions to zh-TW', () => {
    expect(normalizeLocale('zh-HK')).toBe('zh-TW');
    expect(normalizeLocale('zh-Hant')).toBe('zh-TW');
    expect(normalizeLocale('zh-MO')).toBe('zh-TW');
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh-CN');
  });

  it('returns null for unsupported or invalid values', () => {
    expect(normalizeLocale('fr')).toBeNull();
    expect(normalizeLocale('')).toBeNull();
    expect(normalizeLocale(undefined)).toBeNull();
    expect(normalizeLocale(42)).toBeNull();
  });
});

describe('LocaleProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('adopts the account preference from the cloud shell', async () => {
    const onRequestUserInfo = vi.fn().mockResolvedValue({
      userId: 'u1',
      email: 't@insforge.dev',
      preferredLocale: 'zh-TW',
    });
    renderWithHost({ mode: 'cloud-hosting', onRequestUserInfo });

    await waitFor(() => expect(screen.getByTestId('locale').textContent).toBe('zh-TW'));
    expect(window.localStorage.getItem(LOCAL_STORAGE_KEYS.locale)).toBe('zh-TW');
  });

  it('reports changes back to the cloud shell and persists locally', async () => {
    const onRequestUserInfo = vi.fn().mockResolvedValue({
      userId: 'u1',
      email: 't@insforge.dev',
      preferredLocale: null,
    });
    const onUpdatePreferredLocale = vi.fn();
    renderWithHost({ mode: 'cloud-hosting', onRequestUserInfo, onUpdatePreferredLocale });

    await userEvent.click(screen.getByText('set-es'));

    expect(screen.getByTestId('locale').textContent).toBe('es');
    expect(onUpdatePreferredLocale).toHaveBeenCalledWith('es' satisfies Locale);
    expect(window.localStorage.getItem(LOCAL_STORAGE_KEYS.locale)).toBe('es');
  });

  it('keeps the local resolution when the account has no preference', async () => {
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.locale, 'zh-CN');
    const onRequestUserInfo = vi.fn().mockResolvedValue({
      userId: 'u1',
      email: 't@insforge.dev',
      preferredLocale: null,
    });
    renderWithHost({ mode: 'cloud-hosting', onRequestUserInfo });

    await waitFor(() => expect(onRequestUserInfo).toHaveBeenCalled());
    expect(screen.getByTestId('locale').textContent).toBe('zh-CN');
  });

  it('a user selection made before the account preference arrives is not clobbered', async () => {
    let resolveUserInfo!: (v: unknown) => void;
    const onRequestUserInfo = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveUserInfo = resolve;
      })
    );
    const onUpdatePreferredLocale = vi.fn();
    renderWithHost({ mode: 'cloud-hosting', onRequestUserInfo, onUpdatePreferredLocale });

    // User picks Spanish while the shell's USER_INFO is still in flight...
    await userEvent.click(screen.getByText('set-es'));
    // ...then a stale account preference lands.
    resolveUserInfo({ userId: 'u1', email: 't@insforge.dev', preferredLocale: 'zh-TW' });
    await waitFor(() => expect(onRequestUserInfo).toHaveBeenCalled());

    expect(screen.getByTestId('locale').textContent).toBe('es');
    expect(window.localStorage.getItem(LOCAL_STORAGE_KEYS.locale)).toBe('es');
  });

  it('falls back to navigator.language when localStorage is empty', () => {
    const spy = vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('zh-TW');
    try {
      renderWithHost({ mode: 'self-hosting' });
      expect(screen.getByTestId('locale').textContent).toBe('zh-TW');
    } finally {
      spy.mockRestore();
    }
  });

  it('self-hosting mode uses localStorage and never calls host callbacks', async () => {
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.locale, 'zh-TW');
    const onUpdatePreferredLocale = vi.fn();
    renderWithHost({ mode: 'self-hosting', onUpdatePreferredLocale });

    expect(screen.getByTestId('locale').textContent).toBe('zh-TW');
    await userEvent.click(screen.getByText('set-es'));
    expect(screen.getByTestId('locale').textContent).toBe('es');
    expect(onUpdatePreferredLocale).not.toHaveBeenCalled();
  });
});
