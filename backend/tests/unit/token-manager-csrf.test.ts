import jwt from 'jsonwebtoken';
import { describe, expect, it, vi, afterEach } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';
});

import { AppError } from '../../src/utils/errors';
import { TokenManager } from '../../src/infra/security/token.manager';

describe('TokenManager refresh CSRF tokens', () => {
  const userId = 'user-csrf-1';
  const tokenManager = TokenManager.getInstance();

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the CSRF token stable when a refresh token is reissued with the same nonce', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'));

    const initialRefreshToken = tokenManager.generateRefreshToken(userId, 'user');
    const initialPayload = tokenManager.verifyRefreshToken(initialRefreshToken);
    const initialCsrfToken = tokenManager.generateCsrfToken(initialPayload);

    vi.setSystemTime(new Date('2026-05-19T12:02:00.000Z'));

    const rotatedRefreshToken = tokenManager.generateRefreshToken(
      initialPayload.sub,
      initialPayload.sessionType,
      initialPayload.csrfNonce
    );
    const rotatedPayload = tokenManager.verifyRefreshToken(rotatedRefreshToken);
    const rotatedCsrfToken = tokenManager.generateCsrfToken(rotatedPayload);

    expect(rotatedRefreshToken).not.toBe(initialRefreshToken);
    expect(rotatedPayload.csrfNonce).toBe(initialPayload.csrfNonce);
    expect(rotatedPayload.sessionType).toBe('user');
    expect(rotatedCsrfToken).toBe(initialCsrfToken);
    expect(tokenManager.verifyCsrfToken(initialCsrfToken, rotatedPayload)).toBe(true);
  });

  it('rejects CSRF tokens from another refresh-token family', () => {
    const firstRefreshToken = tokenManager.generateRefreshToken(userId, 'user');
    const secondRefreshToken = tokenManager.generateRefreshToken(userId, 'user');
    const firstCsrfToken = tokenManager.generateCsrfToken(
      tokenManager.verifyRefreshToken(firstRefreshToken)
    );
    const secondPayload = tokenManager.verifyRefreshToken(secondRefreshToken);

    expect(tokenManager.verifyCsrfToken(firstCsrfToken, secondPayload)).toBe(false);
  });

  it('separates user and admin refresh token session types', () => {
    const userRefreshToken = tokenManager.generateRefreshToken(userId, 'user');
    const adminRefreshToken = tokenManager.generateRefreshToken(userId, 'admin');

    expect(tokenManager.verifyRefreshToken(userRefreshToken).sessionType).toBe('user');
    expect(tokenManager.verifyRefreshToken(adminRefreshToken).sessionType).toBe('admin');
  });

  it('generates a matching refresh token and CSRF token together', () => {
    const { refreshToken, csrfToken } = tokenManager.generateRefreshTokenWithCsrf(userId, 'user');
    const payload = tokenManager.verifyRefreshToken(refreshToken);

    expect(payload.sub).toBe(userId);
    expect(payload.sessionType).toBe('user');
    expect(tokenManager.verifyCsrfToken(csrfToken, payload)).toBe(true);
  });

  it('includes refresh session type in CSRF derivation', () => {
    const csrfNonce = 'shared-test-nonce';
    const userRefreshToken = tokenManager.generateRefreshToken(userId, 'user', csrfNonce);
    const adminRefreshToken = tokenManager.generateRefreshToken(userId, 'admin', csrfNonce);

    expect(
      tokenManager.generateCsrfToken(tokenManager.verifyRefreshToken(userRefreshToken))
    ).not.toBe(tokenManager.generateCsrfToken(tokenManager.verifyRefreshToken(adminRefreshToken)));
  });

  it('rejects legacy refresh tokens that do not carry csrf/session claims', () => {
    const legacyRefreshToken = jwt.sign(
      {
        sub: userId,
        type: 'refresh',
        iss: 'insforge',
      },
      process.env.JWT_SECRET ?? '',
      {
        algorithm: 'HS256',
        expiresIn: '7d',
      }
    );

    expect(() => tokenManager.verifyRefreshToken(legacyRefreshToken)).toThrow(AppError);
  });

  it('rejects refresh tokens that do not carry a session type', () => {
    const legacyRefreshToken = jwt.sign(
      {
        sub: userId,
        type: 'refresh',
        iss: 'insforge',
        csrfNonce: 'nonce',
      },
      process.env.JWT_SECRET ?? '',
      {
        algorithm: 'HS256',
        expiresIn: '7d',
      }
    );

    expect(() => tokenManager.verifyRefreshToken(legacyRefreshToken)).toThrow(AppError);
  });

  it('generates PostgREST anon tokens without a fake anonymous subject', () => {
    const anonToken = tokenManager.generatePostgrestAnonToken();
    const payload = jwt.verify(anonToken, process.env.JWT_SECRET ?? '') as Record<string, unknown>;

    expect(payload.role).toBe('anon');
    expect(payload.sub).toBeUndefined();
    expect(payload.email).toBeUndefined();
  });

  it('generates PostgREST admin tokens without a fake admin subject', () => {
    const postgrestToken = tokenManager.generatePostgrestAdminToken();
    const payload = jwt.verify(postgrestToken, process.env.JWT_SECRET ?? '') as Record<
      string,
      unknown
    >;

    expect(payload.role).toBe('project_admin');
    expect(payload.sub).toBeUndefined();
    expect(payload.email).toBeUndefined();
  });
});
