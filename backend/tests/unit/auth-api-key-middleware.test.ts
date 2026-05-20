import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Response } from 'express';
import type { AuthRequest } from '../../src/api/middlewares/auth';

const { mockVerifyApiKey } = vi.hoisted(() => ({
  mockVerifyApiKey: vi.fn<(apiKey: string) => Promise<boolean>>(),
}));

vi.mock('@/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({
      verifyApiKey: mockVerifyApiKey,
    }),
  },
}));

async function loadAuthMiddleware() {
  vi.stubEnv('JWT_SECRET', 'test-secret-long-enough-for-signing-32chars');
  return import('../../src/api/middlewares/auth');
}

describe('verifyApiKey', () => {
  beforeEach(() => {
    vi.resetModules();
    mockVerifyApiKey.mockReset();
  });

  it('sets hasApiKey only after the API key is verified', async () => {
    mockVerifyApiKey.mockResolvedValue(true);
    const { verifyApiKey } = await loadAuthMiddleware();
    const req = {
      headers: {
        authorization: 'Bearer ik_valid',
      },
    } as AuthRequest;
    const next = vi.fn() as NextFunction;

    await verifyApiKey(req, {} as Response, next);

    expect(mockVerifyApiKey).toHaveBeenCalledWith('ik_valid');
    expect(req.authenticated).toBe(true);
    expect(req.hasApiKey).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(req, 'apiKey')).toBe(false);
    expect(next).toHaveBeenCalledWith();
  });

  it('does not set hasApiKey when API key verification fails', async () => {
    mockVerifyApiKey.mockResolvedValue(false);
    const { verifyApiKey } = await loadAuthMiddleware();
    const req = {
      headers: {
        'x-api-key': 'ik_invalid',
      },
    } as unknown as AuthRequest;
    const next = vi.fn() as NextFunction;

    await verifyApiKey(req, {} as Response, next);

    expect(mockVerifyApiKey).toHaveBeenCalledWith('ik_invalid');
    expect(req.authenticated).toBeUndefined();
    expect(req.hasApiKey).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});
