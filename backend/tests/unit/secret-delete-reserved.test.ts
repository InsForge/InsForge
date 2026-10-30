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
 * `deleteSecretByKey` filters on `is_reserved = false`. Reserved secrets are
 * therefore invisible to it: the statement matches zero rows and it returns
 * false. That is correct for the generic Secrets surface and wrong for a
 * feature deleting a reserved secret it wrote itself — which is how
 * ApifyConfigService.deleteToken() shipped reporting a successful Disconnect
 * while leaving APIFY_API_TOKEN in the store.
 *
 * These tests pin both statements at the SQL level, so the split cannot be
 * quietly collapsed back into one.
 */
describe('SecretService key-based deletes and the reserved-secret guard', () => {
  beforeEach(() => {
    vi.resetModules();
    mockPoolQuery.mockReset();
    mockConnect.mockReset();
  });

  it('keeps reserved secrets out of reach of deleteSecretByKey', async () => {
    // A reserved row matches nothing, exactly as Postgres would report.
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 0 });

    const service = await loadSecretService();

    await expect(service.deleteSecretByKey('APIFY_API_TOKEN')).resolves.toBe(false);
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain('DELETE FROM system.secrets');
    expect(sql).toContain('is_reserved = false');
    expect(params).toEqual(['APIFY_API_TOKEN']);
  });

  it('deletes a reserved secret through the explicit opt-in', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 });

    const service = await loadSecretService();

    await expect(service.deleteReservedSecretByKey('APIFY_API_TOKEN')).resolves.toBe(true);
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain('DELETE FROM system.secrets');
    // The whole point of the opt-in: no is_reserved predicate at all.
    expect(sql).not.toContain('is_reserved');
    expect(params).toEqual(['APIFY_API_TOKEN']);
  });

  it('reports false when the opt-in delete matches no row at all', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 0 });

    const service = await loadSecretService();

    await expect(service.deleteReservedSecretByKey('NOT_THERE')).resolves.toBe(false);
  });

  it('runs the opt-in delete on a provided transaction client', async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rowCount: 1 });

    const service = await loadSecretService();

    await expect(
      service.deleteReservedSecretByKey('APIFY_API_TOKEN', { query: clientQuery } as never)
    ).resolves.toBe(true);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
});
