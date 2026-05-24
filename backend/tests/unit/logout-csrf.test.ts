import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/utils/errors';
import {
  assertValidWebLogoutCsrf,
  type CsrfTokenVerifier,
} from '../../src/api/routes/auth/logout-csrf';

const payload = {
  sub: 'user-1',
  type: 'refresh' as const,
  iss: 'insforge',
  csrfNonce: 'nonce',
  sessionType: 'user' as const,
};

function verifier(csrfValid: boolean): CsrfTokenVerifier {
  return {
    verifyRefreshToken: vi.fn().mockReturnValue(payload),
    verifyCsrfToken: vi.fn().mockReturnValue(csrfValid),
  };
}

describe('assertValidWebLogoutCsrf', () => {
  it('allows idempotent web logout when no refresh cookie is present', () => {
    const tokenVerifier = verifier(false);

    expect(() => assertValidWebLogoutCsrf({}, tokenVerifier)).not.toThrow();
    expect(tokenVerifier.verifyRefreshToken).not.toHaveBeenCalled();
  });

  it('requires a valid csrf token before clearing a web refresh cookie', () => {
    expect(() =>
      assertValidWebLogoutCsrf({ refreshToken: 'refresh-token' }, verifier(false))
    ).toThrow(AppError);
  });

  it('accepts a matching csrf token for a user refresh session', () => {
    const tokenVerifier = verifier(true);

    expect(() =>
      assertValidWebLogoutCsrf(
        { refreshToken: 'refresh-token', csrfToken: 'csrf-token' },
        tokenVerifier
      )
    ).not.toThrow();
    expect(tokenVerifier.verifyCsrfToken).toHaveBeenCalledWith('csrf-token', payload);
  });

  it('rejects refresh tokens from other session types', () => {
    const tokenVerifier: CsrfTokenVerifier = {
      verifyRefreshToken: vi.fn().mockReturnValue({ ...payload, sessionType: 'admin' }),
      verifyCsrfToken: vi.fn(),
    };

    expect(() =>
      assertValidWebLogoutCsrf(
        { refreshToken: 'refresh-token', csrfToken: 'csrf-token' },
        tokenVerifier
      )
    ).toThrow(AppError);
    expect(tokenVerifier.verifyCsrfToken).not.toHaveBeenCalled();
  });
});
