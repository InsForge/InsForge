import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPoolQuery, mockConnect } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockConnect: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => ({
        query: mockPoolQuery,
        connect: mockConnect,
      }),
    }),
  },
}));

vi.mock('../../src/infra/security/encryption.manager.js', () => ({
  EncryptionManager: {
    encrypt: (value: string) => `enc:${value}`,
    decrypt: (value: string) => value.replace(/^enc:/, ''),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

async function loadSecretService() {
  const { SecretService } = await import('../../src/services/secrets/secret.service.js');
  return SecretService.getInstance();
}

/**
 * Regression tests for the soft-delete / UNIQUE(key) dead end:
 * the dashboard's DELETE endpoint deactivates secrets (is_active = false)
 * instead of removing the row, but UNIQUE(key) counts inactive rows, so a
 * blind INSERT of the same key fails with 23505 forever and the user cannot
 * recover from the dashboard (the list hides inactive rows).
 */
describe('SecretService.createSecret with soft-deleted rows', () => {
  beforeEach(() => {
    vi.resetModules();
    mockPoolQuery.mockReset();
    mockConnect.mockReset();
  });

  it('revives a soft-deleted row holding the key instead of inserting', async () => {
    // First query is the revive UPDATE — it finds the ghost row.
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 'ghost-id' }] });

    const service = await loadSecretService();
    const result = await service.createSecret({ key: 'GOOGLE_CLIENT_SECRET', value: 's3cret' });

    expect(result).toEqual({ id: 'ghost-id' });
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);

    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain('UPDATE system.secrets');
    // Only deactivated rows may be revived, and never reserved ones.
    expect(sql).toContain('is_active = false');
    expect(sql).toContain('is_reserved = false');
    expect(params).toEqual(['GOOGLE_CLIENT_SECRET', 'enc:s3cret', false, null]);
  });

  it('inserts a new row when no soft-deleted row holds the key', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] }) // revive UPDATE matches nothing
      .mockResolvedValueOnce({ rows: [{ id: 'new-id' }] }); // INSERT

    const service = await loadSecretService();
    const result = await service.createSecret({ key: 'STRIPE_API_KEY', value: 'sk_test' });

    expect(result).toEqual({ id: 'new-id' });
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    expect(mockPoolQuery.mock.calls[1][0]).toContain('INSERT INTO system.secrets');
  });

  it('maps a unique violation on an active row to a 409 AppError', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] }) // revive UPDATE matches nothing (row is active)
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }));

    const service = await loadSecretService();

    await expect(
      service.createSecret({ key: 'GOOGLE_CLIENT_SECRET', value: 's3cret' })
    ).rejects.toMatchObject({
      name: 'AppError',
      statusCode: 409,
      code: 'SECRET_ALREADY_EXISTS',
      message: expect.stringContaining('GOOGLE_CLIENT_SECRET'),
    });
  });

  it('keeps the generic error for non-unique-violation failures', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('connection refused'));

    const service = await loadSecretService();

    await expect(service.createSecret({ key: 'ANY_KEY', value: 'v' })).rejects.toThrow(
      'Failed to create secret'
    );
  });

  it('runs revive and insert on the provided transaction client when given', async () => {
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-id' }] });

    const service = await loadSecretService();
    const result = await service.createSecret({ key: 'DISCORD_CLIENT_SECRET', value: 'v' }, {
      query: clientQuery,
    } as never);

    expect(result).toEqual({ id: 'tx-id' });
    expect(clientQuery).toHaveBeenCalledTimes(2);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
});
