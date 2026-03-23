import express, { type Express } from 'express';
import { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/api/middlewares/error.js';
import { ERROR_CODES } from '../../src/types/error-constants.js';

const {
  authServiceMock,
  deviceAuthorizationServiceMock,
  tokenManagerMock,
} = vi.hoisted(() => {
  const authServiceMock = {
    exchangeApprovedDeviceAuthorization: vi.fn(),
  };

  const deviceAuthorizationServiceMock = {
    create: vi.fn(),
    findByUserCode: vi.fn(),
    approve: vi.fn(),
    deny: vi.fn(),
  };

  const tokenManagerMock = {
    generateRefreshToken: vi.fn((userId: string) => `refresh-${userId}`),
  };

  return {
    authServiceMock,
    deviceAuthorizationServiceMock,
    tokenManagerMock,
  };
});

vi.mock('../../src/services/auth/auth.service.js', () => ({
  AuthService: {
    getInstance: () => authServiceMock,
  },
}));

vi.mock('../../src/services/auth/device-authorization.service.js', () => ({
  DeviceAuthorizationService: {
    getInstance: () => deviceAuthorizationServiceMock,
  },
}));

vi.mock('../../src/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => tokenManagerMock,
  },
}));

vi.mock('../../src/api/middlewares/auth.js', () => ({
  verifyToken: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    const authorization = (req as { headers?: { authorization?: string } }).headers?.authorization;
    if (!authorization) {
      next(new AppError('No token provided', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS));
      return;
    }

    req.user = {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'user@example.com',
      role: 'authenticated',
    };
    next();
  },
  verifyAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  extractBearerToken: () => null,
}));

vi.mock('../../src/api/middlewares/rate-limiters.js', () => {
  const noop = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    sendEmailOTPLimiter: [noop],
    verifyOTPLimiter: [noop],
    deviceAuthorizationCreationLimiter: [noop],
    deviceAuthorizationUserCodeLimiter: [noop],
    deviceAuthorizationPollingLimiter: [noop],
  };
});

vi.mock('../../src/api/routes/auth/oauth.routes.js', () => {
  const router = express.Router();
  return { default: router };
});

vi.mock('../../src/api/routes/auth/custom-oauth.routes.js', () => {
  const router = express.Router();
  return { default: router };
});

vi.mock('../../src/services/auth/auth-config.service.js', () => ({
  AuthConfigService: {
    getInstance: () => ({
      getAuthConfig: vi.fn(),
      getPublicAuthConfig: vi.fn(),
      updateAuthConfig: vi.fn(),
    }),
  },
}));

vi.mock('../../src/services/logs/audit.service.js', () => ({
  AuditService: {
    getInstance: () => ({
      log: vi.fn(),
    }),
  },
}));

vi.mock('../../src/infra/socket/socket.manager.js', () => ({
  SocketManager: {
    getInstance: () => ({
      broadcastToRoom: vi.fn(),
    }),
  },
}));

type ServerHandle = {
  app: Express;
  close: () => Promise<void>;
  baseUrl: string;
};

async function createServer(): Promise<ServerHandle> {
  const { default: authRouter } = await import('../../src/api/routes/auth/index.routes.js');
  const { errorMiddleware } = await import('../../src/api/middlewares/error.js');

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use(errorMiddleware);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

async function postJsonWithHeaders(
  url: string,
  body: unknown,
  headers: HeadersInit = {}
) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get('content-type') || '';
  const responseBody = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  return {
    status: response.status,
    body: responseBody,
  };
}

async function postJson(url: string, body: unknown, headers: HeadersInit = {}) {
  return postJsonWithHeaders(url, body, headers);
}

