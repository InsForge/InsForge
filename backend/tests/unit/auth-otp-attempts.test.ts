import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

const mocks = vi.hoisted(() => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
  client: {
    query: vi.fn(),
    release: vi.fn(),
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
import { AppError } from '../../src/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

describe('AuthOTPService numeric attempt limits', () => {
  let service: AuthOTPService;

  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.set(AuthOTPService, 'instance', undefined);
    mocks.pool.connect.mockResolvedValue(mocks.client);
    service = AuthOTPService.getInstance();
  });

  it.each([OTPPurpose.SIGN_IN, OTPPurpose.VERIFY_EMAIL, OTPPurpose.RESET_PASSWORD])(
    'persists a failed %s attempt and invalidates the third failure',
    async (purpose) => {
      mocks.client.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'otp-id',
              email: 'user@example.com',
              purpose,
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
        purpose,
        '000000'
      );

      expect(result.success).toBe(false);
      expect(mocks.client.query.mock.calls[1][0]).toContain(
        'WHEN attempts_count + 1 >= $2 THEN NOW()'
      );
      expect(mocks.client.query.mock.calls[1][1]).toEqual(['otp-id', 3]);
    }
  );

  it.each([OTPPurpose.VERIFY_EMAIL, OTPPurpose.RESET_PASSWORD])(
    'rejects an exhausted %s challenge without comparing the code again',
    async (purpose) => {
      mocks.client.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'otp-id',
            email: 'user@example.com',
            purpose,
            otp_hash: 'hash',
            expires_at: new Date(Date.now() + 60_000),
            consumed_at: null,
            redirect_to: null,
            attempts_count: 3,
          },
        ],
      });

      const result = await service.attemptEmailOTPWithCode(
        mocks.client as unknown as PoolClient,
        'user@example.com',
        purpose,
        '000000'
      );

      expect(result.success).toBe(false);
      expect(mocks.compare).not.toHaveBeenCalled();
      expect(mocks.client.query).toHaveBeenCalledTimes(1);
    }
  );

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
            attempts_count: 2,
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

  it('resets attempts and uses a five-minute expiry for sign-in challenges', async () => {
    vi.useFakeTimers();
    try {
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
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([OTPPurpose.VERIFY_EMAIL, OTPPurpose.RESET_PASSWORD])(
    'resets attempts when issuing a fresh %s numeric challenge',
    async (purpose) => {
      mocks.hash.mockResolvedValue('hash');
      mocks.pool.query.mockResolvedValue({ rows: [] });

      await service.createEmailOTP('user@example.com', purpose, OTPType.NUMERIC_CODE);

      expect(mocks.pool.query.mock.calls[0][0]).toContain('attempts_count = 0');
    }
  );
});

describe('AuthOTPService.consumeNumericOTP transaction ownership', () => {
  let service: AuthOTPService;

  const validRow = {
    id: 'otp-id',
    email: 'user@example.com',
    purpose: OTPPurpose.SIGN_IN,
    otp_hash: 'hash',
    expires_at: new Date(Date.now() + 60_000),
    consumed_at: null,
    redirect_to: null,
    attempts_count: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.set(AuthOTPService, 'instance', undefined);
    mocks.pool.connect.mockResolvedValue(mocks.client);
    service = AuthOTPService.getInstance();
  });

  it('commits the caller work with the consumed code and returns its result', async () => {
    mocks.client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [validRow] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rowCount: 1 }) // consume
      .mockResolvedValueOnce(undefined); // COMMIT
    mocks.compare.mockResolvedValue(true);
    const onVerified = vi.fn().mockResolvedValue('session');

    const result = await service.consumeNumericOTP(
      'user@example.com',
      OTPPurpose.SIGN_IN,
      '123456',
      onVerified
    );

    expect(result).toBe('session');
    expect(onVerified).toHaveBeenCalledWith(
      mocks.client,
      expect.objectContaining({ success: true })
    );
    const sql = mocks.client.query.mock.calls.map(([q]) => q);
    expect(sql).toContain('BEGIN');
    expect(sql).toContain('COMMIT');
    expect(sql).not.toContain('ROLLBACK');
    expect(mocks.client.release).toHaveBeenCalledOnce();
  });

  it('commits the persisted attempt counter before throwing on a failed code', async () => {
    mocks.client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [validRow] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({}) // attempt increment
      .mockResolvedValueOnce(undefined); // COMMIT
    mocks.compare.mockResolvedValue(false);
    const onVerified = vi.fn();

    await expect(
      service.consumeNumericOTP('user@example.com', OTPPurpose.SIGN_IN, '000000', onVerified)
    ).rejects.toBeInstanceOf(AppError);

    expect(onVerified).not.toHaveBeenCalled();
    const sql = mocks.client.query.mock.calls.map(([q]) => q);
    expect(sql).toContain('COMMIT');
    expect(sql).not.toContain('ROLLBACK');
  });

  it('rolls back when the caller work throws, un-consuming the code', async () => {
    mocks.client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [validRow] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rowCount: 1 }) // consume
      .mockResolvedValueOnce(undefined); // ROLLBACK
    mocks.compare.mockResolvedValue(true);
    const boom = new AppError('boom', 400, ERROR_CODES.INVALID_INPUT);

    await expect(
      service.consumeNumericOTP('user@example.com', OTPPurpose.SIGN_IN, '123456', async () => {
        throw boom;
      })
    ).rejects.toBe(boom);

    const sql = mocks.client.query.mock.calls.map(([q]) => q);
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(mocks.client.release).toHaveBeenCalledOnce();
  });
});
