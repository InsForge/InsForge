import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '#lib/api/client';
import { setDashboardBackendUrl } from '#lib/config/runtime';
import { loginService } from './login.service';

beforeEach(() => {
  vi.stubGlobal('document', { cookie: '' });
});

afterEach(() => {
  apiClient.clearTokens();
  setDashboardBackendUrl('');
  vi.unstubAllGlobals();
});

describe('LoginService refreshAccessToken', () => {
  it('uses the configured dashboard API base URL for admin refresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          accessToken: 'new-access-token',
          csrfToken: 'new-csrf-token',
        })
      ),
      headers: new Headers(),
    });
    vi.stubGlobal('fetch', fetchMock);
    setDashboardBackendUrl('https://dashboard.example.com/');
    apiClient.setCsrfToken('csrf-token');

    const refreshed = await loginService.refreshAccessToken();

    expect(refreshed).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://dashboard.example.com/api/auth/admin/refresh',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-token',
        }),
        signal: expect.any(AbortSignal),
      })
    );
  });
});

describe('LoginService logout', () => {
  it('sends the stored CSRF token on admin logout', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true })),
      headers: new Headers(),
    });
    vi.stubGlobal('fetch', fetchMock);
    setDashboardBackendUrl('https://dashboard.example.com/');
    apiClient.setAccessToken('access-token');
    apiClient.setCsrfToken('csrf-token');

    await loginService.logout();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://dashboard.example.com/api/auth/admin/logout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'X-CSRF-Token': 'csrf-token',
        }),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('omits the CSRF token header on admin logout when no CSRF token is stored', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true })),
      headers: new Headers(),
    });
    vi.stubGlobal('fetch', fetchMock);
    setDashboardBackendUrl('https://dashboard.example.com/');
    apiClient.setAccessToken('access-token');
    apiClient.clearCsrfToken();

    await loginService.logout();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://dashboard.example.com/api/auth/admin/logout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.not.objectContaining({
          'X-CSRF-Token': expect.any(String),
        }),
        signal: expect.any(AbortSignal),
      })
    );
  });
});
