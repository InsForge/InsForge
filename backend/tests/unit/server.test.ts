import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';

const { mockAuthConfig } = vi.hoisted(() => ({
  mockAuthConfig: {
    allowedRedirectUrls: ['https://dashboard.example.com', 'https://app.example.com/callback'],
  },
}));

vi.mock('../../src/services/auth/auth-config.service.js', () => ({
  AuthConfigService: {
    getInstance: () => ({
      getAuthConfig: vi.fn().mockResolvedValue(mockAuthConfig),
    }),
  },
}));

import { AuthConfigService } from '../../src/services/auth/auth-config.service.js';

describe('Server Security Hardening & Edge Controls', () => {
  let app: express.Express;

  beforeEach(() => {
    process.env.API_BASE_URL = 'https://api.example.com';
    app = express();
    app.use(helmet());
    app.use(
      cors({
        origin: (origin, callback) => {
          if (!origin) {
            return callback(null, true);
          }

          const apiBaseUrl = process.env.API_BASE_URL;
          if (apiBaseUrl) {
            try {
              const apiOrigin = new URL(apiBaseUrl).origin;
              if (origin === apiOrigin || origin === apiBaseUrl) {
                return callback(null, true);
              }
            } catch {
              if (origin === apiBaseUrl) {
                return callback(null, true);
              }
            }
          }

          AuthConfigService.getInstance()
            .getAuthConfig()
            .then((authConfig) => {
              const allowedUrls = authConfig.allowedRedirectUrls || [];
              const isAllowed = allowedUrls.some((url) => {
                try {
                  const allowedOrigin = new URL(url).origin;
                  return origin === allowedOrigin || origin === url;
                } catch {
                  return origin === url;
                }
              });

              if (isAllowed) {
                return callback(null, true);
              }
              return callback(null, false);
            })
            .catch(() => {
              return callback(null, false);
            });
        },
        credentials: true,
        exposedHeaders: ['Content-Range', 'Preference-Applied'],
      })
    );

    app.get('/api/test', (_req: Request, res: Response) => {
      res.json({ status: 'ok' });
    });
  });

  describe('Helmet Security Headers', () => {
    it('includes standard Helmet security headers on HTTP responses', async () => {
      const response = await request(app).get('/api/test');
      expect(response.headers['x-dns-prefetch-control']).toBe('off');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('CORS Origin Allowlist', () => {
    it('allows requests matching process.env.API_BASE_URL', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('Origin', 'https://api.example.com');
      expect(response.headers['access-control-allow-origin']).toBe('https://api.example.com');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('allows requests matching allowedRedirectUrls from AuthConfigService', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('Origin', 'https://dashboard.example.com');
      expect(response.headers['access-control-allow-origin']).toBe('https://dashboard.example.com');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('rejects cross-origin requests from unapproved domains', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('Origin', 'https://malicious-attacker.com');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
