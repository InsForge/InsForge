import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response, Router } from 'express';

interface AppErrorLike {
  statusCode: number;
  code: string;
  message: string;
}

const mocks = vi.hoisted(() => ({
  signInWithIdToken: vi.fn(),
  idTokenRateLimit: vi.fn(),
  generateRefreshToken: vi.fn().mockReturnValue('mobile-refresh-token'),
  generateRefreshTokenWithCsrf: vi.fn(),
}));

vi.mock('@/api/middlewares/auth.js', () => ({
  verifyUser: vi.fn((_req, _res, next: NextFunction) => next()),
  verifyOptionalUser: vi.fn((_req, _res, next: NextFunction) => next()),
  verifyAdmin: vi.fn((_req, _res, next: NextFunction) => next()),
  verifyToken: vi.fn((_req, _res, next: NextFunction) => next()),
}));

vi.mock('@/api/middlewares/rate-limiters.js', () => ({
  idTokenSignInRateLimiter: (_req: Request, _res: Response, next: NextFunction) => {
    mocks.idTokenRateLimit();
    next();
  },
  sendEmailOTPLimiter: [(_req: Request, _res: Response, next: NextFunction) => next()],
  verifyOTPLimiter: [(_req: Request, _res: Response, next: NextFunction) => next()],
  verifyOTPRateLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('@/services/auth/auth.service.js', () => ({
  AuthService: {
    getInstance: () => ({ signInWithIdToken: mocks.signInWithIdToken }),
  },
}));

vi.mock('@/services/auth/auth-config.service.js', () => ({
  AuthConfigService: {
    getInstance: () => ({ getAuthConfig: vi.fn(), validateRedirectUrl: vi.fn() }),
  },
}));

vi.mock('@/services/auth/auth-otp.service.js', () => ({
  AuthOTPService: { getInstance: () => ({}) },
  OTPPurpose: {},
}));

vi.mock('@/services/logs/audit.service.js', () => ({
  AuditService: { getInstance: () => ({ log: vi.fn() }) },
}));

vi.mock('@/services/secrets/secret.service.js', () => ({
  SecretService: { getInstance: () => ({}) },
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
      generateRefreshToken: mocks.generateRefreshToken,
      generateRefreshTokenWithCsrf: mocks.generateRefreshTokenWithCsrf,
    }),
  },
}));

vi.mock('@/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const baseSession = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'relay@privaterelay.appleid.com',
    emailVerified: true,
    providers: ['apple'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    profile: { name: 'Apple User', avatar_url: '' },
    metadata: null,
  },
  accessToken: 'access-token',
};

function callRoute(
  router: Router,
  body: Record<string, unknown>,
  clientType = 'mobile'
): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const req: Partial<Request> = {
      url: '/id-token',
      method: 'POST',
      headers: {},
      query: { client_type: clientType },
      body,
    };
    const res: Partial<Response> = {
      status: vi.fn((code: number) => {
        statusCode = code;
        return res;
      }),
      json: vi.fn((responseBody: unknown) => resolve({ statusCode, body: responseBody })),
      cookie: vi.fn(() => res),
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
          });
          return;
        }
        reject(error instanceof Error ? error : new Error(`Unexpected next: ${String(error)}`));
      })
    );
  });
}

describe('POST /api/auth/id-token', () => {
  let router: Router;

  beforeAll(async () => {
    router = (await import('../../src/api/routes/auth/index.routes.js')).default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateRefreshToken.mockReturnValue('mobile-refresh-token');
    mocks.signInWithIdToken.mockResolvedValue({
      ...baseSession,
      user: { ...baseSession.user },
    });
  });

  it('exchanges a native Apple credential for a mobile session', async () => {
    const response = await callRoute(router, {
      provider: 'apple',
      token: 'apple-token',
      nonce: 'native-nonce',
      name: '  First Sign In Name  ',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'mobile-refresh-token',
    });
    expect(mocks.signInWithIdToken).toHaveBeenCalledWith('apple', 'apple-token', {
      nonce: 'native-nonce',
      name: 'First Sign In Name',
    });
  });

  it('rate limits requests before external token verification', async () => {
    await callRoute(router, {
      provider: 'apple',
      token: 'apple-token',
      nonce: 'native-nonce',
    });

    expect(mocks.idTokenRateLimit).toHaveBeenCalledOnce();
    expect(mocks.idTokenRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signInWithIdToken.mock.invocationCallOrder[0]
    );
  });

  it('rejects Apple requests without a nonce', async () => {
    const response = await callRoute(router, {
      provider: 'apple',
      token: 'apple-token',
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('rejects a caller-selected Apple audience', async () => {
    const response = await callRoute(router, {
      provider: 'apple',
      token: 'apple-token',
      nonce: 'native-nonce',
      audience: 'com.attacker.app',
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('keeps the existing Google request contract', async () => {
    const response = await callRoute(router, {
      provider: 'google',
      token: 'google-token',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.signInWithIdToken).toHaveBeenCalledWith('google', 'google-token');
  });

  it('rejects unsupported providers', async () => {
    const response = await callRoute(router, {
      provider: 'github',
      token: 'github-token',
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.signInWithIdToken).not.toHaveBeenCalled();
  });
});
