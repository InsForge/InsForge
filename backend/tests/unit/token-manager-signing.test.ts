import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TokenManager } from '../../src/infra/security/token.manager';

describe('TokenManager asymmetric token migration', () => {
  const originalEnv = process.env;
  let privateKey: string;
  let publicKey: string;

  beforeEach(async () => {
    const generated = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });

    privateKey = generated.privateKey;
    publicKey = generated.publicKey;

    process.env = {
      ...originalEnv,
      JWT_SECRET: 'legacy-secret-for-hs256-tests',
      JWT_SIGNING_PRIVATE_KEY: privateKey,
      JWT_SIGNING_PUBLIC_KEY: publicKey,
      JWT_SIGNING_KID: 'test-key-id',
    };

    (TokenManager as unknown as { instance?: TokenManager }).instance = undefined;
    await TokenManager.getInstance().initialize();
  });

  afterEach(() => {
    process.env = originalEnv;
    (TokenManager as unknown as { instance?: TokenManager }).instance = undefined;
  });

  it('signs new access tokens with RS256 and publishes the matching JWKS', () => {
    const tokenManager = TokenManager.getInstance();
    const token = tokenManager.generateAccessToken({
      sub: 'user-1',
      email: 'user@example.com',
      role: 'authenticated',
    });

    const decoded = jwt.decode(token, { complete: true }) as jwt.Jwt | null;

    expect(decoded?.header.alg).toBe('RS256');
    expect(decoded?.header.kid).toBe('test-key-id');
    expect(tokenManager.getPublicJwks()).toEqual({
      keys: [
        expect.objectContaining({
          alg: 'RS256',
          kid: 'test-key-id',
          use: 'sig',
          kty: 'RSA',
        }),
      ],
    });
  });

  it('verifies both new RS256 tokens and legacy HS256 tokens during migration', () => {
    const tokenManager = TokenManager.getInstance();

    const rsToken = tokenManager.generateAccessToken({
      sub: 'user-1',
      email: 'user@example.com',
      role: 'authenticated',
    });

    expect(tokenManager.verifyToken(rsToken)).toEqual({
      sub: 'user-1',
      email: 'user@example.com',
      role: 'authenticated',
    });

    const hsToken = jwt.sign(
      {
        sub: 'legacy-user',
        email: 'legacy@example.com',
        role: 'project_admin',
      },
      process.env.JWT_SECRET!,
      { algorithm: 'HS256' }
    );

    expect(tokenManager.verifyToken(hsToken)).toEqual({
      sub: 'legacy-user',
      email: 'legacy@example.com',
      role: 'project_admin',
    });
  });

  it('verifies refresh tokens after switching signing algorithms', () => {
    const tokenManager = TokenManager.getInstance();
    const refreshToken = tokenManager.generateRefreshToken('user-123');

    expect(tokenManager.verifyRefreshToken(refreshToken)).toMatchObject({
      sub: 'user-123',
      type: 'refresh',
      iss: 'insforge',
    });
  });
});
