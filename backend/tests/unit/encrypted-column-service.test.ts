import { describe, test, expect, vi, beforeEach } from 'vitest';
import { EncryptedColumnService } from '../../src/services/database/encrypted-column.service';
import { EncryptionManager } from '../../src/infra/security/encryption.manager';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock DatabaseManager so getPool() returns our fake pool
const mockQuery = vi.fn();
const mockPool = { query: mockQuery, connect: vi.fn() };

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

// Mock EncryptionManager — keep it deterministic
vi.mock('../../src/infra/security/encryption.manager', () => ({
  EncryptionManager: {
    encrypt: (v: string) =>
      `iv32hex_____________________:tag32hex_____________________:${Buffer.from(v).toString('hex')}`,
    encryptVersioned: (v: string) =>
      `v1:iv32hex_____________________:tag32hex_____________________:${Buffer.from(v).toString('hex')}`,
    decrypt: (v: string) => {
      // Strip version prefix if present
      const stripped = v.replace(/^v\d+:/, '');
      const parts = stripped.split(':');
      return Buffer.from(parts[2], 'hex').toString('utf8');
    },
    getCurrentKeyVersion: () => 1,
    isConfigured: () => true,
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset singleton so each test gets a fresh instance */
function freshService(): EncryptedColumnService {
  // Clear the private singleton for test isolation
  (EncryptedColumnService as unknown as Record<string, unknown>)['instance'] = undefined;
  return EncryptedColumnService.getInstance();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EncryptedColumnService', () => {
  let service: EncryptedColumnService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = freshService();
  });

  // ========================================================================
  // hasAnyEncryptedColumns — fresh-DB guard
  // ========================================================================
  describe('hasAnyEncryptedColumns', () => {
    test('returns false when registry table does not exist', async () => {
      // to_regclass returns null when the table doesn't exist
      mockQuery.mockResolvedValueOnce({ rows: [{ rel: null }] });

      const result = await service.hasAnyEncryptedColumns();

      expect(result).toBe(false);
      // Should only have called the to_regclass check, NOT the SELECT EXISTS
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('to_regclass');
    });

    test('returns false when table exists but is empty', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ rel: 'system.encrypted_columns' }] }) // to_regclass
        .mockResolvedValueOnce({ rows: [{ has_any: false }] }); // SELECT EXISTS

      const result = await service.hasAnyEncryptedColumns();

      expect(result).toBe(false);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    test('returns true when encrypted columns exist', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ rel: 'system.encrypted_columns' }] })
        .mockResolvedValueOnce({ rows: [{ has_any: true }] });

      const result = await service.hasAnyEncryptedColumns();

      expect(result).toBe(true);
    });
  });

  // ========================================================================
  // registerColumn — optional executor
  // ========================================================================
  describe('registerColumn with executor', () => {
    test('uses pool when no executor is provided', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await service.registerColumn('users', 'ssn', 'string');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO system.encrypted_columns');
    });

    test('uses executor when provided', async () => {
      const txQuery = vi.fn().mockResolvedValue({ rows: [] });
      const executor = { query: txQuery };

      await service.registerColumn('users', 'ssn', 'string', 'public', executor);

      // Pool should NOT have been called
      expect(mockQuery).not.toHaveBeenCalled();
      // Executor should have been called
      expect(txQuery).toHaveBeenCalledTimes(1);
      expect(txQuery.mock.calls[0][0]).toContain('INSERT INTO system.encrypted_columns');
    });

    test('does NOT clear cache when executor is provided', async () => {
      const txQuery = vi.fn().mockResolvedValue({ rows: [] });
      const executor = { query: txQuery };

      // Prime the cache (to_regclass + SELECT)
      mockQuery
        .mockResolvedValueOnce({ rows: [{ rel: 'system.encrypted_columns' }] })
        .mockResolvedValueOnce({ rows: [] });
      await service.getEncryptedColumns('users');

      const clearSpy = vi.spyOn(service, 'clearCache');

      await service.registerColumn('users', 'ssn', 'string', 'public', executor);

      expect(clearSpy).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // unregisterColumn — optional executor
  // ========================================================================
  describe('unregisterColumn with executor', () => {
    test('uses executor when provided', async () => {
      const txQuery = vi.fn().mockResolvedValue({ rows: [] });
      const executor = { query: txQuery };

      await service.unregisterColumn('users', 'ssn', 'public', executor);

      expect(mockQuery).not.toHaveBeenCalled();
      expect(txQuery).toHaveBeenCalledTimes(1);
      expect(txQuery.mock.calls[0][0]).toContain('DELETE FROM system.encrypted_columns');
    });
  });

  // ========================================================================
  // unregisterTable — optional executor
  // ========================================================================
  describe('unregisterTable with executor', () => {
    test('uses executor when provided', async () => {
      const txQuery = vi.fn().mockResolvedValue({ rows: [] });
      const executor = { query: txQuery };

      await service.unregisterTable('users', 'public', executor);

      expect(mockQuery).not.toHaveBeenCalled();
      expect(txQuery).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================================================
  // encryptRow / decryptRow
  // ========================================================================
  describe('encryptRow', () => {
    const columns = new Map([
      [
        'ssn',
        {
          id: '1',
          tableSchema: 'public',
          tableName: 'users',
          columnName: 'ssn',
          originalType: 'string',
          keyVersion: 1,
        },
      ],
    ]);

    test('encrypts non-null string values', () => {
      const row = { id: '123', ssn: '123-45-6789', name: 'Alice' };
      const result = service.encryptRow(row, columns);

      expect(result.ssn).toContain('v1:');
      expect(result.ssn).not.toBe('123-45-6789');
      // Other fields untouched
      expect(result.id).toBe('123');
      expect(result.name).toBe('Alice');
    });

    test('skips null and undefined values', () => {
      const row = { id: '123', ssn: null };
      const result = service.encryptRow(row, columns);
      expect(result.ssn).toBeNull();
    });

    test('JSON-stringifies non-string values before encryption', () => {
      const row = { id: '123', ssn: { nested: true } };
      const result = service.encryptRow(row, columns);
      expect(typeof result.ssn).toBe('string');
      expect((result.ssn as string).startsWith('v1:')).toBe(true);
    });
  });

  describe('decryptRow', () => {
    const columns = new Map([
      [
        'ssn',
        {
          id: '1',
          tableSchema: 'public',
          tableName: 'users',
          columnName: 'ssn',
          originalType: 'string',
          keyVersion: 1,
        },
      ],
    ]);

    test('decrypts ciphertext back to plaintext', () => {
      const plaintext = 'hello-world';
      const encrypted = EncryptionManager.encryptVersioned(plaintext);

      const row = { id: '1', ssn: encrypted };
      const result = service.decryptRow(row, columns);

      expect(result.ssn).toBe(plaintext);
    });

    test('leaves non-string values untouched', () => {
      const row = { id: '1', ssn: 42 };
      const result = service.decryptRow(row, columns);
      expect(result.ssn).toBe(42);
    });
  });

  // ========================================================================
  // castDecryptedValue (tested indirectly via decryptRow)
  // ========================================================================
  describe('type casting on decrypt', () => {
    test('casts boolean originalType', () => {
      const columns = new Map([
        [
          'is_active',
          {
            id: '1',
            tableSchema: 'public',
            tableName: 'users',
            columnName: 'is_active',
            originalType: 'boolean',
            keyVersion: 1,
          },
        ],
      ]);

      const encrypted = EncryptionManager.encryptVersioned('true');
      const row = { is_active: encrypted };
      const result = service.decryptRow(row, columns);
      expect(result.is_active).toBe(true);
    });

    test('casts integer originalType', () => {
      const columns = new Map([
        [
          'age',
          {
            id: '1',
            tableSchema: 'public',
            tableName: 'users',
            columnName: 'age',
            originalType: 'integer',
            keyVersion: 1,
          },
        ],
      ]);

      const encrypted = EncryptionManager.encryptVersioned('42');
      const row = { age: encrypted };
      const result = service.decryptRow(row, columns);
      expect(result.age).toBe(42);
    });

    test('casts json originalType', () => {
      const columns = new Map([
        [
          'meta',
          {
            id: '1',
            tableSchema: 'public',
            tableName: 'users',
            columnName: 'meta',
            originalType: 'json',
            keyVersion: 1,
          },
        ],
      ]);

      const encrypted = EncryptionManager.encryptVersioned('{"key":"value"}');
      const row = { meta: encrypted };
      const result = service.decryptRow(row, columns);
      expect(result.meta).toEqual({ key: 'value' });
    });

    test('casts float originalType', () => {
      const columns = new Map([
        [
          'score',
          {
            id: '1',
            tableSchema: 'public',
            tableName: 'users',
            columnName: 'score',
            originalType: 'float',
            keyVersion: 1,
          },
        ],
      ]);

      const encrypted = EncryptionManager.encryptVersioned('3.14');
      const row = { score: encrypted };
      const result = service.decryptRow(row, columns);
      expect(result.score).toBeCloseTo(3.14);
    });
  });

  // ========================================================================
  // Cache behavior
  // ========================================================================
  describe('cache', () => {
    test('second call uses cache and does not query DB again', async () => {
      // First call: to_regclass check, then actual SELECT
      mockQuery
        .mockResolvedValueOnce({ rows: [{ rel: 'system.encrypted_columns' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: '1',
              table_schema: 'public',
              table_name: 'users',
              column_name: 'ssn',
              original_type: 'string',
              key_version: 1,
            },
          ],
        });

      const first = await service.getEncryptedColumns('users');
      const second = await service.getEncryptedColumns('users');

      expect(first).toBe(second); // same reference
      expect(mockQuery).toHaveBeenCalledTimes(2); // to_regclass + SELECT, then cache hit
    });

    test('clearCache forces next call to hit DB', async () => {
      // First call: to_regclass + SELECT
      mockQuery
        .mockResolvedValueOnce({ rows: [{ rel: 'system.encrypted_columns' }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.getEncryptedColumns('users');
      service.clearCache('users');

      // Second call after cache clear: to_regclass + SELECT again
      mockQuery
        .mockResolvedValueOnce({ rows: [{ rel: 'system.encrypted_columns' }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.getEncryptedColumns('users');

      expect(mockQuery).toHaveBeenCalledTimes(4); // 2 calls × 2 queries each
    });
  });
});
