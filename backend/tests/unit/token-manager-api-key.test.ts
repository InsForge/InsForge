import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';
});

import { TokenManager } from '../../src/infra/security/token.manager';

/**
 * Tests for the API-key token contract (Issue #1436).
 *
 * Admin API-key JWTs must NOT carry a non-UUID `sub` claim.
 * PostgREST forwards `request.jwt.claims.sub` verbatim into the Postgres
 * session.  Any non-UUID literal causes auth.uid() to raise 22P02 and
 * aborts every transaction protected by an RLS policy or trigger that
 * calls auth.uid() — the exact scenario that broke Supabase-migrated
 * projects.
 *
 * Correct behaviour: omit `sub` entirely so PostgREST injects NULL,
 * matching the Supabase service-role contract where auth.uid() returns
 * NULL for system actors.
 */
describe('TokenManager – API-key token (Issue #1436)', () => {
  const tokenManager = TokenManager.getInstance();

  it('generateApiKeyToken() produces a JWT with no sub field', () => {
    const token = tokenManager.generateApiKeyToken();
    // Decode without verifying signature so we can inspect the raw payload
    const decoded = jwt.decode(token) as Record<string, unknown>;

    expect(decoded).not.toBeNull();
    // sub must be absent — not an empty string, not a non-uuid literal
    expect(Object.prototype.hasOwnProperty.call(decoded, 'sub')).toBe(false);
  });

  it('generateApiKeyToken() JWT carries expected role and email claims', () => {
    const token = tokenManager.generateApiKeyToken();
    const decoded = jwt.decode(token) as Record<string, unknown>;

    expect(decoded.role).toBe('project_admin');
    expect(decoded.email).toBe('project-admin@email.com');
  });

  it('verifyToken() on an API-key token returns sub: undefined', () => {
    const token = tokenManager.generateApiKeyToken();
    const payload = tokenManager.verifyToken(token);

    // sub should be undefined — never the non-UUID poison string
    expect(payload.sub).toBeUndefined();
    expect(payload.role).toBe('project_admin');
  });

  it('verifyToken() on an API-key token never returns the old non-UUID literal', () => {
    const token = tokenManager.generateApiKeyToken();
    const payload = tokenManager.verifyToken(token);

    expect(payload.sub).not.toBe('project-admin-with-api-key');
  });

  it('a regular user access token still carries a UUID sub', () => {
    const userSub = '550e8400-e29b-41d4-a716-446655440000';
    // Use the real generator — not a manual jwt.sign — so this test catches
    // any future accidental removal of sub from generateAccessToken().
    const userToken = tokenManager.generateAccessToken({
      sub: userSub,
      email: 'user@example.com',
      role: 'authenticated',
    });
    const payload = tokenManager.verifyToken(userToken);

    expect(payload.sub).toBe(userSub);
  });

  it('verifyToken() rejects a refresh token even though it shares JWT_SECRET', () => {
    // Refresh tokens share the same signing secret but carry a different shape:
    // they have no `email` or `role` claim. verifyToken() must reject them so
    // a refresh token cannot be presented as an access token (coderabbit finding).
    const refreshToken = tokenManager.generateRefreshToken(
      '550e8400-e29b-41d4-a716-446655440000',
      'user'
    );

    expect(() => tokenManager.verifyToken(refreshToken)).toThrow();
  });

  it('verifyToken() rejects a token whose sub is a non-UUID string', () => {
    // Extra defence: even if someone mints a JWT with JWT_SECRET and sets a
    // non-UUID sub, tokenPayloadSchema.parse() must reject it.
    const poisonToken = jwt.sign(
      { sub: 'project-admin-with-api-key', email: 'x@example.com', role: 'project_admin' },
      process.env.JWT_SECRET ?? '',
      { algorithm: 'HS256' }
    );

    expect(() => tokenManager.verifyToken(poisonToken)).toThrow();
  });
});
