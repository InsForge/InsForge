import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { AppError } from '../../src/utils/errors.js';

const { mockTokenManager, mockSecretService } = vi.hoisted(() => ({
  mockTokenManager: {
    verifyToken: vi.fn(),
    verifyCloudProjectAuthorization: vi.fn(),
  },
  mockSecretService: {
    verifyApiKey: vi.fn(),
  },
}));

vi.mock('../../src/infra/security/token.manager.js', () => ({
  TokenManager: { getInstance: () => mockTokenManager },
}));

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: { getInstance: () => mockSecretService },
}));

import { type AuthRequest, verifyAdmin } from '../../src/api/middlewares/auth.js';

function bearerToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, 'dispatch-only-test-secret');
}

function requestWithBearer(token: string): AuthRequest {
  return { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
}

async function authenticate(req: AuthRequest) {
  const next = vi.fn() as unknown as NextFunction;
  await verifyAdmin(req, {} as Response, next);
  return next;
}

describe('verifyAdmin', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('accepts a valid Cloud project authorization with audit-compatible context', async () => {
    const token = bearerToken({ type: 'project_authorization' });
    mockTokenManager.verifyCloudProjectAuthorization.mockResolvedValue({
      projectId: 'project_123',
      userId: 'user_123',
    });
    const req = requestWithBearer(token);

    const next = await authenticate(req);

    expect(mockTokenManager.verifyCloudProjectAuthorization).toHaveBeenCalledWith(token);
    expect(mockTokenManager.verifyToken).not.toHaveBeenCalled();
    expect(req).toMatchObject({
      projectId: 'project_123',
      authenticated: true,
      user: { id: 'cloud:user_123', role: 'project_admin' },
    });
    expect(req.hasApiKey).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });

  it('fails closed without local fallback for a non-Cloud token claiming the Cloud type', async () => {
    const token = bearerToken({
      type: 'project_authorization',
      role: 'project_admin',
      sub: 'local:attacker',
    });
    mockTokenManager.verifyCloudProjectAuthorization.mockRejectedValue(
      new AppError('Invalid Cloud signature', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS)
    );

    const next = await authenticate(requestWithBearer(token));

    expect(mockTokenManager.verifyCloudProjectAuthorization).toHaveBeenCalledWith(token);
    expect(mockTokenManager.verifyToken).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401, code: ERROR_CODES.AUTH_INVALID_CREDENTIALS })
    );
  });

  it('preserves locally issued project-admin JWT authentication', async () => {
    const token = bearerToken({ role: 'project_admin', sub: 'local:admin' });
    mockTokenManager.verifyToken.mockReturnValue({
      sub: 'local:admin',
      role: 'project_admin',
    });
    const req = requestWithBearer(token);

    const next = await authenticate(req);

    expect(mockTokenManager.verifyToken).toHaveBeenCalledWith(token);
    expect(mockTokenManager.verifyCloudProjectAuthorization).not.toHaveBeenCalled();
    expect(req.user).toEqual({ id: 'local:admin', email: undefined, role: 'project_admin' });
    expect(next).toHaveBeenCalledWith();
  });

  it('preserves rejection of locally issued non-admin JWTs', async () => {
    const token = bearerToken({ role: 'authenticated', sub: 'user_123' });
    mockTokenManager.verifyToken.mockReturnValue({
      sub: 'user_123',
      role: 'authenticated',
    });

    const next = await authenticate(requestWithBearer(token));

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, code: ERROR_CODES.AUTH_UNAUTHORIZED })
    );
  });

  it('preserves ik_ API-key authentication', async () => {
    mockSecretService.verifyApiKey.mockResolvedValue(true);
    const req = requestWithBearer('ik_project_admin_key');

    const next = await authenticate(req);

    expect(mockSecretService.verifyApiKey).toHaveBeenCalledWith('ik_project_admin_key');
    expect(mockTokenManager.verifyToken).not.toHaveBeenCalled();
    expect(mockTokenManager.verifyCloudProjectAuthorization).not.toHaveBeenCalled();
    expect(req.authenticated).toBe(true);
    expect(req.hasApiKey).toBe(true);
    expect(next).toHaveBeenCalledWith();
  });
});
