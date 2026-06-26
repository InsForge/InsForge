import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { NextFunction, Response } from 'express';
import type { AuthRequest } from '../../src/api/middlewares/auth';

const TEST_JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';

const { mockVerifyApiKey, mockVerifyAnonKey } = vi.hoisted(() => ({
  mockVerifyApiKey: vi.fn<(apiKey: string) => Promise<boolean>>(),
  mockVerifyAnonKey: vi.fn<(anonKey: string) => Promise<boolean>>(),
}));

vi.mock('@/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({
      verifyApiKey: mockVerifyApiKey,
      verifyAnonKey: mockVerifyAnonKey,
    }),
  },
}));

async function loadAuthMiddleware() {
  vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
  return import('../../src/api/middlewares/auth');
}

describe('verifyUser credential dispatch', () => {
  beforeEach(() => {
    vi.resetModules();
    mockVerifyApiKey.mockReset();
    mockVerifyAnonKey.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('authenticates a valid anon key from the Authorization header', async () => {
    mockVerifyAnonKey.mockResolvedValue(true);
    const { verifyUser } = await loadAuthMiddleware();
    const req = {
      headers: {
        authorization: 'Bearer anon_valid',
      },
    } as AuthRequest;
    const next = vi.fn() as NextFunction;

    await verifyUser(req, {} as Response, next);

    expect(mockVerifyAnonKey).toHaveBeenCalledWith('anon_valid');
    // API-level sentinel subject; stripped before the database
    expect(req.user).toEqual({
      id: 'anonymous',
      email: undefined,
      role: 'anon',
    });
    expect(next).toHaveBeenCalledWith();
  });

  it('ignores anon keys outside the Authorization header', async () => {
    mockVerifyAnonKey.mockResolvedValue(true);
    const { verifyUser } = await loadAuthMiddleware();
    // The anon key is Bearer-only; an x-anon-key header is not a credential
    const req = {
      headers: {
        'x-anon-key': 'anon_valid',
      },
    } as unknown as AuthRequest;
    const next = vi.fn() as NextFunction;

    await verifyUser(req, {} as Response, next);

    expect(mockVerifyAnonKey).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('rejects an invalid anon key with 401 instead of falling through', async () => {
    mockVerifyAnonKey.mockResolvedValue(false);
    const { verifyUser } = await loadAuthMiddleware();
    const req = {
      headers: {
        authorization: 'Bearer anon_invalid',
      },
    } as AuthRequest;
    const next = vi.fn() as NextFunction;

    await verifyUser(req, {} as Response, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('rejects an expired user JWT with 401 and never downgrades to anon', async () => {
    const { verifyUser } = await loadAuthMiddleware();
    const expiredToken = jwt.sign(
      { sub: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', role: 'authenticated' },
      TEST_JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '-1h' }
    );
    const req = {
      headers: {
        authorization: `Bearer ${expiredToken}`,
      },
    } as AuthRequest;
    const next = vi.fn() as NextFunction;

    await verifyUser(req, {} as Response, next);

    expect(mockVerifyAnonKey).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('still accepts a legacy anon JWT through the JWT path', async () => {
    const { verifyUser } = await loadAuthMiddleware();
    const legacyAnonJwt = jwt.sign(
      {
        sub: '12345678-1234-5678-90ab-cdef12345678',
        email: 'anon@insforge.com',
        role: 'anon',
      },
      TEST_JWT_SECRET,
      { algorithm: 'HS256' }
    );
    const req = {
      headers: {
        authorization: `Bearer ${legacyAnonJwt}`,
      },
    } as AuthRequest;
    const next = vi.fn() as NextFunction;

    await verifyUser(req, {} as Response, next);

    expect(mockVerifyAnonKey).not.toHaveBeenCalled();
    expect(req.user?.role).toBe('anon');
    expect(next).toHaveBeenCalledWith();
  });

  it('dispatches ik_ bearer tokens to API key verification, not anon', async () => {
    mockVerifyApiKey.mockResolvedValue(true);
    const { verifyUser } = await loadAuthMiddleware();
    const req = {
      headers: {
        authorization: 'Bearer ik_valid',
      },
    } as AuthRequest;
    const next = vi.fn() as NextFunction;

    await verifyUser(req, {} as Response, next);

    expect(mockVerifyApiKey).toHaveBeenCalledWith('ik_valid');
    expect(mockVerifyAnonKey).not.toHaveBeenCalled();
    expect(req.hasApiKey).toBe(true);
    expect(next).toHaveBeenCalledWith();
  });

  it('authenticates a user JWT in the Bearer slot where the anon key used to travel', async () => {
    mockVerifyAnonKey.mockResolvedValue(true);
    const { verifyUser } = await loadAuthMiddleware();
    const userToken = jwt.sign(
      { sub: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', role: 'authenticated' },
      TEST_JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );
    const req = {
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    } as AuthRequest;
    const next = vi.fn() as NextFunction;

    await verifyUser(req, {} as Response, next);

    expect(mockVerifyAnonKey).not.toHaveBeenCalled();
    expect(req.user).toEqual({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      email: undefined,
      role: 'authenticated',
    });
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects requests with no credentials at all', async () => {
    const { verifyUser } = await loadAuthMiddleware();
    const req = { headers: {} } as AuthRequest;
    const next = vi.fn() as NextFunction;

    await verifyUser(req, {} as Response, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});
