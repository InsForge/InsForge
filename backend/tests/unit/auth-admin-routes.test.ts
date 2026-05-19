import express, { type NextFunction, type Request, type Response as ExpressResponse } from 'express';
import cookieParser from 'cookie-parser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { type AddressInfo } from 'net';
import { resolve } from 'path';

const authServiceMock = vi.hoisted(() => ({
  adminLogin: vi.fn(),
  adminLoginWithAuthorizationCode: vi.fn(),
  getUserById: vi.fn(),
  transformUserRecordToSchema: vi.fn(),
}));

const tokenManagerMock = vi.hoisted(() => ({
  generateRefreshTokenWithCsrf: vi.fn(),
  generateAccessToken: vi.fn(),
  verifyRefreshToken: vi.fn(),
  verifyCsrfToken: vi.fn(),
}));

vi.mock('@/services/auth/auth.service.js', () => ({
  AuthService: {
    getInstance: () => authServiceMock,
  },
}));

vi.mock('@/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => tokenManagerMock,
  },
}));

vi.mock('@/utils/logger.js', () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import adminRouter from '../../src/api/routes/auth/admin.routes';
import { AppError } from '../../src/api/middlewares/error';
import { ERROR_CODES } from '../../src/types/error-constants';
import { ADMIN_REFRESH_TOKEN_COOKIE_NAME } from '../../src/utils/cookies';

function createAdminAuthApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth/admin', adminRouter);
  app.use((error: unknown, _req: Request, res: ExpressResponse, next: NextFunction) => {
    void next;

    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

async function postAdminRefresh(headers: Record<string, string>) {
  const server = createAdminAuthApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/admin/refresh`, {
      method: 'POST',
      headers,
    });
    await response.text();

    return {
      status: response.status,
      setCookie: response.headers.get('set-cookie'),
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

describe('admin auth route review regressions', () => {
  const adminRoutesSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/auth/admin.routes.ts'),
    'utf-8'
  );
  const userRoutesSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/auth/index.routes.ts'),
    'utf-8'
  );
  const authRouteSources = [
    adminRoutesSource,
    userRoutesSource,
    readFileSync(resolve(__dirname, '../../src/api/routes/auth/oauth.routes.ts'), 'utf-8'),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    tokenManagerMock.verifyRefreshToken.mockReturnValue({
      sub: 'admin-user-1',
      type: 'refresh',
      iss: 'insforge',
      csrfNonce: 'csrf-nonce-1',
      sessionType: 'admin',
    });
    tokenManagerMock.verifyCsrfToken.mockReturnValue(true);
    tokenManagerMock.generateAccessToken.mockReturnValue('access-token');
    tokenManagerMock.generateRefreshTokenWithCsrf.mockReturnValue({
      refreshToken: 'new-admin-refresh-token',
      csrfToken: 'new-admin-csrf-token',
    });
    authServiceMock.getUserById.mockResolvedValue({
      id: 'admin-user-1',
      email: 'admin@example.com',
      is_project_admin: true,
    });
    authServiceMock.transformUserRecordToSchema.mockReturnValue({
      id: 'admin-user-1',
      email: 'admin@example.com',
    });
  });

  it('returns a generic server error for unexpected authorization-code exchange failures', () => {
    expect(adminRoutesSource).toContain(
      "logger.error('[Auth:AdminSessionExchange] Failed to exchange admin session'"
    );
    expect(adminRoutesSource).toContain('ERROR_CODES.INTERNAL_ERROR');
    expect(adminRoutesSource).not.toContain('error.message');
  });

  it('preserves admin refresh cookies on non-auth transient refresh failures', async () => {
    authServiceMock.getUserById.mockRejectedValue(new Error('database temporarily unavailable'));

    const response = await postAdminRefresh({
      Cookie: `${ADMIN_REFRESH_TOKEN_COOKIE_NAME}=admin-refresh-token`,
      'x-csrf-token': 'csrf-token',
    });

    expect(response.status).toBe(500);
    expect(response.setCookie).toBeNull();
  });

  it('preserves admin refresh cookies on CSRF rejection', async () => {
    tokenManagerMock.verifyCsrfToken.mockReturnValue(false);

    const response = await postAdminRefresh({
      Cookie: `${ADMIN_REFRESH_TOKEN_COOKIE_NAME}=admin-refresh-token`,
      'x-csrf-token': 'csrf-token',
    });

    expect(response.status).toBe(403);
    expect(response.setCookie).toBeNull();
  });

  it('clears admin refresh cookies on auth-invalidating refresh failures', async () => {
    tokenManagerMock.verifyRefreshToken.mockImplementation(() => {
      throw new AppError('Invalid refresh token', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    });

    const response = await postAdminRefresh({
      Cookie: `${ADMIN_REFRESH_TOKEN_COOKIE_NAME}=admin-refresh-token`,
      'x-csrf-token': 'csrf-token',
    });

    expect(response.status).toBe(401);
    expect(response.setCookie).toContain(`${ADMIN_REFRESH_TOKEN_COOKIE_NAME}=;`);
  });

  it('does not decode freshly issued refresh tokens only to derive CSRF tokens', () => {
    for (const source of authRouteSources) {
      expect(source).not.toContain('generateCsrfToken(tokenManager.verifyRefreshToken');
      expect(source).not.toContain('verifyRefreshToken(newRefreshToken)');
      expect(source).not.toContain('generateCsrfToken({');
    }
    expect(authRouteSources.join('\n')).toContain('generateRefreshTokenWithCsrf');
  });

  it('generates user refresh CSRF tokens only for web responses', () => {
    const refreshRouteStart = userRoutesSource.indexOf("router.post('/refresh'");
    const refreshRouteEnd = userRoutesSource.indexOf('// POST /api/auth/logout');
    const refreshRouteSource = userRoutesSource.slice(refreshRouteStart, refreshRouteEnd);

    const webRefreshTokenIndex = refreshRouteSource.indexOf('generateRefreshTokenWithCsrf');
    const nonWebBranchIndex = refreshRouteSource.indexOf('} else {', webRefreshTokenIndex);
    const nonWebRefreshTokenIndex = refreshRouteSource.indexOf(
      'tokenManager.generateRefreshToken(',
      nonWebBranchIndex
    );

    expect(webRefreshTokenIndex).toBeGreaterThan(-1);
    expect(nonWebBranchIndex).toBeGreaterThan(webRefreshTokenIndex);
    expect(nonWebRefreshTokenIndex).toBeGreaterThan(nonWebBranchIndex);
    expect(refreshRouteSource.indexOf('generateRefreshTokenWithCsrf', nonWebBranchIndex)).toBe(-1);
  });
});
