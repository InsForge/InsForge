import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response, Router } from 'express';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { AppError } from '../../src/utils/errors';

interface RefreshPayload {
  sub: string;
  type: 'refresh';
  sessionType: 'user' | 'admin';
  csrfNonce: string;
}

interface AppErrorLike {
  statusCode: number;
  code: string;
  message: string;
}

const mocks = vi.hoisted(() => ({
  verifyRefreshToken: vi.fn(),
  verifyCsrfToken: vi.fn(),
}));

vi.mock('@/api/middlewares/auth.js', () => ({
  verifyUser: vi.fn((_req, _res, next: NextFunction) => next()),
  verifyOptionalUser: vi.fn((_req, _res, next: NextFunction) => next()),
  verifyAdmin: vi.fn((_req, _res, next: NextFunction) => next()),
  verifyToken: vi.fn((_req, _res, next: NextFunction) => next()),
}));

vi.mock('@/services/auth/auth.service.js', () => ({
  AuthService: {
    getInstance: () => ({
      register: vi.fn(),
      login: vi.fn(),
      getUserById: vi.fn(),
      transformUserRecordToSchema: vi.fn(),
      getUserSchemaById: vi.fn(),
    }),
  },
}));

vi.mock('@/services/auth/auth-config.service.js', () => ({
  AuthConfigService: {
    getInstance: () => ({
      getAuthConfig: vi.fn(),
      validateRedirectUrl: vi.fn(),
    }),
  },
}));

vi.mock('@/services/auth/auth-otp.service.js', () => ({
  OTPPurpose: {
    EMAIL_VERIFICATION: 'email_verification',
    PASSWORD_RESET: 'password_reset',
  },
  AuthOTPService: {
    getInstance: () => ({
      createOTP: vi.fn(),
      verifyOTP: vi.fn(),
      verifyToken: vi.fn(),
    }),
  },
}));

vi.mock('@/services/logs/audit.service.js', () => ({
  AuditService: { getInstance: () => ({ log: vi.fn() }) },
}));

vi.mock('@/services/secrets/secret.service.js', () => ({
  SecretService: { getInstance: () => ({ getAnonKey: vi.fn() }) },
}));

vi.mock('@/services/email/smtp-config.service.js', () => ({
  SmtpConfigService: { getInstance: () => ({}) },
}));

vi.mock('@/services/email/email-template.service.js', () => ({
  EmailTemplateService: { getInstance: () => ({}) },
}));

vi.mock('@/infra/socket/socket.manager.js', () => ({
  SocketManager: { getInstance: () => ({ broadcastToRoom: vi.fn() }) },
}));

vi.mock('@/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => ({
      verifyRefreshToken: mocks.verifyRefreshToken,
      verifyCsrfToken: mocks.verifyCsrfToken,
      generateAccessToken: vi.fn(),
      generateRefreshToken: vi.fn(),
      generateRefreshTokenWithCsrf: vi.fn(),
    }),
  },
}));

vi.mock('@/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const userPayload: RefreshPayload = {
  sub: 'user-1',
  type: 'refresh',
  sessionType: 'user',
  csrfNonce: 'nonce',
};

const adminPayload: RefreshPayload = {
  sub: 'admin',
  type: 'refresh',
  sessionType: 'admin',
  csrfNonce: 'nonce',
};

function callLogout(
  router: Router,
  overrides: {
    headers?: Request['headers'];
    cookies?: Record<string, string>;
    query?: Record<string, string>;
  } = {}
): Promise<{ statusCode: number; body: unknown; clearCookie: ReturnType<typeof vi.fn> }> {
  return new Promise((resolve) => {
    let statusCode = 200;

    const req: Partial<Request> = {
      url: '/logout',
      method: 'POST',
      headers: overrides.headers ?? {},
      query: overrides.query ?? {},
      cookies: overrides.cookies ?? {},
      body: {},
    };

    const clearCookie = vi.fn(() => res);
    const res: Partial<Response> = {
      status: vi.fn((code: number) => {
        statusCode = code;
        return res;
      }),
      json: vi.fn((body: unknown) => resolve({ statusCode, body, clearCookie })),
      clearCookie,
    };

    router(
      req as Request,
      res as Response,
      vi.fn((error?: unknown) => {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const appError = error as AppErrorLike;
          resolve({
            statusCode: appError.statusCode,
            body: {
              error: appError.code,
              message: appError.message,
              statusCode: appError.statusCode,
            },
            clearCookie,
          });
        }
      })
    );
  });
}

