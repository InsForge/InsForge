import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response, Router } from 'express';

interface RouteError {
  statusCode: number;
  code: string;
  message: string;
}

const mocks = vi.hoisted(() => ({
  sendSignInOTP: vi.fn(),
  signInWithOTP: vi.fn(),
  login: vi.fn(),
  verifyOTPRequest: vi.fn(),
  generateRefreshToken: vi.fn(),
  generateRefreshTokenWithCsrf: vi.fn(),
}));

vi.mock('@/services/auth/auth.service.js', () => ({
  AuthService: {
    getInstance: () => ({
      sendSignInOTP: mocks.sendSignInOTP,
      signInWithOTP: mocks.signInWithOTP,
      login: mocks.login,
    }),
  },
}));

vi.mock('@/api/middlewares/rate-limiters.js', () => ({
  idTokenSignInRateLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  sendEmailOTPLimiter: [(_req: Request, _res: Response, next: NextFunction) => next()],
  verifyOTPLimiter: [(_req: Request, _res: Response, next: NextFunction) => next()],
  verifyOTPRateLimiter: (req: Request, _res: Response, next: NextFunction) => {
    mocks.verifyOTPRequest(req.body);
    next();
  },
}));

vi.mock('@/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => ({
      verifyToken: vi.fn(),
      generateAccessToken: vi.fn(),
      generateRefreshToken: mocks.generateRefreshToken,
      generateRefreshTokenWithCsrf: mocks.generateRefreshTokenWithCsrf,
    }),
  },
}));

vi.mock('@/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const SESSION = {
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    emailVerified: true,
    providers: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    profile: {},
    metadata: {},
  },
  accessToken: 'access-token',
};

function callRoute(
  router: Router,
  path: string,
  body: Record<string, unknown>,
  query: Record<string, string> = {}
): Promise<{ statusCode: number; body: unknown; cookie: ReturnType<typeof vi.fn> }> {
  return new Promise((resolve) => {
    let statusCode = 200;
    const cookie = vi.fn();
    const req: Partial<Request> = {
      url: path,
      method: 'POST',
      headers: {},
      query,
      body,
    };
    const res: Partial<Response> = {
      status: vi.fn((code: number) => {
        statusCode = code;
        return res;
      }),
      json: vi.fn((data: unknown) => resolve({ statusCode, body: data, cookie })),
      cookie: vi.fn((...args: unknown[]) => {
        cookie(...args);
        return res;
      }),
    };

    router(
      req as Request,
      res as Response,
      vi.fn((error?: unknown) => {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const routeError = error as RouteError;
          resolve({
            statusCode: routeError.statusCode,
            body: {
              error: routeError.code,
              message: routeError.message,
              statusCode: routeError.statusCode,
            },
            cookie,
          });
        }
      })
    );
  });
}

describe('email OTP auth routes', () => {
  let router: Router;

  beforeAll(async () => {
    router = (await import('../../src/api/routes/auth/index.routes.js')).default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendSignInOTP.mockResolvedValue(undefined);
    mocks.signInWithOTP.mockResolvedValue({ ...SESSION });
    mocks.login.mockResolvedValue({ ...SESSION });
    mocks.generateRefreshToken.mockReturnValue('refresh-token');
    mocks.generateRefreshTokenWithCsrf.mockReturnValue({
      refreshToken: 'refresh-token',
      csrfToken: 'csrf-token',
    });
  });

  it('accepts an email OTP request without requiring an existing user', async () => {
    const response = await callRoute(router, '/email/send-otp', {
      email: 'USER@Example.com',
    });

    expect(response.statusCode).toBe(202);
    expect(response.body).toMatchObject({ success: true });
    expect(mocks.sendSignInOTP).toHaveBeenCalledWith('user@example.com');
  });

  it('creates a web session with the OTP method through the existing cookie convention', async () => {
    const response = await callRoute(router, '/sessions', {
      method: 'otp',
      email: 'user@example.com',
      otp: '123456',
      name: 'Ada',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      accessToken: 'access-token',
      csrfToken: 'csrf-token',
    });
    expect(mocks.signInWithOTP).toHaveBeenCalledWith('user@example.com', '123456', 'Ada');
    expect(mocks.verifyOTPRequest).toHaveBeenCalledOnce();
    expect(mocks.generateRefreshTokenWithCsrf).toHaveBeenCalledWith(SESSION.user.id, 'user');
  });

  it('returns a refresh token in the body for native OTP clients', async () => {
    const response = await callRoute(
      router,
      '/sessions',
      { method: 'otp', email: 'user@example.com', otp: '123456' },
      { client_type: 'mobile' }
    );

    expect(response.body).toMatchObject({ refreshToken: 'refresh-token' });
    expect(mocks.generateRefreshToken).toHaveBeenCalledWith(SESSION.user.id, 'user');
  });

  it('keeps password sessions backward compatible without method or OTP rate limiting', async () => {
    const response = await callRoute(router, '/sessions', {
      email: 'user@example.com',
      password: 'securepassword123',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.login).toHaveBeenCalledWith('user@example.com', 'securepassword123');
    expect(mocks.signInWithOTP).not.toHaveBeenCalled();
    expect(mocks.verifyOTPRequest).not.toHaveBeenCalled();
  });

  it('dispatches an explicit password method without OTP rate limiting', async () => {
    const response = await callRoute(router, '/sessions', {
      method: 'password',
      email: 'user@example.com',
      password: 'securepassword123',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.login).toHaveBeenCalledWith('user@example.com', 'securepassword123');
    expect(mocks.verifyOTPRequest).not.toHaveBeenCalled();
  });

  it('preserves legacy field-level errors for an empty session request', async () => {
    const response = await callRoute(router, '/sessions', {});

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: 'INVALID_INPUT',
      message: 'email: Required, password: Required',
    });
  });

  it('returns OTP field-level errors for an incomplete OTP session request', async () => {
    const response = await callRoute(router, '/sessions', { method: 'otp' });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: 'INVALID_INPUT',
      message: 'email: Required, otp: Required',
    });
    expect(mocks.verifyOTPRequest).toHaveBeenCalledOnce();
    expect(mocks.signInWithOTP).not.toHaveBeenCalled();
  });
});
