import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

const mocks = vi.hoisted(() => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
  client: {
    query: vi.fn(),
  },
  compare: vi.fn(),
  hash: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mocks.pool,
    }),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: mocks.compare,
    hash: mocks.hash,
  },
}));

import { AuthOTPService, OTPPurpose, OTPType } from '../../src/services/auth/auth-otp.service.js';

describe('AuthOTPService numeric attempt limits', () => {
  let service: AuthOTPService;

  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.set(AuthOTPService, 'instance', undefined);
    service = AuthOTPService.getInstance();
  });

  it('persists a failed attempt and invalidates the third failure', async () => {
    mocks.client.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'otp-id',
            email: 'user@example.com',
            purpose: OTPPurpose.SIGN_IN,
            otp_hash: 'hash',
            expires_at: new Date(Date.now() + 60_000),
            consumed_at: null,
            redirect_to: null,
            attempts_count: 2,
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 });
    mocks.compare.mockResolvedValue(false);

    const result = await service.attemptEmailOTPWithCode(
      mocks.client as unknown as PoolClient,
      'user@example.com',
      OTPPurpose.SIGN_IN,
      '000000'
    );

    expect(result.success).toBe(false);
    expect(mocks.client.query.mock.calls[1][0]).toContain(
      'WHEN attempts_count + 1 >= $2 THEN NOW()'
    );
    expect(mocks.client.query.mock.calls[1][1]).toEqual(['otp-id', 3]);
  });

  it('consumes a valid code while holding the challenge row lock', async () => {
    mocks.client.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'otp-id',
            email: 'user@example.com',
            purpose: OTPPurpose.SIGN_IN,
            otp_hash: 'hash',
            expires_at: new Date(Date.now() + 60_000),
            consumed_at: null,
            redirect_to: null,
            attempts_count: 0,
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 });
    mocks.compare.mockResolvedValue(true);

    const result = await service.attemptEmailOTPWithCode(
      mocks.client as unknown as PoolClient,
      'user@example.com',
      OTPPurpose.SIGN_IN,
      '123456'
    );

    expect(mocks.client.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(result).toMatchObject({
      success: true,
      value: {
        email: 'user@example.com',
        purpose: OTPPurpose.SIGN_IN,
      },
    });
  });

  it('does not apply the sign-in attempt limit to existing OTP purposes', async () => {
    mocks.client.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'otp-id',
          email: 'user@example.com',
          purpose: OTPPurpose.RESET_PASSWORD,
          otp_hash: 'hash',
          expires_at: new Date(Date.now() + 60_000),
          consumed_at: null,
          redirect_to: null,
          attempts_count: 3,
        },
      ],
    });
    mocks.compare.mockResolvedValue(false);

    const result = await service.attemptEmailOTPWithCode(
      mocks.client as unknown as PoolClient,
      'user@example.com',
      OTPPurpose.RESET_PASSWORD,
      '000000'
    );

    expect(result.success).toBe(false);
    expect(mocks.compare).toHaveBeenCalledWith('000000', 'hash');
    expect(mocks.client.query).toHaveBeenCalledTimes(1);
  });

  it('resets attempts and uses a five-minute expiry for sign-in challenges', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    mocks.hash.mockResolvedValue('hash');
    mocks.pool.query.mockResolvedValue({ rows: [] });

    const result = await service.createEmailOTP(
      'user@example.com',
      OTPPurpose.SIGN_IN,
      OTPType.NUMERIC_CODE,
      { expiresInMinutes: 5 }
    );

    expect(result.expiresAt.toISOString()).toBe('2026-01-01T00:05:00.000Z');
    expect(mocks.pool.query.mock.calls[0][0]).toContain('attempts_count = 0');
    vi.useRealTimers();
  });
});
