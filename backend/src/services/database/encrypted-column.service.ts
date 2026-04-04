import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import logger from '@/utils/logger.js';

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

    const result = await this.getPool().query(
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
   */
  async hasAnyEncryptedColumns(): Promise<boolean> {
    const result = await this.getPool().query(
      `SELECT EXISTS (SELECT 1 FROM system.encrypted_columns) AS has_any`
    );
    return result.rows[0]?.has_any === true;
  }

  /**
   * Register a column as encrypted.
   */
  async registerColumn(
    tableName: string,
    columnName: string,
    originalType: string,
    tableSchema = 'public'
  ): Promise<void> {
    await this.getPool().query(
      `INSERT INTO system.encrypted_columns (table_schema, table_name, column_name, original_type, key_version)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (table_schema, table_name, column_name) DO UPDATE
       SET original_type = EXCLUDED.original_type, key_version = EXCLUDED.key_version, updated_at = now()`,
      [tableSchema, tableName, columnName, originalType, EncryptionManager.getCurrentKeyVersion()]
    );
    this.clearCache(tableName, tableSchema);
  }

  /**
   * Unregister a column (e.g., when dropping it or the table).
   */
  async unregisterColumn(
    tableName: string,
    columnName: string,
    tableSchema = 'public'
  ): Promise<void> {
    await this.getPool().query(
      `DELETE FROM system.encrypted_columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
      [tableSchema, tableName, columnName]
    );
    this.clearCache(tableName, tableSchema);
  }

  /**
   * Unregister all columns for a table (e.g., when dropping the table).
   */
  async unregisterTable(tableName: string, tableSchema = 'public'): Promise<void> {
    await this.getPool().query(
      `DELETE FROM system.encrypted_columns
       WHERE table_schema = $1 AND table_name = $2`,
      [tableSchema, tableName]
    );
    this.clearCache(tableName, tableSchema);
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
        const value = typeof row[colName] === 'string'
          ? row[colName] as string
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
          // If the original type was json/jsonb, parse it back
          if (entry.originalType === 'jsonb' || entry.originalType === 'json') {
            try {
              row[colName] = JSON.parse(decrypted);
            } catch {
              row[colName] = decrypted;
            }
          } else {
            row[colName] = decrypted;
          }
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
    const qualifiedTable = tableSchema === 'public'
      ? `"${tableName}"`
      : `"${tableSchema}"."${tableName}"`;

    let totalMigrated = 0;

    try {
      await client.query('BEGIN');

      // Alter column type to TEXT if it isn't already
      if (originalType !== 'text') {
        await client.query(
          `ALTER TABLE ${qualifiedTable} ALTER COLUMN "${columnName}" TYPE TEXT USING "${columnName}"::TEXT`
        );
      }

      // Process in batches using ctid for cursor-free pagination
      let hasMore = true;
      let lastCtid = '(0,0)';

      while (hasMore) {
        const batch = await client.query(
          `SELECT ctid, "${columnName}" FROM ${qualifiedTable}
           WHERE ctid > $1::tid AND "${columnName}" IS NOT NULL
           ORDER BY ctid LIMIT $2`,
          [lastCtid, batchSize]
        );

        if (batch.rows.length === 0) {
          hasMore = false;
          break;
        }

        for (const row of batch.rows) {
          const plaintext = typeof row[columnName] === 'string'
            ? row[columnName]
            : JSON.stringify(row[columnName]);

          // Skip if already encrypted (idempotent)
          if (/^v\d+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/.test(plaintext)) {
            continue;
          }

          const encrypted = EncryptionManager.encryptVersioned(plaintext);
          await client.query(
            `UPDATE ${qualifiedTable} SET "${columnName}" = $1 WHERE ctid = $2::tid`,
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
    const qualifiedTable = tableSchema === 'public'
      ? `"${tableName}"`
      : `"${tableSchema}"."${tableName}"`;

    let totalReEncrypted = 0;

    try {
      await client.query('BEGIN');

      let hasMore = true;
      let lastCtid = '(0,0)';

      while (hasMore) {
        const batch = await client.query(
          `SELECT ctid, "${columnName}" FROM ${qualifiedTable}
           WHERE ctid > $1::tid AND "${columnName}" IS NOT NULL
           ORDER BY ctid LIMIT $2`,
          [lastCtid, batchSize]
        );

        if (batch.rows.length === 0) {
          hasMore = false;
          break;
        }

        for (const row of batch.rows) {
          const ciphertext = row[columnName] as string;
          if (!ciphertext) continue;

          const decrypted = EncryptionManager.decrypt(ciphertext);
          const reEncrypted = EncryptionManager.encryptVersioned(decrypted);

          await client.query(
            `UPDATE ${qualifiedTable} SET "${columnName}" = $1 WHERE ctid = $2::tid`,
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

  clearCache(tableName?: string, tableSchema = 'public'): void {
    if (tableName) {
      this.cache.delete(`${tableSchema}.${tableName}`);
    } else {
      this.cache.clear();
    }
  }
}
