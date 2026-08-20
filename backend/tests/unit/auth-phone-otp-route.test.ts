import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response, Router } from 'express';

interface RouteError {
  statusCode: number;
  code: string;
  message: string;
}

const mocks = vi.hoisted(() => ({
  sendPhoneSignInOTP: vi.fn(),
  signInWithOTP: vi.fn(),
  signInWithPhoneOTP: vi.fn(),
  verifyOTPRequest: vi.fn(),
  generateRefreshToken: vi.fn(),
  generateRefreshTokenWithCsrf: vi.fn(),
}));

vi.mock('@/services/auth/auth.service.js', () => ({
  AuthService: {
    getInstance: () => ({
      sendPhoneSignInOTP: mocks.sendPhoneSignInOTP,
      signInWithOTP: mocks.signInWithOTP,
      signInWithPhoneOTP: mocks.signInWithPhoneOTP,
    }),
  },
}));

vi.mock('@/api/middlewares/rate-limiters.js', () => ({
  idTokenSignInRateLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  sendEmailOTPLimiter: [(_req: Request, _res: Response, next: NextFunction) => next()],
  sendSmsOTPLimiter: [(_req: Request, _res: Response, next: NextFunction) => next()],
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
    email: null,
    emailVerified: false,
    phone: '+15551234567',
    phoneVerified: true,
    providers: ['phone'],
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

describe('phone OTP auth routes', () => {
  let router: Router;

  beforeAll(async () => {
    router = (await import('../../src/api/routes/auth/index.routes.js')).default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendPhoneSignInOTP.mockResolvedValue(undefined);
    mocks.signInWithOTP.mockResolvedValue({ ...SESSION });
    mocks.signInWithPhoneOTP.mockResolvedValue({ ...SESSION });
    mocks.generateRefreshToken.mockReturnValue('refresh-token');
    mocks.generateRefreshTokenWithCsrf.mockReturnValue({
      refreshToken: 'refresh-token',
      csrfToken: 'csrf-token',
    });
  });

  it('returns a generic 202 without requiring an existing user', async () => {
    const result = await callRoute(router, '/phone/send-otp', { phone: '+15551234567' });

    expect(result.statusCode).toBe(202);
    expect(result.body).toEqual({
      success: true,
      message: 'If sign-in is available for this phone number, we have sent a verification code.',
    });
    expect(mocks.sendPhoneSignInOTP).toHaveBeenCalledWith('+15551234567');
  });

  it('rejects a malformed phone number before hitting the service', async () => {
    const result = await callRoute(router, '/phone/send-otp', { phone: '555-1234' });

    expect(result.statusCode).toBe(400);
    expect(mocks.sendPhoneSignInOTP).not.toHaveBeenCalled();
  });

  it('dispatches a phone-keyed OTP session to the phone sign-in path', async () => {
    const result = await callRoute(router, '/sessions', {
      method: 'otp',
      phone: '+15551234567',
      otp: '123456',
      name: 'Ada Lovelace',
    });

    expect(result.statusCode).toBe(200);
    expect(mocks.signInWithPhoneOTP).toHaveBeenCalledWith('+15551234567', '123456', 'Ada Lovelace');
    expect(mocks.signInWithOTP).not.toHaveBeenCalled();
    // The OTP session limiter applies to phone OTP requests too.
    expect(mocks.verifyOTPRequest).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+15551234567' })
    );
    expect(result.cookie).toHaveBeenCalled();
    expect(result.body).toMatchObject({ csrfToken: 'csrf-token' });
  });

  it('keeps email-keyed OTP sessions on the email sign-in path', async () => {
    const result = await callRoute(router, '/sessions', {
      method: 'otp',
      email: 'user@example.com',
      otp: '123456',
    });

    expect(result.statusCode).toBe(200);
    expect(mocks.signInWithOTP).toHaveBeenCalledWith('user@example.com', '123456', undefined);
    expect(mocks.signInWithPhoneOTP).not.toHaveBeenCalled();
  });

  it('returns a refresh token in the body for native phone OTP clients', async () => {
    const result = await callRoute(
      router,
      '/sessions',
      { method: 'otp', phone: '+15551234567', otp: '123456' },
      { client_type: 'mobile' }
    );

    expect(result.statusCode).toBe(200);
    expect(result.cookie).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ refreshToken: 'refresh-token' });
  });

  it('rejects a session providing both email and phone', async () => {
    const result = await callRoute(router, '/sessions', {
      method: 'otp',
      email: 'user@example.com',
      phone: '+15551234567',
      otp: '123456',
    });

    expect(result.statusCode).toBe(400);
    expect(mocks.signInWithOTP).not.toHaveBeenCalled();
    expect(mocks.signInWithPhoneOTP).not.toHaveBeenCalled();
  });
});
