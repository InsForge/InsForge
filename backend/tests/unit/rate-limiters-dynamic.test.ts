import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const { getConfigMock, rateLimitMock } = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  rateLimitMock: vi.fn(),
}));

vi.mock('express-rate-limit', () => ({
  default: vi.fn((options: unknown) => {
    rateLimitMock(options);
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }),
}));

vi.mock('@/services/auth/rate-limit-config.service.js', () => ({
  DEFAULT_RATE_LIMIT_CONFIG: {
    apiGlobalMaxRequests: 3000,
    apiGlobalWindowMinutes: 15,
    sendEmailOtpMaxRequests: 5,
    sendEmailOtpWindowMinutes: 15,
    verifyOtpMaxAttempts: 10,
    verifyOtpWindowMinutes: 15,
    emailCooldownSeconds: 60,
  },
  RateLimitConfigService: {
    getInstance: () => ({
      getConfig: getConfigMock,
    }),
  },
}));

vi.mock('@/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  globalApiRateLimiter,
  invalidateRateLimitConfigCache,
} from '../../src/api/middlewares/rate-limiters';

function runMiddleware(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = { path: '/users', body: {} } as Request;
    const res = {} as Response;
    globalApiRateLimiter(req, res, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe('Dynamic rate-limit middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateRateLimitConfigCache();
  });

  it('builds global limiter from persisted config values', async () => {
    getConfigMock.mockResolvedValueOnce({
      id: '11111111-1111-1111-1111-111111111111',
      apiGlobalMaxRequests: 4200,
      apiGlobalWindowMinutes: 20,
      sendEmailOtpMaxRequests: 5,
      sendEmailOtpWindowMinutes: 15,
      verifyOtpMaxAttempts: 10,
      verifyOtpWindowMinutes: 15,
      emailCooldownSeconds: 60,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await runMiddleware();

    expect(rateLimitMock).toHaveBeenCalled();
    expect(rateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        max: 4200,
        windowMs: 20 * 60 * 1000,
      })
    );
  });

  it('falls back to safe defaults when config lookup fails', async () => {
    getConfigMock.mockRejectedValueOnce(new Error('db down'));

    await runMiddleware();

    expect(rateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        max: 3000,
        windowMs: 15 * 60 * 1000,
      })
    );
  });
});