describe('POST /api/auth/logout CSRF policy', () => {
  let router: Router;

  beforeAll(async () => {
    router = (await import('../../src/api/routes/auth/index.routes.js')).default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyRefreshToken.mockReturnValue(userPayload);
    mocks.verifyCsrfToken.mockReturnValue(true);
  });

  it('keeps web logout idempotent when the refresh cookie is absent', async () => {
    const response = await callLogout(router);

    expect(response.statusCode).toBe(200);
    expect(response.clearCookie).toHaveBeenCalledOnce();
    expect(mocks.verifyRefreshToken).not.toHaveBeenCalled();
  });

  it('clears a stale web refresh cookie without requiring CSRF', async () => {
    mocks.verifyRefreshToken.mockImplementation(() => {
      throw new AppError('Invalid or expired refresh token', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    });

    const response = await callLogout(router, {
      cookies: { insforge_refresh_token: 'stale-refresh-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.clearCookie).toHaveBeenCalledOnce();
    expect(mocks.verifyCsrfToken).not.toHaveBeenCalled();
  });

  it('rejects a valid web refresh cookie when CSRF is missing', async () => {
    mocks.verifyCsrfToken.mockReturnValue(false);

    const response = await callLogout(router, {
      cookies: { insforge_refresh_token: 'valid-refresh-token' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.clearCookie).not.toHaveBeenCalled();
    expect(mocks.verifyCsrfToken).toHaveBeenCalledWith(undefined, userPayload);
  });

  it('rejects a valid web refresh cookie when CSRF header is multi-valued', async () => {
    mocks.verifyCsrfToken.mockReturnValue(false);

    const response = await callLogout(router, {
      cookies: { insforge_refresh_token: 'valid-refresh-token' },
      headers: { 'x-csrf-token': ['csrf-a', 'csrf-b'] },
    });

    expect(response.statusCode).toBe(403);
    expect(response.clearCookie).not.toHaveBeenCalled();
    expect(mocks.verifyCsrfToken).toHaveBeenCalledWith(undefined, userPayload);
  });

  it('rejects non-user refresh sessions', async () => {
    mocks.verifyRefreshToken.mockReturnValue({
      ...userPayload,
      sessionType: 'admin',
    });

    const response = await callLogout(router, {
      cookies: { insforge_refresh_token: 'admin-refresh-token' },
      headers: { 'x-csrf-token': 'csrf-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.clearCookie).not.toHaveBeenCalled();
    expect(mocks.verifyCsrfToken).not.toHaveBeenCalled();
  });

  it('clears a valid web refresh cookie when CSRF is valid', async () => {
    const response = await callLogout(router, {
      cookies: { insforge_refresh_token: 'valid-refresh-token' },
      headers: { 'x-csrf-token': 'csrf-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.clearCookie).toHaveBeenCalledOnce();
    expect(mocks.verifyCsrfToken).toHaveBeenCalledWith('csrf-token', userPayload);
  });

  it('leaves non-web logout unchanged', async () => {
    const response = await callLogout(router, {
      query: { client_type: 'mobile' },
      cookies: { insforge_refresh_token: 'valid-refresh-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.clearCookie).not.toHaveBeenCalled();
    expect(mocks.verifyRefreshToken).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/admin/logout CSRF policy', () => {
  let router: Router;

  beforeAll(async () => {
    router = (await import('../../src/api/routes/auth/admin.routes.js')).default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyRefreshToken.mockReturnValue(adminPayload);
    mocks.verifyCsrfToken.mockReturnValue(true);
  });

  it('keeps admin logout idempotent when the refresh cookie is absent', async () => {
    const response = await callLogout(router);

    expect(response.statusCode).toBe(200);
    expect(response.clearCookie).toHaveBeenCalledOnce();
    expect(mocks.verifyRefreshToken).not.toHaveBeenCalled();
  });

  it('clears a stale admin refresh cookie without requiring CSRF', async () => {
    mocks.verifyRefreshToken.mockImplementation(() => {
      throw new AppError('Invalid or expired refresh token', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    });

    const response = await callLogout(router, {
      cookies: { insforge_admin_refresh_token: 'stale-admin-refresh-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.clearCookie).toHaveBeenCalledOnce();
    expect(mocks.verifyCsrfToken).not.toHaveBeenCalled();
  });

  it('rejects a valid admin refresh cookie when CSRF is missing', async () => {
    mocks.verifyCsrfToken.mockReturnValue(false);

    const response = await callLogout(router, {
      cookies: { insforge_admin_refresh_token: 'valid-admin-refresh-token' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.clearCookie).not.toHaveBeenCalled();
    expect(mocks.verifyCsrfToken).toHaveBeenCalledWith(undefined, adminPayload);
  });

  it('rejects a valid admin refresh cookie when CSRF header is multi-valued', async () => {
    mocks.verifyCsrfToken.mockReturnValue(false);

    const response = await callLogout(router, {
      cookies: { insforge_admin_refresh_token: 'valid-admin-refresh-token' },
      headers: { 'x-csrf-token': ['csrf-a', 'csrf-b'] },
    });

    expect(response.statusCode).toBe(403);
    expect(response.clearCookie).not.toHaveBeenCalled();
    expect(mocks.verifyCsrfToken).toHaveBeenCalledWith(undefined, adminPayload);
  });

  it('rejects non-admin refresh sessions', async () => {
    mocks.verifyRefreshToken.mockReturnValue(userPayload);

    const response = await callLogout(router, {
      cookies: { insforge_admin_refresh_token: 'user-refresh-token' },
      headers: { 'x-csrf-token': 'csrf-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.clearCookie).not.toHaveBeenCalled();
    expect(mocks.verifyCsrfToken).not.toHaveBeenCalled();
  });

  it('clears a valid admin refresh cookie when CSRF is valid', async () => {
    const response = await callLogout(router, {
      cookies: { insforge_admin_refresh_token: 'valid-admin-refresh-token' },
      headers: { 'x-csrf-token': 'csrf-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.clearCookie).toHaveBeenCalledOnce();
    expect(mocks.verifyCsrfToken).toHaveBeenCalledWith('csrf-token', adminPayload);
  });
});
