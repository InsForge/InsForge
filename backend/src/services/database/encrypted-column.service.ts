import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import logger from '@/utils/logger.js';

/** Minimal query interface satisfied by both Pool and PoolClient */
interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

interface EncryptedColumnEntry {
  id: string;
  tableSchema: string;
  tableName: string;
  columnName: string;
  originalType: string;
  keyVersion: number;
}

interface CacheEntry {
  columns: Map<string, EncryptedColumnEntry>; // key: columnName
  expiry: number;
}

/**
 * Service for managing column-level encryption metadata.
 * Maintains an in-memory cache of which columns are encrypted,
 * and provides helpers for encrypt/decrypt of row data.
 */
export class EncryptedColumnService {
  private static instance: EncryptedColumnService;
  private pool: Pool | null = null;

  // Cache keyed by "schema.table"
  private cache = new Map<string, CacheEntry>();
  private static readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private constructor() {}

  /** Safely quote a SQL identifier to prevent injection */
  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  static getInstance(): EncryptedColumnService {
    if (!EncryptedColumnService.instance) {
      EncryptedColumnService.instance = new EncryptedColumnService();
    }
    return EncryptedColumnService.instance;
  }

  /**
   * Get all encrypted columns for a given table (cached).
   */
  async getEncryptedColumns(
    tableName: string,
    tableSchema = 'public'
  ): Promise<Map<string, EncryptedColumnEntry>> {
    const cacheKey = `${tableSchema}.${tableName}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return cached.columns;
    }

    const pool = this.getPool();

    // Guard: return empty map if the registry table hasn't been created yet
    const tableCheck = await pool.query(`SELECT to_regclass('system.encrypted_columns') AS rel`);
    if (!tableCheck.rows[0]?.rel) {
      return new Map<string, EncryptedColumnEntry>();
    }

    const result = await pool.query(
      `SELECT id, table_schema, table_name, column_name, original_type, key_version
       FROM system.encrypted_columns
       WHERE table_schema = $1 AND table_name = $2`,
      [tableSchema, tableName]
    );

    const columns = new Map<string, EncryptedColumnEntry>();
    for (const row of result.rows) {
      columns.set(row.column_name, {
        id: row.id,
        tableSchema: row.table_schema,
        tableName: row.table_name,
        columnName: row.column_name,
        originalType: row.original_type,
        keyVersion: row.key_version,
      });
    }

    this.cache.set(cacheKey, {
      columns,
      expiry: Date.now() + EncryptedColumnService.CACHE_TTL,
    });

    return columns;
  }

  /**
   * Check if any encrypted columns exist system-wide.
   * Returns false if the registry table hasn't been created yet (fresh DB).
   */
  async hasAnyEncryptedColumns(): Promise<boolean> {
    const pool = this.getPool();

    // Guard: check if the registry table exists (migration 029 may not have run yet)
    const tableCheck = await pool.query(`SELECT to_regclass('system.encrypted_columns') AS rel`);
    if (!tableCheck.rows[0]?.rel) {
      return false;
    }

    const result = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM system.encrypted_columns) AS has_any`
    );
    return result.rows[0]?.has_any === true;
  }

  /**
   * Register a column as encrypted.
   * @param executor Optional transaction client; when supplied the caller is responsible for committing and clearing cache.
   */
  async registerColumn(
    tableName: string,
    columnName: string,
    originalType: string,
    tableSchema = 'public',
    executor?: Queryable
  ): Promise<void> {
    const target = executor ?? this.getPool();
    await target.query(
      `INSERT INTO system.encrypted_columns (table_schema, table_name, column_name, original_type, key_version)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (table_schema, table_name, column_name) DO UPDATE
       SET original_type = EXCLUDED.original_type, key_version = EXCLUDED.key_version, updated_at = now()`,
      [tableSchema, tableName, columnName, originalType, EncryptionManager.getCurrentKeyVersion()]
    );
    if (!executor) {
      this.clearCache(tableName, tableSchema);
    }
  }

  /**
   * Unregister a column (e.g., when dropping it or the table).
   * @param executor Optional transaction client; when supplied the caller is responsible for committing and clearing cache.
   */
  async unregisterColumn(
    tableName: string,
    columnName: string,
    tableSchema = 'public',
    executor?: Queryable
  ): Promise<void> {
    const target = executor ?? this.getPool();
    await target.query(
      `DELETE FROM system.encrypted_columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
      [tableSchema, tableName, columnName]
    );
    if (!executor) {
      this.clearCache(tableName, tableSchema);
    }
  }

  /**
   * Unregister all columns for a table (e.g., when dropping the table).
   * @param executor Optional transaction client; when supplied the caller is responsible for committing and clearing cache.
   */
  async unregisterTable(
    tableName: string,
    tableSchema = 'public',
    executor?: Queryable
  ): Promise<void> {
    const target = executor ?? this.getPool();
    await target.query(
      `DELETE FROM system.encrypted_columns
       WHERE table_schema = $1 AND table_name = $2`,
      [tableSchema, tableName]
    );
    if (!executor) {
      this.clearCache(tableName, tableSchema);
    }
  }

  /**
   * Encrypt values in a row object for all encrypted columns.
   * Modifies and returns the same object for efficiency.
   */
  encryptRow(
    row: Record<string, unknown>,
    encryptedColumns: Map<string, EncryptedColumnEntry>
  ): Record<string, unknown> {
    for (const [colName, _entry] of encryptedColumns) {
      if (row[colName] !== undefined && row[colName] !== null) {
        const value =
          typeof row[colName] === 'string'
            ? (row[colName] as string)
            : JSON.stringify(row[colName]);
        row[colName] = EncryptionManager.encryptVersioned(value);
      }
    }
    return row;
  }

  /**
   * Decrypt values in a row object for all encrypted columns.
   * Modifies and returns the same object for efficiency.
   */
  decryptRow(
    row: Record<string, unknown>,
    encryptedColumns: Map<string, EncryptedColumnEntry>
  ): Record<string, unknown> {
    for (const [colName, entry] of encryptedColumns) {
      if (row[colName] !== undefined && row[colName] !== null && typeof row[colName] === 'string') {
        try {
          const decrypted = EncryptionManager.decrypt(row[colName] as string);
          // Convert decrypted string back to the original scalar type
          row[colName] = this.castDecryptedValue(decrypted, entry.originalType);
        } catch (err) {
          logger.warn(`Failed to decrypt column ${colName} in ${entry.tableName}`, {
            error: err instanceof Error ? err.message : String(err),
          });
          // Leave value as-is (ciphertext) rather than crashing the request
        }
      }
    }
    return row;
  }

  /**
   * Encrypt a batch migration: read all rows, encrypt target column, write back.
   * Operates in batches within a transaction. Returns number of rows migrated.
   */
  async migrateColumnToEncrypted(
    tableName: string,
    columnName: string,
    originalType: string,
    tableSchema = 'public',
    batchSize = 1000
  ): Promise<number> {
    const pool = this.getPool();
    const client = await pool.connect();
    const safeTable = this.quoteIdentifier(tableName);
    const safeSchema = this.quoteIdentifier(tableSchema);
    const qualifiedTable = tableSchema === 'public' ? safeTable : `${safeSchema}.${safeTable}`;
    const safeColumn = this.quoteIdentifier(columnName);

    let totalMigrated = 0;

    try {
      await client.query('BEGIN');

      // Lock the table to prevent concurrent plaintext writes during migration
      await client.query(`LOCK TABLE ${qualifiedTable} IN ACCESS EXCLUSIVE MODE`);

      // Alter column type to TEXT if it isn't already
      if (originalType !== 'text') {
        await client.query(
          `ALTER TABLE ${qualifiedTable} ALTER COLUMN ${safeColumn} TYPE TEXT USING ${safeColumn}::TEXT`
        );
      }

      // Skip predicate: exclude both versioned (v1:iv:tag:data) and legacy (iv:tag:data) ciphertext.
      // EncryptionManager uses 16-byte IV (32 hex chars) and 16-byte auth tag (32 hex chars).
      const CIPHERTEXT_SKIP_RE = '^(v[0-9]+:)?[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$';

      // Process in batches, skipping already-encrypted rows
      let hasMore = true;
      let lastCtid = '(0,0)';

      while (hasMore) {
        const batch = await client.query(
          `SELECT ctid, ${safeColumn} FROM ${qualifiedTable}
           WHERE ctid > $1::tid AND ${safeColumn} IS NOT NULL
             AND ${safeColumn} !~ '${CIPHERTEXT_SKIP_RE}'
           ORDER BY ctid LIMIT $2`,
          [lastCtid, batchSize]
        );

        if (batch.rows.length === 0) {
          hasMore = false;
          break;
        }

        for (const row of batch.rows) {
          const plaintext =
            typeof row[columnName] === 'string' ? row[columnName] : JSON.stringify(row[columnName]);

          const encrypted = EncryptionManager.encryptVersioned(plaintext);
          await client.query(
            `UPDATE ${qualifiedTable} SET ${safeColumn} = $1 WHERE ctid = $2::tid`,
            [encrypted, row.ctid]
          );
          totalMigrated++;
        }

        lastCtid = batch.rows[batch.rows.length - 1].ctid;

        if (batch.rows.length < batchSize) {
          hasMore = false;
        }
      }

      // Register the column in the registry
      await client.query(
        `INSERT INTO system.encrypted_columns (table_schema, table_name, column_name, original_type, key_version)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (table_schema, table_name, column_name) DO UPDATE
         SET original_type = EXCLUDED.original_type, key_version = EXCLUDED.key_version, updated_at = now()`,
        [tableSchema, tableName, columnName, originalType, EncryptionManager.getCurrentKeyVersion()]
      );

      await client.query('COMMIT');
      this.clearCache(tableName, tableSchema);

      return totalMigrated;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Re-encrypt all rows for a given column (for key rotation).
   * Decrypts with current key, then re-encrypts. Assumes the key
   * has already been rotated in the environment.
   */
  async reEncryptColumn(
    tableName: string,
    columnName: string,
    tableSchema = 'public',
    batchSize = 1000
  ): Promise<number> {
    const pool = this.getPool();
    const client = await pool.connect();
    const safeTable = this.quoteIdentifier(tableName);
    const safeSchema = this.quoteIdentifier(tableSchema);
    const qualifiedTable = tableSchema === 'public' ? safeTable : `${safeSchema}.${safeTable}`;
    const safeColumn = this.quoteIdentifier(columnName);
    const currentPrefix = `v${EncryptionManager.getCurrentKeyVersion()}:`;

    let totalReEncrypted = 0;

    try {
      await client.query('BEGIN');

      let hasMore = true;
      let lastCtid = '(0,0)';

      while (hasMore) {
        // Skip rows already encrypted with the current key version
        const batch = await client.query(
          `SELECT ctid, ${safeColumn} FROM ${qualifiedTable}
           WHERE ctid > $1::tid AND ${safeColumn} IS NOT NULL
             AND ${safeColumn} NOT LIKE $3
           ORDER BY ctid LIMIT $2`,
          [lastCtid, batchSize, `${currentPrefix}%`]
        );

        if (batch.rows.length === 0) {
          hasMore = false;
          break;
        }

        for (const row of batch.rows) {
          const ciphertext = row[columnName] as string;
          if (!ciphertext) {
            continue;
          }

          const decrypted = EncryptionManager.decrypt(ciphertext);
          const reEncrypted = EncryptionManager.encryptVersioned(decrypted);

          await client.query(
            `UPDATE ${qualifiedTable} SET ${safeColumn} = $1 WHERE ctid = $2::tid`,
            [reEncrypted, row.ctid]
          );
          totalReEncrypted++;
        }

        lastCtid = batch.rows[batch.rows.length - 1].ctid;
        if (batch.rows.length < batchSize) {
          hasMore = false;
        }
      }

      // Update key version in registry
      await client.query(
        `UPDATE system.encrypted_columns
         SET key_version = $1, updated_at = now()
         WHERE table_schema = $2 AND table_name = $3 AND column_name = $4`,
        [EncryptionManager.getCurrentKeyVersion(), tableSchema, tableName, columnName]
      );

      await client.query('COMMIT');
      this.clearCache(tableName, tableSchema);

      return totalReEncrypted;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Convert a decrypted string back to the original column type.
   */
  private castDecryptedValue(decrypted: string, originalType: string): unknown {
    switch (originalType) {
      case 'json':
      case 'jsonb':
        try {
          return JSON.parse(decrypted);
        } catch {
          return decrypted;
        }
      case 'boolean':
      case 'bool':
        return decrypted === 'true';
      case 'bigint':
      case 'int8':
        // Return as string to preserve precision beyond Number.MAX_SAFE_INTEGER
        return decrypted;
      case 'integer':
      case 'int':
      case 'int4':
      case 'smallint':
      case 'int2': {
        const parsed = parseInt(decrypted, 10);
        return isNaN(parsed) ? decrypted : parsed;
      }
      case 'float':
      case 'float4':
      case 'float8':
      case 'double precision':
      case 'real':
      case 'numeric':
      case 'decimal': {
        const parsed = parseFloat(decrypted);
        return isNaN(parsed) ? decrypted : parsed;
      }
      default:
        return decrypted;
    }
  }

  clearCache(tableName?: string, tableSchema = 'public'): void {
    if (tableName) {
      this.cache.delete(`${tableSchema}.${tableName}`);
    } else {
      this.cache.clear();
    }
  }
}
