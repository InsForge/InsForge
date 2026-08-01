import { Pool, Client } from 'pg';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { DatabaseMetadataSchema } from '@insforge/shared-schemas';
import pgFormat from 'pg-format';
import { buildQualifiedTableKey, DEFAULT_DATABASE_SCHEMA } from '@/services/database/helpers.js';
import { appConfig } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

export class DatabaseManager {
  private static instance: DatabaseManager;
  private pool!: Pool;
  private dataDir: string;

  private static readonly COLUMN_TYPE_CACHE_TTL = 5 * 60 * 1000;
  private static columnTypeCache = new Map<string, CacheEntry<Record<string, string>>>();
  private static readonly MAX_CACHE_SIZE = 100;
  /**
   * Maximum entries for table row counts.
   * Bounded at 1000 per workspace/process to prevent memory leaks in multi-tenant or multi-schema deployments.
   */
  private static readonly MAX_TABLE_COUNT_CACHE_SIZE = 1000;
  private static readonly TABLE_COUNT_CACHE_TTL = 60 * 1000;
  private static tableCountCache = new Map<string, { count: number; timestamp: number }>();

  private constructor() {
    this.dataDir = appConfig.database.dir;
  }

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });

    this.pool = new Pool({
      host: appConfig.database.host,
      port: appConfig.database.port,
      database: appConfig.database.name,
      user: appConfig.database.user,
      password: appConfig.database.password,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // pg emits 'error' on the pool when an IDLE client's connection drops
    // (e.g. Postgres restart). Without this listener that event is an
    // unhandled 'error' and crashes the process; the pool already discards
    // the broken client and creates a fresh one on next checkout.
    this.pool.on('error', (error) => {
      logger.error('Postgres pool idle client error', { error: error.message });
    });
  }

  static async getColumnTypeMap(
    tableName: string,
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ): Promise<Record<string, string>> {
    const cacheKey = buildQualifiedTableKey(tableName, schemaName);
    const cached = DatabaseManager.columnTypeCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }

    const instance = DatabaseManager.getInstance();
    const client = await instance.pool.connect();
    try {
      const result = await client.query(
        `SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
        [schemaName, tableName]
      );
      const map: Record<string, string> = {};
      for (const row of result.rows) {
        const dataType = row.data_type.toLowerCase();
        map[row.column_name] = dataType === 'user-defined' ? row.udt_name.toLowerCase() : dataType;
      }

      DatabaseManager.setBoundedCache(
        DatabaseManager.columnTypeCache,
        DatabaseManager.MAX_CACHE_SIZE,
        cacheKey,
        { data: map, expiry: Date.now() + DatabaseManager.COLUMN_TYPE_CACHE_TTL }
      );
      return map;
    } finally {
      client.release();
    }
  }

  /**
   * Inserts an entry into a bounded cache with FIFO eviction.
   * When the cache reaches maxSize, the oldest entry (first insertion-order key) is removed
   * before adding the new entry, preventing unbounded memory growth.
   *
   * @param cache - The Map to insert into
   * @param maxSize - Maximum number of entries allowed
   * @param key - Cache key
   * @param entry - Value to cache
   */
  private static setBoundedCache<V>(
    cache: Map<string, V>,
    maxSize: number,
    key: string,
    entry: V
  ): void {
    if (cache.size >= maxSize && !cache.has(key)) {
      const first = cache.keys().next().value;
      if (first !== undefined) {
        cache.delete(first);
      }
    }
    cache.set(key, entry);
  }

  static clearColumnTypeCache(
    tableName?: string,
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ): void {
    if (tableName) {
      DatabaseManager.columnTypeCache.delete(buildQualifiedTableKey(tableName, schemaName));
    } else {
      DatabaseManager.columnTypeCache.clear();
    }
  }

  async getUserTables(): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
          SELECT table_name as name
          FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          ORDER BY table_name
        `
      );
      return result.rows.map((row: { name: string }) => row.name);
    } finally {
      client.release();
    }
  }

  async getMetadata(): Promise<DatabaseMetadataSchema> {
    const [allTables, databaseSize] = await Promise.all([
      this.getUserTables(),
      this.getDatabaseSizeInGB(),
    ]);

    const now = Date.now();
    const requestCounts = new Map<string, number>();
    const missingOrExpired: string[] = [];

    for (const tableName of allTables) {
      const cacheKey = buildQualifiedTableKey(tableName, 'public');
      const cached = DatabaseManager.tableCountCache.get(cacheKey);
      if (cached && now - cached.timestamp < DatabaseManager.TABLE_COUNT_CACHE_TTL) {
        requestCounts.set(cacheKey, cached.count);
      } else {
        missingOrExpired.push(tableName);
      }
    }

    if (missingOrExpired.length > 0) {
      const client = await this.pool.connect();
      try {
        const unionQuery = missingOrExpired
          .map((tableName) =>
            pgFormat(
              'SELECT %L as table_name, COUNT(*) as count FROM %I.%I',
              tableName,
              'public',
              tableName
            )
          )
          .join(' UNION ALL ');

        const queryResult = await client.query(unionQuery);
        const nowAfterQuery = Date.now();

        // 1. Resolve all database counts into the request-local map first
        for (const row of queryResult.rows) {
          const cacheKey = buildQualifiedTableKey(row.table_name, 'public');
          requestCounts.set(cacheKey, Number(row.count));
        }

        // 2. Perform all cache mutations second
        for (const row of queryResult.rows) {
          const cacheKey = buildQualifiedTableKey(row.table_name, 'public');
          const count = requestCounts.get(cacheKey) ?? Number(row.count);
          DatabaseManager.setBoundedCache(
            DatabaseManager.tableCountCache,
            DatabaseManager.MAX_TABLE_COUNT_CACHE_SIZE,
            cacheKey,
            { count, timestamp: nowAfterQuery }
          );
        }
      } catch (error) {
        logger.error('Failed to batch query exact table counts:', { error });
      } finally {
        client.release();
      }
    }

    const tableMetadatas = allTables.map((tableName) => {
      const cacheKey = buildQualifiedTableKey(tableName, 'public');
      return {
        tableName,
        recordCount: requestCounts.get(cacheKey) ?? 0,
      };
    });

    return {
      tables: tableMetadatas,
      totalSizeInGB: databaseSize,
      hint: 'To retrieve detailed schema information for a specific table, call the get-table-schema tool with the table name.',
    };
  }

  async getDatabaseSizeInGB(): Promise<number> {
    const client = await this.pool.connect();
    try {
      // Query PostgreSQL for database size
      const result = await client.query(`SELECT pg_database_size(current_database()) as size`);

      // PostgreSQL returns size in bytes, convert to GB
      return (result.rows[0]?.size || 0) / (1024 * 1024 * 1024);
    } catch {
      return 0;
    } finally {
      client.release();
    }
  }

  getPool(): Pool {
    return this.pool;
  }

  /**
   * Create a dedicated client for operations that can't use pooled connections (e.g., LISTEN/NOTIFY)
   */
  createClient(): Client {
    return new Client({
      host: appConfig.database.host,
      port: appConfig.database.port,
      database: appConfig.database.name,
      user: appConfig.database.user,
      password: appConfig.database.password,
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
