import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { NextFunction, Response } from 'express';
import type { AuthRequest } from '../../src/api/middlewares/auth.js';

const TEST_JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';

vi.mock('@/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({}),
  },
}));

async function loadAuthMiddleware() {
  vi.stubEnv('JWT_SECRET', TEST_JWT_SECRET);
  return import('../../src/api/middlewares/auth.js');
}

describe('verifyProjectAdminJwt', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a project admin JWT', async () => {
    const { verifyProjectAdminJwt } = await loadAuthMiddleware();
    const token = jwt.sign({ sub: 'admin', role: 'project_admin' }, TEST_JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const next = vi.fn() as NextFunction;

    verifyProjectAdminJwt(req, {} as Response, next);

    expect(req.authenticated).toBe(true);
    expect(req.user).toEqual({ id: 'admin', email: undefined, role: 'project_admin' });
    expect(next).toHaveBeenCalledWith();
  });

  it.each(['Bearer ik_application_key', 'Bearer anon_public_key'])(
    'rejects non-dashboard credential %s',
    async (authorization) => {
      const { verifyProjectAdminJwt } = await loadAuthMiddleware();
      const req = { headers: { authorization } } as AuthRequest;
      const next = vi.fn() as NextFunction;

      verifyProjectAdminJwt(req, {} as Response, next);

      expect(req.authenticated).toBeUndefined();
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    }
  );

  it('rejects an authenticated user JWT', async () => {
    const { verifyProjectAdminJwt } = await loadAuthMiddleware();
    const token = jwt.sign({ sub: 'user', role: 'authenticated' }, TEST_JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const next = vi.fn() as NextFunction;

    verifyProjectAdminJwt(req, {} as Response, next);

    expect(req.authenticated).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});