describe('device auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deviceAuthorizationServiceMock.create.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      status: 'pending_authorization',
      deviceCode: 'device-code-123',
      userCode: 'ABCD-EFGH',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      pollIntervalSeconds: 5,
      approvedByUserId: null,
      consumedAt: null,
      clientContext: {
        deviceName: 'my-vps',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    deviceAuthorizationServiceMock.approve.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      status: 'approved',
      deviceCode: 'device-code-123',
      userCode: 'ABCD-EFGH',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      pollIntervalSeconds: 5,
      approvedByUserId: '11111111-1111-1111-1111-111111111111',
      consumedAt: null,
      clientContext: {
        deviceName: 'my-vps',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    deviceAuthorizationServiceMock.deny.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      status: 'denied',
      deviceCode: 'device-code-123',
      userCode: 'ABCD-EFGH',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      pollIntervalSeconds: 5,
      approvedByUserId: null,
      consumedAt: null,
      clientContext: {
        deviceName: 'my-vps',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    deviceAuthorizationServiceMock.findByUserCode.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      status: 'pending_authorization',
      deviceCode: 'device-code-123',
      userCode: 'ABCD-EFGH',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      pollIntervalSeconds: 5,
      approvedByUserId: null,
      consumedAt: null,
      clientContext: {
        deviceName: 'my-vps',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    authServiceMock.exchangeApprovedDeviceAuthorization.mockResolvedValue({
      user: {
        id: '11111111-1111-1111-1111-111111111111',
        email: 'user@example.com',
        emailVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        profile: null,
        metadata: null,
      },
      accessToken: 'access-token-123',
    });
  });

  afterEach(async () => {
    vi.resetModules();
  });

  it('mounts the device authorization router under /api/auth/device', async () => {
    const server = await createServer();

    try {
      const result = await postJson(`${server.baseUrl}/api/auth/device/authorizations`, {
        deviceName: 'my-vps',
        hostname: 'vps-01',
        platform: 'linux-x64',
      });

      expect(result.status).toBe(200);
      expect(result.body.userCode).toBe('ABCD-EFGH');
      expect(result.body.verificationUri).toBe('http://localhost:7130/auth/device');
    } finally {
      await server.close();
    }
  });

  it('looks up device authorization metadata by user code', async () => {
    const server = await createServer();

    try {
      const result = await postJson(`${server.baseUrl}/api/auth/device/authorizations/lookup`, {
        userCode: 'ABCD-EFGH',
      });

      expect(result.status).toBe(200);
      expect(deviceAuthorizationServiceMock.findByUserCode).toHaveBeenCalledWith('ABCD-EFGH');
      expect(result.body).toEqual({
        status: 'pending_authorization',
        expiresAt: expect.any(String),
        clientContext: {
          deviceName: 'my-vps',
        },
      });
    } finally {
      await server.close();
    }
  });

  it('returns authorization_pending for the polling endpoint', async () => {
    authServiceMock.exchangeApprovedDeviceAuthorization.mockRejectedValue(
      new AppError(
        'Device authorization pending',
        428,
        ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_PENDING
      )
    );

    const server = await createServer();

    try {
      const result = await postJson(`${server.baseUrl}/api/auth/device/token`, {
        deviceCode: 'device-code-123',
        grantType: 'urn:insforge:params:oauth:grant-type:device_code',
      });

      expect(result.status).toBe(428);
      expect(result.body).toMatchObject({
        error: 'authorization_pending',
        statusCode: 428,
      });
    } finally {
      await server.close();
    }
  });

  it('returns the standard session payload after device authorization exchange', async () => {
    const server = await createServer();

    try {
      const result = await postJson(`${server.baseUrl}/api/auth/device/token`, {
        deviceCode: 'device-code-123',
        grantType: 'urn:insforge:params:oauth:grant-type:device_code',
      });

      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        accessToken: 'access-token-123',
        refreshToken: 'refresh-11111111-1111-1111-1111-111111111111',
      });
      expect(result.body.user.email).toBe('user@example.com');
    } finally {
      await server.close();
    }
  });

  it.each([
    ['access_denied', 403, ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_DENIED],
    ['expired_token', 400, ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_EXPIRED],
    ['already_used', 400, ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_CONSUMED],
  ])(
    'maps %s to the protocol error shape',
    async (error, statusCode, code) => {
      authServiceMock.exchangeApprovedDeviceAuthorization.mockRejectedValue(
        new AppError(`Device authorization ${error}`, statusCode, code)
      );

      const server = await createServer();

      try {
        const result = await postJson(`${server.baseUrl}/api/auth/device/token`, {
          deviceCode: 'device-code-123',
          grantType: 'urn:insforge:params:oauth:grant-type:device_code',
        });

        expect(result.status).toBe(statusCode);
        expect(result.body).toMatchObject({
          error,
          statusCode,
        });
      } finally {
        await server.close();
      }
    }
  );

  it('approves a device authorization with the authenticated user', async () => {
    const server = await createServer();

    try {
      const result = await postJson(
        `${server.baseUrl}/api/auth/device/authorizations/approve`,
        {
          userCode: 'ABCD-EFGH',
        },
        {
          Authorization: 'Bearer test-token',
        }
      );

      expect(result.status).toBe(200);
      expect(deviceAuthorizationServiceMock.approve).toHaveBeenCalledWith(
        'ABCD-EFGH',
        '11111111-1111-1111-1111-111111111111'
      );
      expect(result.body.status).toBe('approved');
    } finally {
      await server.close();
    }
  });

  it('denies a device authorization with the authenticated user', async () => {
    const server = await createServer();

    try {
      const result = await postJson(
        `${server.baseUrl}/api/auth/device/authorizations/deny`,
        {
          userCode: 'ABCD-EFGH',
        },
        {
          Authorization: 'Bearer test-token',
        }
      );

      expect(result.status).toBe(200);
      expect(deviceAuthorizationServiceMock.deny).toHaveBeenCalledWith(
        'ABCD-EFGH',
        '11111111-1111-1111-1111-111111111111'
      );
      expect(result.body.status).toBe('denied');
    } finally {
      await server.close();
    }
  });

  it('returns 401 when approve is called without authorization', async () => {
    const server = await createServer();

    try {
      const result = await postJson(`${server.baseUrl}/api/auth/device/authorizations/approve`, {
        userCode: 'ABCD-EFGH',
      });

      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({
        error: ERROR_CODES.AUTH_UNAUTHORIZED,
        statusCode: 401,
      });
    } finally {
      await server.close();
    }
  });
});
