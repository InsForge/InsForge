import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { AppError } from '../../src/utils/errors.js';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  adminLogin: vi.fn(),
  generateRefreshToken: vi.fn().mockReturnValue('refresh-token'),
  generateRefreshTokenWithCsrf: vi.fn().mockReturnValue({
    refreshToken: 'refresh-token',
    csrfToken: 'csrf-token',
  }),
}));

vi.mock('@/api/middlewares/auth.js', () => ({
  verifyUser: vi.fn((_req, _res, next) => next()),
  verifyOptionalUser: vi.fn((_req, _res, next) => next()),
  verifyAdmin: vi.fn((_req, _res, next) => next()),
  verifyToken: vi.fn((_req, _res, next) => next()),
}));

vi.mock('@/services/auth/auth.service.js', () => ({
  AuthService: {
    getInstance: () => ({ login: mocks.login, adminLogin: mocks.adminLogin }),
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

const MAX_ATTEMPTS = 10;

const userSession = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'user@example.com',
    emailVerified: true,
    providers: ['email'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    profile: { name: 'User', avatar_url: '' },
    metadata: null,
  },
  accessToken: 'access-token',
};

const adminSession = {
  admin: { sub: 'admin-id', email: 'admin@example.com', role: 'project_admin' },
  accessToken: 'admin-access-token',
};

describe('password sign-in rate limiting', () => {
  let app: Express;

  beforeAll(async () => {
    const authRouter = (await import('../../src/api/routes/auth/index.routes.js')).default;
    app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use('/api/auth', authRouter);
    app.use(
      (
        error: AppError,
        _req: express.Request,
        res: express.Response,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _next: express.NextFunction
      ) => {
        res.status(error.statusCode).json({ error: error.code, message: error.message });
      }
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateRefreshToken.mockReturnValue('refresh-token');
    mocks.generateRefreshTokenWithCsrf.mockReturnValue({
      refreshToken: 'refresh-token',
      csrfToken: 'csrf-token',
    });
    mocks.login.mockResolvedValue(userSession);
    mocks.adminLogin.mockReturnValue(adminSession);
  });

  describe('POST /api/auth/sessions', () => {
    const credentials = { method: 'password', email: 'user@example.com', password: 'secret123' };

    it('returns 429 after too many failed password attempts', async () => {
      mocks.login.mockRejectedValue(new AppError('Invalid credentials', 401, 'AUTH_UNAUTHORIZED'));
      const ip = '10.0.0.1';

      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const response = await request(app)
          .post('/api/auth/sessions')
          .set('X-Forwarded-For', ip)
          .send(credentials);
        expect(response.status).toBe(401);
      }

      const blocked = await request(app)
        .post('/api/auth/sessions')
        .set('X-Forwarded-For', ip)
        .send(credentials);

      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toBe('TOO_MANY_REQUESTS');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(mocks.login).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    });

    it('still signs in below the limit', async () => {
      const response = await request(app)
        .post('/api/auth/sessions')
        .set('X-Forwarded-For', '10.0.0.2')
        .send(credentials);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ accessToken: 'access-token' });
    });

    it('does not count successful sign-ins against the limit', async () => {
      const ip = '10.0.0.3';

      for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
        const response = await request(app)
          .post('/api/auth/sessions')
          .set('X-Forwarded-For', ip)
          .send(credentials);
        expect(response.status).toBe(200);
      }
    });

    it('tracks each client IP separately', async () => {
      mocks.login.mockRejectedValue(new AppError('Invalid credentials', 401, 'AUTH_UNAUTHORIZED'));

      for (let i = 0; i < MAX_ATTEMPTS + 1; i++) {
        await request(app)
          .post('/api/auth/sessions')
          .set('X-Forwarded-For', '10.0.0.4')
          .send(credentials);
      }

      const otherIp = await request(app)
        .post('/api/auth/sessions')
        .set('X-Forwarded-For', '10.0.0.5')
        .send(credentials);

      expect(otherIp.status).toBe(401);
    });
  });

  describe('POST /api/auth/admin/sessions', () => {
    const credentials = { username: 'admin@example.com', password: 'secret123' };

    it('returns 429 after too many failed admin sign-in attempts', async () => {
      mocks.adminLogin.mockImplementation(() => {
        throw new AppError('Invalid admin credentials', 401, 'AUTH_UNAUTHORIZED');
      });
      const ip = '10.0.1.1';

      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const response = await request(app)
          .post('/api/auth/admin/sessions')
          .set('X-Forwarded-For', ip)
          .send(credentials);
        expect(response.status).toBe(401);
      }

      const blocked = await request(app)
        .post('/api/auth/admin/sessions')
        .set('X-Forwarded-For', ip)
        .send(credentials);

      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toBe('TOO_MANY_REQUESTS');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(mocks.adminLogin).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    });

    it('still signs in below the limit', async () => {
      const response = await request(app)
        .post('/api/auth/admin/sessions')
        .set('X-Forwarded-For', '10.0.1.2')
        .send(credentials);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ accessToken: 'admin-access-token' });
    });

    it('does not count successful sign-ins against the limit', async () => {
      const ip = '10.0.1.3';

      for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
        const response = await request(app)
          .post('/api/auth/admin/sessions')
          .set('X-Forwarded-For', ip)
          .send(credentials);
        expect(response.status).toBe(200);
      }
    });

    it('keeps a separate budget from user sign-in on the same IP', async () => {
      const ip = '10.0.1.4';
      mocks.login.mockRejectedValue(new AppError('Invalid credentials', 401, 'AUTH_UNAUTHORIZED'));

      for (let i = 0; i < MAX_ATTEMPTS + 1; i++) {
        await request(app)
          .post('/api/auth/sessions')
          .set('X-Forwarded-For', ip)
          .send({ method: 'password', email: 'user@example.com', password: 'secret123' });
      }

      const response = await request(app)
        .post('/api/auth/admin/sessions')
        .set('X-Forwarded-For', ip)
        .send(credentials);

      expect(response.status).toBe(200);
    });
  });

  describe('INSFORGE_DISABLE_WRITE_RATE_LIMIT bypass', () => {
    const ORIGINAL = process.env.INSFORGE_DISABLE_WRITE_RATE_LIMIT;

    afterEach(() => {
      if (ORIGINAL === undefined) {
        delete process.env.INSFORGE_DISABLE_WRITE_RATE_LIMIT;
      } else {
        process.env.INSFORGE_DISABLE_WRITE_RATE_LIMIT = ORIGINAL;
      }
    });

    it('skips both limiters when set to "1"', async () => {
      process.env.INSFORGE_DISABLE_WRITE_RATE_LIMIT = '1';
      mocks.login.mockRejectedValue(new AppError('Invalid credentials', 401, 'AUTH_UNAUTHORIZED'));
      mocks.adminLogin.mockImplementation(() => {
        throw new AppError('Invalid admin credentials', 401, 'AUTH_UNAUTHORIZED');
      });

      for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
        await request(app)
          .post('/api/auth/sessions')
          .set('X-Forwarded-For', '10.0.2.1')
          .send({ method: 'password', email: 'user@example.com', password: 'secret123' })
          .expect(401);
        await request(app)
          .post('/api/auth/admin/sessions')
          .set('X-Forwarded-For', '10.0.2.1')
          .send({ username: 'admin@example.com', password: 'secret123' })
          .expect(401);
      }
    });
  });
});
