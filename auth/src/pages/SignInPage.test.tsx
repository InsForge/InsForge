import { describe, expect, it } from 'vitest';
import { buildSessionRedirectUrl } from '../lib/sessionRedirect';

describe('SignInPage', () => {
  it('preserves the consent redirect query string when appending session tokens', () => {
    const redirectUrl = buildSessionRedirectUrl(
      '/auth/device/consent?user_code=ABCDE-FGHIJ',
      {
        accessToken: 'access-token-123',
        csrfToken: 'csrf-token-123',
        user: {
          id: '11111111-1111-1111-1111-111111111111',
          email: 'user@example.com',
          profile: {
            name: 'Jane Doe',
          },
        },
      },
      'http://localhost'
    );

    const url = new URL(redirectUrl);

    expect(url.pathname).toBe('/auth/device/consent');
    expect(url.searchParams.get('user_code')).toBe('ABCDE-FGHIJ');
    expect(url.searchParams.get('access_token')).toBe('access-token-123');
    expect(url.searchParams.get('user_id')).toBe('11111111-1111-1111-1111-111111111111');
    expect(url.searchParams.get('email')).toBe('user@example.com');
    expect(url.searchParams.get('csrf_token')).toBe('csrf-token-123');
  });
});
