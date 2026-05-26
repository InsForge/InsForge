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
