import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Router, Request, Response, NextFunction } from 'express';

interface AppError {
  statusCode: number;
  code: string;
  message: string;
}

const mocks = vi.hoisted(() => ({
  verifyUser: vi.fn(),
  register: vi.fn(),
  getAuthConfig: vi.fn(),
  broadcastToRoom: vi.fn(),
  generateRefreshToken: vi.fn(),
  generateRefreshTokenWithCsrf: vi.fn(),
}));

vi.mock('@/api/middlewares/auth.js', () => ({
  verifyUser: mocks.verifyUser,
  verifyOptionalUser: mocks.verifyUser,
  verifyAdmin: vi.fn((_req, _res, next: NextFunction) => next()),
  requireRoot: vi.fn((_req, _res, next: NextFunction) => next()),
  verifyToken: vi.fn((_req, _res, next: NextFunction) => next()),
}));

vi.mock('@/services/auth/auth.service.js', () => ({
  AuthService: { getInstance: () => ({ register: mocks.register }) },
}));

vi.mock('@/services/auth/auth-config.service.js', () => ({
  AuthConfigService: {
    getInstance: () => ({
      getAuthConfig: mocks.getAuthConfig,
      validateRedirectUrl: vi.fn().mockResolvedValue(true),
    }),
  },
}));

vi.mock('@/infra/socket/socket.manager.js', () => ({
  SocketManager: { getInstance: () => ({ broadcastToRoom: mocks.broadcastToRoom }) },
}));

vi.mock('@/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => ({
      verifyToken: vi.fn(),
      generateAccessToken: vi.fn().mockReturnValue('test-access-token'),
      generateRefreshToken: mocks.generateRefreshToken,
      generateRefreshTokenWithCsrf: mocks.generateRefreshTokenWithCsrf,
    }),
  },
}));

vi.mock('@/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const NEW_USER = {
  user: {
    id: 'new-uuid',
    email: 'new@test.com',
    emailVerified: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    providers: ['email'],
    profile: { name: 'Test' },
    metadata: {},
  },
  accessToken: 'test-access-token',
};

function callRoute(
  router: Router,
  overrides: { headers?: Record<string, string>; body?: Record<string, unknown> }
): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve) => {
    let statusCode = 200;

    const req: Partial<Request> = {
      url: '/users',
      method: 'POST',
      headers: overrides.headers ?? {},
      query: {},
      body: overrides.body ?? {},
    };

    const res: Partial<Response> = {
      status: vi.fn((c: number) => {
        statusCode = c;
        return res;
      }),
      json: vi.fn((d: unknown) => resolve({ statusCode, body: d })),
      cookie: vi.fn(() => res),
    };

    router(
      req as Request,
      res as Response,
      vi.fn((error?: unknown) => {
        if (error && typeof error === 'object' && 'statusCode' in error) {
          const appError = error as AppError;
          resolve({
            statusCode: appError.statusCode ?? 500,
            body: {
              error: appError.code,
              message: appError.message,
              statusCode: appError.statusCode ?? 500,
            },
          });
        }
      })
    );
  });
}

describe('POST /api/auth/users – disableSignup gate', () => {
  let router: Router;

  beforeAll(async () => {
    router = (await import('../../src/api/routes/auth/index.routes.js')).default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validBody = { email: 'test@test.com', password: 'Pass1234', name: 'Test' };

  it('blocks anon/public signup when disableSignup=true', async () => {
    mocks.verifyUser.mockImplementation((req, _res, next) => {
      req.user = { id: 'anonymous', role: 'anon' };
      next();
    });
    mocks.getAuthConfig.mockResolvedValue({ disableSignup: true });

    const response = await callRoute(router, { body: validBody });

    expect(response.statusCode).toBe(403);
    expect((response.body as Record<string, unknown>).error).toBe('AUTH_SIGNUP_DISABLED');
    expect(mocks.getAuthConfig).toHaveBeenCalledOnce();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('allows API-key admin user creation when disableSignup=true', async () => {
    mocks.verifyUser.mockImplementation((req, _res, next) => {
      req.hasApiKey = true;
      next();
    });
    mocks.register.mockResolvedValue(NEW_USER);

    const response = await callRoute(router, { body: validBody });

    expect(response.statusCode).toBe(200);
    expect((response.body as Record<string, unknown>).user).toMatchObject({
      email: 'new@test.com',
    });
    expect(mocks.getAuthConfig).not.toHaveBeenCalled();
    expect(mocks.register).toHaveBeenCalledOnce();
    expect(mocks.register.mock.calls[0][4]).toMatchObject({ isAdminCreation: true });
  });

  it('allows admin JWT user creation when disableSignup=true', async () => {
    mocks.verifyUser.mockImplementation((req, _res, next) => {
      req.user = { id: 'admin-uuid', role: 'project_admin' };
      next();
    });
    mocks.register.mockResolvedValue(NEW_USER);

    const response = await callRoute(router, { body: validBody });

    expect(response.statusCode).toBe(200);
    expect(mocks.getAuthConfig).not.toHaveBeenCalled();
    expect(mocks.register.mock.calls[0][4]).toMatchObject({ isAdminCreation: true });
  });

  it('allows public signup when disableSignup=false', async () => {
    mocks.verifyUser.mockImplementation((req, _res, next) => {
      req.user = { id: 'anonymous', role: 'anon' };
      next();
    });
    mocks.getAuthConfig.mockResolvedValue({ disableSignup: false });
    mocks.register.mockResolvedValue(NEW_USER);
    mocks.generateRefreshTokenWithCsrf.mockReturnValue({ refreshToken: 'rt', csrfToken: 'csrf' });

    const response = await callRoute(router, { body: validBody });

    expect(response.statusCode).toBe(200);
    expect(mocks.getAuthConfig).toHaveBeenCalledOnce();
    expect(mocks.register).toHaveBeenCalledOnce();
    expect(mocks.register.mock.calls[0][4]).toMatchObject({ isAdminCreation: false });
  });

  it('returns 401 when no credentials are provided', async () => {
    mocks.verifyUser.mockImplementation((_req, res) => {
      res.status(401).json({
        error: 'AUTH_INVALID_CREDENTIALS',
        message: 'No token provided',
        statusCode: 401,
      });
    });

    const response = await callRoute(router, { body: validBody });

    expect(response.statusCode).toBe(401);
    expect((response.body as Record<string, unknown>).error).toBe('AUTH_INVALID_CREDENTIALS');
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid request body', async () => {
    mocks.verifyUser.mockImplementation((req, _res, next) => {
      req.user = { id: 'anonymous', role: 'anon' };
      next();
    });

    const response = await callRoute(router, { body: {} });

    expect(response.statusCode).toBe(400);
  });
});
