import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenManager } from '../../src/infra/security/token.manager';

const { mockClient, mockPool, mockSecretService } = vi.hoisted(() => ({
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
  mockPool: {
    connect: vi.fn(),
  },
  mockSecretService: {
    getSecretByKey: vi.fn(),
    createSecret: vi.fn(),
    updateSecretByKey: vi.fn(),
  },
}));

vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('@/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => mockSecretService,
  },
}));

function generateRsaKeyPair(): { privateKey: string; publicKey: string } {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
}

function resetTokenManager(): void {
  (TokenManager as unknown as { instance?: TokenManager }).instance = undefined;
}

function useBaseEnv(originalEnv: NodeJS.ProcessEnv): void {
  process.env = {
    ...originalEnv,
    JWT_SECRET: 'legacy-secret-for-hs256-tests',
  };
  delete process.env.JWT_SIGNING_PRIVATE_KEY;
  delete process.env.JWT_SIGNING_PUBLIC_KEY;
  delete process.env.JWT_SIGNING_KID;
}

describe('TokenManager asymmetric token migration', () => {
  const originalEnv = process.env;
  let privateKey: string;
  let publicKey: string;

  beforeEach(async () => {
    const generated = generateRsaKeyPair();
    privateKey = generated.privateKey;
    publicKey = generated.publicKey;

    process.env = {
      ...originalEnv,
      JWT_SECRET: 'legacy-secret-for-hs256-tests',
      JWT_SIGNING_PRIVATE_KEY: privateKey,
      JWT_SIGNING_PUBLIC_KEY: publicKey,
      JWT_SIGNING_KID: 'test-key-id',
    };

    resetTokenManager();
    await TokenManager.getInstance().initialize();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetTokenManager();
    vi.resetAllMocks();
  });

  it('keeps PostgREST-facing access tokens on HS256 while publishing JWKS', () => {
    const tokenManager = TokenManager.getInstance();
    const token = tokenManager.generateAccessToken({
      sub: 'user-1',
      email: 'user@example.com',
      role: 'authenticated',
    });

    const decoded = jwt.decode(token, { complete: true }) as jwt.Jwt | null;

    expect(decoded?.header.alg).toBe('HS256');
    expect(decoded?.header.kid).toBeUndefined();
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

  it('verifies both RS256 and legacy HS256 access tokens during migration', () => {
    const tokenManager = TokenManager.getInstance();

    const rsToken = jwt.sign(
      {
        sub: 'user-1',
        email: 'user@example.com',
        role: 'authenticated',
      },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'test-key-id',
      }
    );

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

  it('ports RS256 refresh tokens onto session type and CSRF nonce claims', () => {
    const tokenManager = TokenManager.getInstance();
    const refreshToken = tokenManager.generateRefreshToken('user-123', 'user');
    const decoded = jwt.decode(refreshToken, { complete: true }) as jwt.Jwt | null;

    expect(decoded?.header.alg).toBe('RS256');
    expect(decoded?.header.kid).toBe('test-key-id');
    expect(tokenManager.verifyRefreshToken(refreshToken)).toMatchObject({
      sub: 'user-123',
      type: 'refresh',
      iss: 'insforge',
      sessionType: 'user',
      csrfNonce: expect.any(String),
    });
  });

  it('rejects RS256 tokens whose kid does not match the active JWKS key', () => {
    const tokenManager = TokenManager.getInstance();
    const token = jwt.sign(
      {
        sub: 'user-1',
        email: 'user@example.com',
        role: 'authenticated',
      },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'wrong-key-id',
      }
    );

    expect(() => tokenManager.verifyToken(token)).toThrow('Invalid token');
  });
});

describe('TokenManager kid derivation', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    resetTokenManager();
    vi.resetAllMocks();
  });

  it('derives a stable kid from the public key when env keys are provided without a kid', async () => {
    const generated = generateRsaKeyPair();

    process.env = {
      ...originalEnv,
      JWT_SECRET: 'legacy-secret-for-hs256-tests',
      JWT_SIGNING_PRIVATE_KEY: generated.privateKey,
      JWT_SIGNING_PUBLIC_KEY: generated.publicKey,
      JWT_SIGNING_KID: '',
    };

    resetTokenManager();
    const tokenManager = TokenManager.getInstance();
    await tokenManager.initialize();

    const refreshToken = tokenManager.generateRefreshToken('user-1', 'user');
    const decoded = jwt.decode(refreshToken, { complete: true }) as jwt.Jwt | null;
    const expectedKid = crypto.createHash('sha256').update(generated.publicKey).digest('base64url');

    expect(decoded?.header.kid).toBe(expectedKid);
    expect(tokenManager.getPublicJwks().keys[0]?.kid).toBe(expectedKid);
  });
});

