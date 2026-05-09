import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPool } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: mockLogger,
  logger: mockLogger,
}));

vi.mock('../../src/utils/utils', () => ({
  generateNumericCode: () => '123456',
  generateSecureToken: () => 'a'.repeat(64),
}));

vi.mock('bcryptjs', () => ({
  __esModule: true,
  default: {
    hash: vi.fn().mockResolvedValue('hashed_code'),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

import { AuthOTPService, OTPPurpose, OTPType } from '../../src/services/auth/auth-otp.service';
import { AuthConfigService } from '../../src/services/auth/auth-config.service';

describe('AuthOTPService - configurable expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AuthConfigService.getInstance().clearCache();
  });

  function mockAuthConfig(overrides: Partial<{
    verifyEmailCodeExpiryMinutes: number;
    verifyEmailLinkExpiryMinutes: number;
    resetPasswordCodeExpiryMinutes: number;
    resetPasswordLinkExpiryMinutes: number;
  }> = {}) {
    const defaults = {
      id: '00000000-0000-0000-0000-000000000001',
      requireEmailVerification: false,
      passwordMinLength: 6,
      requireNumber: false,
      requireLowercase: false,
      requireUppercase: false,
      requireSpecialChar: false,
      verifyEmailMethod: 'code' as const,
      resetPasswordMethod: 'code' as const,
      allowedRedirectUrls: [],
      verifyEmailCodeExpiryMinutes: 15,
      verifyEmailLinkExpiryMinutes: 1440,
      resetPasswordCodeExpiryMinutes: 10,
      resetPasswordLinkExpiryMinutes: 60,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.spyOn(AuthConfigService.getInstance(), 'getAuthConfig').mockResolvedValue({
      ...defaults,
      ...overrides,
    });
  }

  describe('createEmailOTP uses configured expiry', () => {
    it('uses verifyEmailCodeExpiryMinutes for VERIFY_EMAIL + NUMERIC_CODE', async () => {
      mockAuthConfig({ verifyEmailCodeExpiryMinutes: 20 });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const service = AuthOTPService.getInstance();
      const before = Date.now();
      const result = await service.createEmailOTP(
        'test@example.com',
        OTPPurpose.VERIFY_EMAIL,
        OTPType.NUMERIC_CODE
      );

      const expectedMinExpiry = before + 20 * 60 * 1000;
      const expectedMaxExpiry = expectedMinExpiry + 5000;
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMinExpiry);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedMaxExpiry);
    });

    it('uses verifyEmailLinkExpiryMinutes for VERIFY_EMAIL + HASH_TOKEN', async () => {
      mockAuthConfig({ verifyEmailLinkExpiryMinutes: 720 });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const service = AuthOTPService.getInstance();
      const before = Date.now();
      const result = await service.createEmailOTP(
        'test@example.com',
        OTPPurpose.VERIFY_EMAIL,
        OTPType.HASH_TOKEN
      );

      const expectedMinExpiry = before + 720 * 60 * 1000;
      const expectedMaxExpiry = expectedMinExpiry + 5000;
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMinExpiry);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedMaxExpiry);
    });

    it('uses resetPasswordCodeExpiryMinutes for RESET_PASSWORD + NUMERIC_CODE', async () => {
      mockAuthConfig({ resetPasswordCodeExpiryMinutes: 5 });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const service = AuthOTPService.getInstance();
      const before = Date.now();
      const result = await service.createEmailOTP(
        'test@example.com',
        OTPPurpose.RESET_PASSWORD,
        OTPType.NUMERIC_CODE
      );

      const expectedMinExpiry = before + 5 * 60 * 1000;
      const expectedMaxExpiry = expectedMinExpiry + 5000;
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMinExpiry);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedMaxExpiry);
    });

    it('uses resetPasswordLinkExpiryMinutes for RESET_PASSWORD + HASH_TOKEN', async () => {
      mockAuthConfig({ resetPasswordLinkExpiryMinutes: 30 });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const service = AuthOTPService.getInstance();
      const before = Date.now();
      const result = await service.createEmailOTP(
        'test@example.com',
        OTPPurpose.RESET_PASSWORD,
        OTPType.HASH_TOKEN
      );

      const expectedMinExpiry = before + 30 * 60 * 1000;
      const expectedMaxExpiry = expectedMinExpiry + 5000;
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMinExpiry);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedMaxExpiry);
    });

    it('falls back to default expiry when config read fails', async () => {
      vi.spyOn(AuthConfigService.getInstance(), 'getAuthConfig').mockRejectedValue(
        new Error('DB unavailable')
      );
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const service = AuthOTPService.getInstance();
      const before = Date.now();
      const result = await service.createEmailOTP(
        'test@example.com',
        OTPPurpose.VERIFY_EMAIL,
        OTPType.NUMERIC_CODE
      );

      const expectedMinExpiry = before + 15 * 60 * 1000;
      const expectedMaxExpiry = expectedMinExpiry + 5000;
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMinExpiry);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedMaxExpiry);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to read token expiry config, using defaults'
      );
    });
  });

  describe('exchangeCodeForToken uses configured expiry', () => {
    it('uses resetPasswordLinkExpiryMinutes for the issued token', async () => {
      mockAuthConfig({ resetPasswordLinkExpiryMinutes: 45 });

      const mockClient = {
        query: vi.fn(),
        release: vi.fn(),
      };
      mockPool.connect.mockResolvedValue(mockClient);

      // BEGIN
      mockClient.query.mockResolvedValueOnce({});
      // SELECT for verifyEmailOTPWithCode (row lock)
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'otp-id',
            email: 'test@example.com',
            purpose: 'RESET_PASSWORD',
            otp_hash: 'hashed_code',
            expires_at: new Date(Date.now() + 600000).toISOString(),
            consumed_at: null,
            redirect_to: null,
          },
        ],
      });
      // UPDATE consumed_at (mark as consumed)
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
      // INSERT new hash token (upsert)
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      // COMMIT
      mockClient.query.mockResolvedValueOnce({});

      const service = AuthOTPService.getInstance();
      const before = Date.now();
      const result = await service.exchangeCodeForToken(
        'test@example.com',
        OTPPurpose.RESET_PASSWORD,
        '123456'
      );

      const expectedMinExpiry = before + 45 * 60 * 1000;
      const expectedMaxExpiry = expectedMinExpiry + 5000;
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMinExpiry);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedMaxExpiry);
    });
  });
});
