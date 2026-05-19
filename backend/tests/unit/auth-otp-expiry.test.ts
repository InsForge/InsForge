import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPool, mockGetAuthConfig, mockHash, mockGenerateNumericCode, mockGenerateSecureToken } =
  vi.hoisted(() => ({
    mockPool: {
      query: vi.fn(),
    },
    mockGetAuthConfig: vi.fn(),
    mockHash: vi.fn(),
    mockGenerateNumericCode: vi.fn(),
    mockGenerateSecureToken: vi.fn(),
  }));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/services/auth/auth-config.service.js', () => ({
  AuthConfigService: {
    getInstance: () => ({
      getAuthConfig: mockGetAuthConfig,
    }),
  },
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: mockHash,
  },
  hash: mockHash,
}));

vi.mock('../../src/utils/utils.js', () => ({
  generateNumericCode: mockGenerateNumericCode,
  generateSecureToken: mockGenerateSecureToken,
}));

vi.mock('../../src/utils/logger.js', () => ({
  __esModule: true,
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { AuthOTPService, OTPPurpose, OTPType } from '../../src/services/auth/auth-otp.service';

describe('AuthOTPService token expiry config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-20T00:00:00.000Z'));
    mockGetAuthConfig.mockResolvedValue({
      verifyEmailCodeExpiryMinutes: 17,
      verifyEmailLinkExpiryHours: 36,
      resetPasswordCodeExpiryMinutes: 3,
      resetPasswordLinkExpiryHours: 5,
    });
    mockGenerateNumericCode.mockReturnValue('123456');
    mockGenerateSecureToken.mockReturnValue('abcdef0123456789');
    mockHash.mockResolvedValue('hashed-code');
    mockPool.query.mockResolvedValue({ rows: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AuthOTPService as any).instance = undefined;
  });

  it('uses reset password code expiry for numeric reset tokens', async () => {
    const service = AuthOTPService.getInstance();

    const result = await service.createEmailOTP(
      'user@example.com',
      OTPPurpose.RESET_PASSWORD,
      OTPType.NUMERIC_CODE
    );

    expect(result.expiresAt.toISOString()).toBe('2026-05-20T00:03:00.000Z');
    expect(mockPool.query).toHaveBeenCalledWith(expect.any(String), [
      'user@example.com',
      OTPPurpose.RESET_PASSWORD,
      'hashed-code',
      result.expiresAt,
      null,
    ]);
  });

  it('uses reset password link expiry when exchanging a code for a token', async () => {
    const service = AuthOTPService.getInstance();
    const verifySpy = vi.spyOn(service, 'verifyEmailOTPWithCode').mockResolvedValue({
      success: true,
      email: 'user@example.com',
      purpose: OTPPurpose.RESET_PASSWORD,
    });
    const mockClient = {
      query: vi.fn().mockResolvedValue({}),
    };

    const result = await service.exchangeCodeForToken(
      'user@example.com',
      OTPPurpose.RESET_PASSWORD,
      '123456',
      mockClient as never
    );

    expect(verifySpy).toHaveBeenCalledWith(
      'user@example.com',
      OTPPurpose.RESET_PASSWORD,
      '123456',
      mockClient
    );
    expect(result.expiresAt.toISOString()).toBe('2026-05-20T05:00:00.000Z');
    expect(mockClient.query).toHaveBeenCalledWith(expect.any(String), [
      'user@example.com',
      OTPPurpose.RESET_PASSWORD,
      expect.any(String),
      result.expiresAt,
    ]);
  });
});
