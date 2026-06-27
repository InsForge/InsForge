import { describe, expect, it, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// Generate mock RSA key pair for testing
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});
const testKid = 'kid_test';

const mockGetSecretByKey = vi.fn().mockImplementation((key: string) => {
  if (key === 'JWT_PRIVATE_KEY') return privateKey;
  if (key === 'JWT_PUBLIC_KEY') return publicKey;
  if (key === 'JWT_KEY_ID') return testKid;
  return null;
});

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({
      getSecretByKey: mockGetSecretByKey,
      initializeJwtKeyPair: vi.fn().mockResolvedValue({
        privateKey,
        publicKey,
        kid: testKid,
      }),
    }),
  },
}));

import { TokenManager } from '../../src/infra/security/token.manager.js';

describe('TokenManager JWKS & RS256 Support', () => {
  let tokenManager: TokenManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    tokenManager = TokenManager.getInstance();
    // Ensure keys are loaded in token manager
    await tokenManager.ensureKeysLoaded();
  });

  it('generates RS256 access tokens containing a kid header', async () => {
    const payload = { sub: 'test-user-id', email: 'test@example.com', role: 'authenticated' as const };
    const token = tokenManager.generateAccessToken(payload);
    
    expect(token).toBeDefined();
    
    // Decode the token header to inspect the kid and algorithm
    const decoded = jwt.decode(token, { complete: true }) as unknown as { header: { alg: string; kid: string } };
    expect(decoded).not.toBeNull();
    expect(decoded.header.alg).toBe('RS256');
    expect(decoded.header.kid).toBe(testKid);
  });

  it('verifies the RS256 access token successfully', async () => {
    const payload = { sub: 'test-user-id', email: 'test@example.com', role: 'authenticated' as const };
    const token = tokenManager.generateAccessToken(payload);
    
    const verified = tokenManager.verifyToken(token);
    expect(verified.sub).toBe(payload.sub);
    expect(verified.email).toBe(payload.email);
    expect(verified.role).toBe(payload.role);
  });

  it('falls back to verifying HS256 tokens signed with the shared secret', async () => {
    const payload = { sub: 'legacy-user-id', email: 'legacy@example.com', role: 'authenticated' as const };
    const legacyToken = jwt.sign(payload, process.env.JWT_SECRET || 'dev-secret-please-change-in-production', {
      algorithm: 'HS256',
      expiresIn: '15m',
    });
    
    const verified = tokenManager.verifyToken(legacyToken);
    expect(verified.sub).toBe(payload.sub);
    expect(verified.email).toBe(payload.email);
    expect(verified.role).toBe(payload.role);
  });

  it('exports the public key as a valid JWK Set (JWKS)', async () => {
    const jwks = await tokenManager.getJwks();
    expect(jwks).toBeDefined();
    expect(jwks.keys).toBeDefined();
    expect(jwks.keys.length).toBe(1);
    
    const key = jwks.keys[0];
    expect(key.kty).toBe('RSA');
    expect(key.alg).toBe('RS256');
    expect(key.use).toBe('sig');
    expect(key.kid).toBe(testKid);
    expect(key.n).toBeDefined();
    expect(key.e).toBeDefined();
  });
});
