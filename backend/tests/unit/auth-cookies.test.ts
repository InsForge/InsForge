import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import {
  ADMIN_REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  clearAdminRefreshTokenCookie,
  clearRefreshTokenCookie,
  setAdminRefreshTokenCookie,
  setRefreshTokenCookie,
} from '../../src/utils/cookies';

function createResponseMock(): Response {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as Response;
}

describe('auth refresh cookies', () => {
  it('stores app refresh tokens in the app auth cookie path', () => {
    const res = createResponseMock();

    setRefreshTokenCookie(res, 'user-refresh-token');

    expect(res.cookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE_NAME, 'user-refresh-token', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  });

  it('stores admin refresh tokens in the admin auth cookie path', () => {
    const res = createResponseMock();

    setAdminRefreshTokenCookie(res, 'admin-refresh-token');

    expect(res.cookie).toHaveBeenCalledWith(
      ADMIN_REFRESH_TOKEN_COOKIE_NAME,
      'admin-refresh-token',
      {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/api/auth/admin',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      }
    );
  });

  it('clears app and admin refresh cookies independently', () => {
    const res = createResponseMock();

    clearRefreshTokenCookie(res);
    clearAdminRefreshTokenCookie(res);

    expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/api/auth',
    });
    expect(res.clearCookie).toHaveBeenCalledWith(ADMIN_REFRESH_TOKEN_COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/api/auth/admin',
    });
  });
});
