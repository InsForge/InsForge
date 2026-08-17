import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPoolQuery, loggerMocks } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  loggerMocks: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => ({ query: mockPoolQuery }),
    }),
  },
}));

vi.mock('../../src/infra/security/encryption.manager.js', () => ({
  EncryptionManager: {
    encrypt: (value: string) => `enc:${value}`,
  },
}));

vi.mock('../../src/utils/logger.js', () => ({ default: loggerMocks }));

async function loadSecretService() {
  const { SecretService } = await import('../../src/services/secrets/secret.service.js');
  return SecretService.getInstance();
}

describe('SecretService.createSecretStrict', () => {
  beforeEach(() => {
    vi.resetModules();
    mockPoolQuery.mockReset();
    vi.clearAllMocks();
  });

  it('creates an absent name with an explicit value-free disposition', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 'new-id' }] });

    const service = await loadSecretService();
    const result = await service.createSecretStrict({ key: 'STRICT_KEY', value: 'candidate' });

    expect(result).toEqual({ id: 'new-id', disposition: 'created' });
    expect(mockPoolQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO system.secrets');
    expect(sql).toContain('ON CONFLICT (key) DO NOTHING');
    expect(sql).not.toContain('UPDATE system.secrets');
    expect(params).toEqual(['STRICT_KEY', 'enc:candidate', false, null]);
  });

  it('rejects a tombstoned name without reactivating or updating it', async () => {
    // PostgreSQL returns no row for ON CONFLICT whether the existing key is
    // active or inactive; strict mode deliberately treats both identically.
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const service = await loadSecretService();
    await expect(
      service.createSecretStrict({ key: 'TOMBSTONED_KEY', value: 'candidate' })
    ).rejects.toMatchObject({
      name: 'AppError',
      statusCode: 409,
      code: 'SECRET_ALREADY_EXISTS',
    });

    expect(mockPoolQuery).toHaveBeenCalledOnce();
    expect(mockPoolQuery.mock.calls[0][0]).not.toContain('UPDATE system.secrets');
  });

  it('allows exactly one of two concurrent creates for the same name', async () => {
    let insertAttempt = 0;
    mockPoolQuery.mockImplementation(async () => {
      const attempt = ++insertAttempt;
      await Promise.resolve();
      return attempt === 1 ? { rows: [{ id: 'winner-id' }] } : { rows: [] };
    });

    const service = await loadSecretService();
    const settled = await Promise.allSettled([
      service.createSecretStrict({ key: 'RACE_KEY', value: 'first' }),
      service.createSecretStrict({ key: 'RACE_KEY', value: 'second' }),
    ]);

    const fulfilled = settled.filter((item) => item.status === 'fulfilled');
    const rejected = settled.filter((item) => item.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0]).toMatchObject({
      value: { id: 'winner-id', disposition: 'created' },
    });
    expect(rejected[0]).toMatchObject({
      reason: { statusCode: 409, code: 'SECRET_ALREADY_EXISTS' },
    });
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
  });

  it('uses a supplied transaction client for the atomic insert', async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rows: [{ id: 'tx-id' }] });
    const service = await loadSecretService();

    await expect(
      service.createSecretStrict({ key: 'TX_KEY', value: 'candidate' }, {
        query: clientQuery,
      } as never)
    ).resolves.toEqual({ id: 'tx-id', disposition: 'created' });

    expect(clientQuery).toHaveBeenCalledOnce();
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it('does not write the candidate value to application logs', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 'safe-id' }] });
    const service = await loadSecretService();

    await service.createSecretStrict({ key: 'SAFE_KEY', value: 'never-log-this' });

    expect(JSON.stringify(loggerMocks.info.mock.calls)).not.toContain('never-log-this');
    expect(JSON.stringify(loggerMocks.error.mock.calls)).not.toContain('never-log-this');
  });
});
