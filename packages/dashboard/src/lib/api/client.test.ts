import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '#lib/api/client';

function stubCookieEnvironment() {
  vi.stubGlobal('document', { cookie: '' });
}

describe('ApiClient CSRF cookie handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets the Secure attribute for CSRF cookies', () => {
    stubCookieEnvironment();
    const client = new ApiClient();

    client.setCsrfToken('csrf token');

    expect(document.cookie).toContain('insforge_admin_csrf_token=csrf%20token');
    expect(document.cookie).toContain('SameSite=Lax; Secure');
    expect(client.getCsrfToken()).toBe('csrf token');
  });

  it('clears CSRF cookies with matching attributes', () => {
    stubCookieEnvironment();
    const client = new ApiClient();

    client.clearCsrfToken();

    expect(document.cookie).toContain('insforge_admin_csrf_token=; max-age=0');
    expect(document.cookie).toContain('SameSite=Lax');
    expect(document.cookie).toContain('Secure');
  });
});

describe('ApiClient pagination parsing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a normal start-end/total Content-Range header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('[1,2,3]', {
        status: 206,
        headers: { 'content-range': '0-2/10' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient();

    const result = await client.request('/logs/audits');

    expect(result).toEqual({
      data: [1, 2, 3],
      pagination: { offset: 0, limit: 3, total: 10 },
    });
  });

  it('parses the */total empty-page Content-Range header without losing the total', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('[]', {
        status: 206,
        headers: { 'content-range': '*/5' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient();

    const result = await client.request('/logs/audits');

    expect(result).toEqual({
      data: [],
      pagination: { offset: 0, limit: 0, total: 5 },
    });
  });
});

describe('ApiClient streaming requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets the bearer token without imposing the normal request timeout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('stream'));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient();
    client.setAccessToken('admin-token');
    const controller = new AbortController();

    await client.requestStream('/dashboard/events', { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dashboard/events',
      expect.objectContaining({
        credentials: 'include',
        headers: { Authorization: 'Bearer admin-token' },
        signal: controller.signal,
      })
    );
  });

  it('refreshes an expired token once before opening the stream', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response('stream'));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient();
    client.setAccessToken('expired-token');
    client.setRefreshAccessTokenHandler(async () => {
      client.setAccessToken('fresh-token');
      return true;
    });

    await client.requestStream('/dashboard/events');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ headers: { Authorization: 'Bearer fresh-token' } })
    );
  });
});