describe('TokenManager system.secrets signing-key initialization', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    useBaseEnv(originalEnv);
    resetTokenManager();
    vi.resetAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [] });
    mockClient.release.mockReturnValue(undefined);
    mockSecretService.createSecret.mockResolvedValue({ id: 'secret-id' });
    mockSecretService.updateSecretByKey.mockResolvedValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
    resetTokenManager();
    vi.resetAllMocks();
  });

  it('persists a generated key bundle when no signing secrets exist', async () => {
    mockSecretService.getSecretByKey.mockResolvedValue(null);

    const tokenManager = TokenManager.getInstance();
    await tokenManager.initialize();

    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'insforge.jwt_signing_key_bundle',
    ]);
    expect(mockSecretService.createSecret).toHaveBeenCalledTimes(3);
    expect(mockSecretService.createSecret).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'JWT_SIGNING_PRIVATE_KEY', isReserved: true }),
      mockClient
    );
    expect(mockSecretService.createSecret).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'JWT_SIGNING_PUBLIC_KEY', isReserved: true }),
      mockClient
    );
    expect(mockSecretService.createSecret).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'JWT_SIGNING_KID', isReserved: true }),
      mockClient
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
    expect(tokenManager.getPublicJwks().keys[0]).toEqual(
      expect.objectContaining({ alg: 'RS256', kid: expect.any(String), kty: 'RSA' })
    );
  });

  it('loads an existing complete bundle and can sign refresh tokens', async () => {
    const generated = generateRsaKeyPair();
    mockSecretService.getSecretByKey.mockImplementation(async (key: string) => {
      if (key === 'JWT_SIGNING_PRIVATE_KEY') {
        return generated.privateKey;
      }
      if (key === 'JWT_SIGNING_PUBLIC_KEY') {
        return generated.publicKey;
      }
      if (key === 'JWT_SIGNING_KID') {
        return 'persisted-key-id';
      }
      return null;
    });

    const tokenManager = TokenManager.getInstance();
    await tokenManager.initialize();
    const refreshToken = tokenManager.generateRefreshToken('user-123', 'admin');
    const decoded = jwt.decode(refreshToken, { complete: true }) as jwt.Jwt | null;

    expect(mockSecretService.createSecret).not.toHaveBeenCalled();
    expect(decoded?.header.alg).toBe('RS256');
    expect(decoded?.header.kid).toBe('persisted-key-id');
    expect(tokenManager.verifyRefreshToken(refreshToken)).toMatchObject({
      sub: 'user-123',
      sessionType: 'admin',
      csrfNonce: expect.any(String),
    });
  });

  it('rolls back and surfaces a clear error when the persisted bundle is incomplete', async () => {
    const generated = generateRsaKeyPair();
    mockSecretService.getSecretByKey.mockImplementation(async (key: string) => {
      if (key === 'JWT_SIGNING_PRIVATE_KEY') {
        return generated.privateKey;
      }
      return null;
    });

    await expect(TokenManager.getInstance().initialize()).rejects.toThrow(
      'JWT signing key bundle is incomplete in system.secrets'
    );

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });
});
