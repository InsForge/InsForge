import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/utils/logger', () => ({ default: mockLogger }));

import { withPaymentSessionAdvisoryLock } from '../../src/services/payments/payments-advisory-lock';

describe('withPaymentSessionAdvisoryLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('releases the client normally after a successful unlock', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;

    await expect(
      withPaymentSessionAdvisoryLock(pool, 'payments_environment_test', async () => 'ok')
    ).resolves.toBe('ok');

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_advisory_lock(hashtext($1))',
      ['payments_environment_test']
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      'SELECT pg_advisory_unlock(hashtext($1))',
      ['payments_environment_test']
    );
    expect(client.release).toHaveBeenCalledWith();
  });

  it('destroys the pooled client if unlock fails', async () => {
    const unlockError = new Error('unlock failed');
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(unlockError),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;

    await expect(
      withPaymentSessionAdvisoryLock(pool, 'payments_environment_test', async () => 'ok')
    ).rejects.toThrow('unlock failed');

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_advisory_lock(hashtext($1))',
      ['payments_environment_test']
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      'SELECT pg_advisory_unlock(hashtext($1))',
      ['payments_environment_test']
    );
    expect(client.release).toHaveBeenCalledWith(true);
    expect(mockLogger.error).toHaveBeenCalledWith('Failed to release payments advisory lock', {
      lockName: 'payments_environment_test',
      mode: 'exclusive',
      error: 'unlock failed',
    });
  });
});
