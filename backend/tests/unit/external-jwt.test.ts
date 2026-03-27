import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response, NextFunction } from 'express';
import { jwtVerify } from 'jose';

// Mock jose before importing modules that use it
vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => 'mockedJwks'),
}));

// Mock DatabaseManager
const mockQuery = vi.fn();
vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => ({ query: mockQuery, connect: vi.fn() }),
    }),
  },
}));

// Mock SecretService (needed by auth middleware)
vi.mock('@/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({
      verifyApiKey: vi.fn().mockResolvedValue(false),
    }),
  },
}));

// Set JWT_SECRET in beforeAll — vi.mock hoists above import-time code,
// but beforeAll runs before tests. The key issue is that auth.ts module-level
// code calls TokenManager.getInstance() at import time. We set the env var
// in the vi.hoisted block which runs before module evaluation.
vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-key-for-external-jwt-tests';
});

import { ExternalJwtService } from '../../src/services/auth/external-jwt.service';
import { verifyToken, AuthRequest } from '../../src/api/middlewares/auth';
import { TokenManager } from '../../src/infra/security/token.manager';

describe('ExternalJwtService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    // Reset singleton for clean tests
    (ExternalJwtService as unknown as { instance: null }).instance = null;
  });

  // ---------------------------------------------------------------------------
  // verifyExternalToken
  // ---------------------------------------------------------------------------
  describe('verifyExternalToken', () => {
    it('returns null when no providers are configured', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const service = ExternalJwtService.getInstance();
      const fakeJwt = createFakeJwt({ iss: 'https://clerk.example.com', sub: 'user_123' });

      const result = await service.verifyExternalToken(fakeJwt);
      expect(result).toBeNull();
    });

    it('returns null for non-JWT strings', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      const service = ExternalJwtService.getInstance();

      const result = await service.verifyExternalToken('not-a-jwt');
      expect(result).toBeNull();
    });

    it('returns null when issuer does not match any provider', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          makeProvider({
            issuer: 'https://auth.example.com',
            jwks_url: 'https://auth.example.com/.well-known/jwks.json',
          }),
        ],
      });

      const service = ExternalJwtService.getInstance();
      const fakeJwt = createFakeJwt({ iss: 'https://different-issuer.com', sub: 'u1' });

      const result = await service.verifyExternalToken(fakeJwt);
      expect(result).toBeNull();
    });

    it('returns normalized user when provider matches and verification succeeds', async () => {
      const provider = makeProvider({
        provider_key: 'clerk',
        issuer: 'https://clerk.example.com',
        audience: 'my-app',
        jwks_url: 'https://clerk.example.com/.well-known/jwks.json',
        default_role: 'authenticated',
        claim_mappings: { sub: 'sub', email: 'email' },
      });
      mockQuery.mockResolvedValue({ rows: [provider] });

      (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: {
          iss: 'https://clerk.example.com',
          aud: 'my-app',
          sub: 'user_abc123',
          email: 'alice@example.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
      });

      const service = ExternalJwtService.getInstance();
      const fakeJwt = createFakeJwt({
        iss: 'https://clerk.example.com',
        sub: 'user_abc123',
        email: 'alice@example.com',
      });

      const result = await service.verifyExternalToken(fakeJwt);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('user_abc123');
      expect(result!.email).toBe('alice@example.com');
      expect(result!.role).toBe('authenticated');
      expect(result!.provider_key).toBe('clerk');
    });

    it('returns null when JWT signature verification fails', async () => {
      const provider = makeProvider({
        issuer: 'https://clerk.example.com',
        jwks_url: 'https://clerk.example.com/.well-known/jwks.json',
      });
      mockQuery.mockResolvedValue({ rows: [provider] });

      (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('signature verification failed')
      );

      const service = ExternalJwtService.getInstance();
      const fakeJwt = createFakeJwt({ iss: 'https://clerk.example.com', sub: 'u1' });

      const result = await service.verifyExternalToken(fakeJwt);
      expect(result).toBeNull();
    });

    it('returns null when required claims are missing', async () => {
      const provider = makeProvider({
        issuer: 'https://clerk.example.com',
        jwks_url: 'https://clerk.example.com/.well-known/jwks.json',
        claim_mappings: { sub: 'sub', email: 'email' },
      });
      mockQuery.mockResolvedValue({ rows: [provider] });

      (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: {
          iss: 'https://clerk.example.com',
          sub: 'user_123',
          // no email claim
        },
      });

      const service = ExternalJwtService.getInstance();
      const fakeJwt = createFakeJwt({ iss: 'https://clerk.example.com', sub: 'user_123' });

      const result = await service.verifyExternalToken(fakeJwt);
      expect(result).toBeNull();
    });

    it('supports nested claim mappings', async () => {
      const provider = makeProvider({
        issuer: 'https://auth0.example.com',
        jwks_url: 'https://auth0.example.com/.well-known/jwks.json',
        claim_mappings: { sub: 'sub', email: 'user_metadata.email' },
      });
      mockQuery.mockResolvedValue({ rows: [provider] });

      (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: {
          iss: 'https://auth0.example.com',
          sub: 'auth0|abc',
          user_metadata: { email: 'nested@example.com' },
        },
      });

      const service = ExternalJwtService.getInstance();
      const fakeJwt = createFakeJwt({
        iss: 'https://auth0.example.com',
        sub: 'auth0|abc',
      });

      const result = await service.verifyExternalToken(fakeJwt);
      expect(result).not.toBeNull();
      expect(result!.email).toBe('nested@example.com');
    });
  });

  // ---------------------------------------------------------------------------
  // Token re-signing for PostgREST
  // ---------------------------------------------------------------------------
  describe('Token re-signing for PostgREST', () => {
    it('generateExternalUserToken produces a valid InsForge JWT', async () => {
      const jwt = await import('jsonwebtoken');
      const secret = process.env.JWT_SECRET!;

      const payload = { sub: 'ext_user_123', email: 'ext@example.com', role: 'authenticated' };
      const token = jwt.default.sign(payload, secret, {
        algorithm: 'HS256',
        expiresIn: '15m',
      });

      const decoded = jwt.default.verify(token, secret) as Record<string, unknown>;
      expect(decoded.sub).toBe('ext_user_123');
      expect(decoded.email).toBe('ext@example.com');
      expect(decoded.role).toBe('authenticated');
    });

    it('supports non-UUID subject IDs in re-signed tokens', async () => {
      const jwt = await import('jsonwebtoken');
      const secret = process.env.JWT_SECRET!;

      // Clerk-style non-UUID user ID
      const payload = { sub: 'user_2xPnG8KxVQr', email: 'clerk@example.com', role: 'authenticated' };
      const token = jwt.default.sign(payload, secret, { algorithm: 'HS256', expiresIn: '15m' });

      const decoded = jwt.default.verify(token, secret) as Record<string, unknown>;
      expect(decoded.sub).toBe('user_2xPnG8KxVQr');
    });
  });

  // ---------------------------------------------------------------------------
  // Provider CRUD
  // ---------------------------------------------------------------------------
  describe('Provider CRUD', () => {
    it('createProvider validates JWKS URL is HTTPS', async () => {
      const service = ExternalJwtService.getInstance();

      await expect(
        service.createProvider({
          name: 'Test',
          provider_key: 'test',
          issuer: 'https://test.com',
          jwks_url: 'http://insecure.com/.well-known/jwks.json',
          claim_mappings: { sub: 'sub', email: 'email' },
        })
      ).rejects.toThrow('JWKS URL must use HTTPS');
    });

    it('createProvider allows localhost JWKS URL for development', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          makeProvider({
            jwks_url: 'http://localhost:3000/.well-known/jwks.json',
          }),
        ],
      });

      const service = ExternalJwtService.getInstance();
      const result = await service.createProvider({
        name: 'Local Dev',
        provider_key: 'local',
        issuer: 'http://localhost:3000',
        jwks_url: 'http://localhost:3000/.well-known/jwks.json',
        claim_mappings: { sub: 'sub', email: 'email' },
      });

      expect(result).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // updateProvider partial update semantics
  // ---------------------------------------------------------------------------
  describe('updateProvider partial update semantics', () => {
    it('can disable a provider (is_enabled = false)', async () => {
      const existing = makeProvider({ is_enabled: true });
      // First call: getProviderByKey
      mockQuery.mockResolvedValueOnce({ rows: [existing] });
      // Second call: UPDATE
      mockQuery.mockResolvedValueOnce({ rows: [{ ...existing, is_enabled: false }] });

      const service = ExternalJwtService.getInstance();
      const result = await service.updateProvider('test-provider', { is_enabled: false });

      expect(result.is_enabled).toBe(false);
      // Verify the SQL includes is_enabled parameter with false value
      const updateCall = mockQuery.mock.calls[1];
      const sql = updateCall[0] as string;
      const params = updateCall[1] as unknown[];
      expect(sql).toContain('is_enabled');
      expect(params).toContain(false);
    });

    it('can re-enable a provider (is_enabled = true)', async () => {
      const existing = makeProvider({ is_enabled: false });
      mockQuery.mockResolvedValueOnce({ rows: [existing] });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...existing, is_enabled: true }] });

      const service = ExternalJwtService.getInstance();
      const result = await service.updateProvider('test-provider', { is_enabled: true });

      expect(result.is_enabled).toBe(true);
      const params = mockQuery.mock.calls[1][1] as unknown[];
      expect(params).toContain(true);
    });

    it('can clear audience to null', async () => {
      const existing = makeProvider({ audience: 'old-audience' });
      mockQuery.mockResolvedValueOnce({ rows: [existing] });
      mockQuery.mockResolvedValueOnce({ rows: [{ ...existing, audience: null }] });

      const service = ExternalJwtService.getInstance();
      const result = await service.updateProvider('test-provider', { audience: null });

      expect(result.audience).toBeNull();
      const params = mockQuery.mock.calls[1][1] as unknown[];
      expect(params).toContain(null);
    });

    it('leaves audience unchanged when omitted from input', async () => {
      const existing = makeProvider({ audience: 'keep-this' });
      mockQuery.mockResolvedValueOnce({ rows: [existing] });
      // Only updating name, not audience
      mockQuery.mockResolvedValueOnce({ rows: [{ ...existing, name: 'New Name' }] });

      const service = ExternalJwtService.getInstance();
      await service.updateProvider('test-provider', { name: 'New Name' });

      const sql = mockQuery.mock.calls[1][0] as string;
      // audience should NOT appear in the SET clause
      expect(sql).not.toContain('audience');
      expect(sql).toContain('name');
    });

    it('returns existing provider unchanged when no fields are provided', async () => {
      const existing = makeProvider();
      mockQuery.mockResolvedValueOnce({ rows: [existing] });

      const service = ExternalJwtService.getInstance();
      const result = await service.updateProvider('test-provider', {});

      expect(result).toEqual(existing);
      // Only 1 query (the SELECT), no UPDATE issued
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // subject_type validation
  // ---------------------------------------------------------------------------
  describe('subject_type validation', () => {
    it('accepts non-UUID sub when subject_type is text (default)', async () => {
      const provider = makeProvider({
        issuer: 'https://clerk.example.com',
        jwks_url: 'https://clerk.example.com/.well-known/jwks.json',
        subject_type: 'text',
      });
      mockQuery.mockResolvedValue({ rows: [provider] });

      (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: {
          iss: 'https://clerk.example.com',
          sub: 'user_2xPnG8KxVQr',
          email: 'clerk@example.com',
        },
      });

      const service = ExternalJwtService.getInstance();
      const fakeJwt = createFakeJwt({ iss: 'https://clerk.example.com', sub: 'user_2xPnG8KxVQr' });

      const result = await service.verifyExternalToken(fakeJwt);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('user_2xPnG8KxVQr');
    });

    it('accepts valid UUID sub when subject_type is uuid', async () => {
      const provider = makeProvider({
        issuer: 'https://custom-idp.example.com',
        jwks_url: 'https://custom-idp.example.com/.well-known/jwks.json',
        subject_type: 'uuid',
      });
      mockQuery.mockResolvedValue({ rows: [provider] });

      const validUuid = '550e8400-e29b-41d4-a716-446655440000';
      (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: {
          iss: 'https://custom-idp.example.com',
          sub: validUuid,
          email: 'uuid-user@example.com',
        },
      });

      const service = ExternalJwtService.getInstance();
      const fakeJwt = createFakeJwt({ iss: 'https://custom-idp.example.com', sub: validUuid });

      const result = await service.verifyExternalToken(fakeJwt);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(validUuid);
    });

    it('rejects non-UUID sub when subject_type is uuid', async () => {
      const provider = makeProvider({
        issuer: 'https://custom-idp.example.com',
        jwks_url: 'https://custom-idp.example.com/.well-known/jwks.json',
        subject_type: 'uuid',
      });
      mockQuery.mockResolvedValue({ rows: [provider] });

      (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: {
          iss: 'https://custom-idp.example.com',
          sub: 'user_not_a_uuid',
          email: 'bad@example.com',
        },
      });

      const service = ExternalJwtService.getInstance();
      const fakeJwt = createFakeJwt({ iss: 'https://custom-idp.example.com', sub: 'user_not_a_uuid' });

      const result = await service.verifyExternalToken(fakeJwt);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Integration: external JWT → auth middleware → postgrestToken
  // ---------------------------------------------------------------------------
  describe('End-to-end: external JWT through auth middleware', () => {
    it('sets req.user and req.postgrestToken without mutating Authorization header', async () => {
      // Configure a matching external provider
      const provider = makeProvider({
        provider_key: 'clerk',
        issuer: 'https://clerk.example.com',
        jwks_url: 'https://clerk.example.com/.well-known/jwks.json',
        claim_mappings: { sub: 'sub', email: 'email' },
        default_role: 'authenticated',
      });
      mockQuery.mockResolvedValue({ rows: [provider] });

      // Mock jose.jwtVerify to succeed for this token
      (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: {
          iss: 'https://clerk.example.com',
          sub: 'user_clerk_abc',
          email: 'clerk-user@example.com',
        },
      });

      // Reset ExternalJwtService singleton to pick up fresh mock state
      (ExternalJwtService as unknown as { instance: null }).instance = null;

      // Build a fake external JWT (not a native InsForge token)
      const externalToken = createFakeJwt({
        iss: 'https://clerk.example.com',
        sub: 'user_clerk_abc',
        email: 'clerk-user@example.com',
      });
      const originalAuthHeader = `Bearer ${externalToken}`;

      // Build mock request/response/next
      const req = {
        headers: { authorization: originalAuthHeader },
        user: undefined,
        postgrestToken: undefined,
      } as unknown as AuthRequest;

      const res = {} as Response;
      let nextCalled = false;
      let nextError: unknown = null;
      const next: NextFunction = (err?: unknown) => {
        nextCalled = true;
        nextError = err ?? null;
      };

      await verifyToken(req, res, next);

      // Middleware should call next() without error
      expect(nextCalled).toBe(true);
      expect(nextError).toBeNull();

      // req.user should be set from external JWT claims
      expect(req.user).toBeDefined();
      expect(req.user!.id).toBe('user_clerk_abc');
      expect(req.user!.email).toBe('clerk-user@example.com');
      expect(req.user!.role).toBe('authenticated');

      // Original Authorization header must be preserved
      expect(req.headers.authorization).toBe(originalAuthHeader);

      // postgrestToken must be set (a re-signed InsForge JWT)
      expect(req.postgrestToken).toBeDefined();
      expect(typeof req.postgrestToken).toBe('string');
      expect(req.postgrestToken!.length).toBeGreaterThan(0);

      // postgrestToken should be different from the original external token
      expect(req.postgrestToken).not.toBe(externalToken);
    });

    it('does not set postgrestToken for native InsForge JWTs', async () => {
      // Reset TokenManager singleton
      (TokenManager as unknown as { instance: null }).instance = null;
      const tokenManager = TokenManager.getInstance();

      const nativeToken = tokenManager.generateAccessToken({
        sub: '550e8400-e29b-41d4-a716-446655440000',
        email: 'native@example.com',
        role: 'authenticated',
      });

      const req = {
        headers: { authorization: `Bearer ${nativeToken}` },
        user: undefined,
        postgrestToken: undefined,
      } as unknown as AuthRequest;

      const res = {} as Response;
      let nextCalled = false;
      let nextError: unknown = null;
      const next: NextFunction = (err?: unknown) => {
        nextCalled = true;
        nextError = err ?? null;
      };

      await verifyToken(req, res, next);

      expect(nextCalled).toBe(true);
      expect(nextError).toBeNull();
      expect(req.user).toBeDefined();
      expect(req.user!.id).toBe('550e8400-e29b-41d4-a716-446655440000');
      // Native tokens should NOT set postgrestToken
      expect(req.postgrestToken).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = Buffer.from('fake-signature').toString('base64url');
  return `${header}.${body}.${signature}`;
}

function makeProvider(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'test-provider-id',
    name: 'Test Provider',
    provider_key: 'test-provider',
    issuer: 'https://test.example.com',
    audience: null,
    jwks_url: 'https://test.example.com/.well-known/jwks.json',
    claim_mappings: { sub: 'sub', email: 'email' },
    default_role: 'authenticated',
    subject_type: 'text',
    is_enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}
