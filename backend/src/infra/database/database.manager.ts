import { Pool, Client } from 'pg';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { DatabaseMetadataSchema } from '@insforge/shared-schemas';
import pgFormat from 'pg-format';
import { buildQualifiedTableKey, DEFAULT_DATABASE_SCHEMA } from '@/services/database/helpers.js';
import { appConfig } from '@/infra/config/app.config.js';

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

      DatabaseManager.setColumnTypeCache(cacheKey, map);
      return map;
    } finally {
      client.release();
    }
  }

  private static setColumnTypeCache(cacheKey: string, data: Record<string, string>): void {
    if (DatabaseManager.columnTypeCache.size >= DatabaseManager.MAX_CACHE_SIZE) {
      const firstKey = DatabaseManager.columnTypeCache.keys().next().value;
      if (firstKey) {
        DatabaseManager.columnTypeCache.delete(firstKey);
      }
    }
    DatabaseManager.columnTypeCache.set(cacheKey, {
      data,
      expiry: Date.now() + DatabaseManager.COLUMN_TYPE_CACHE_TTL,
    });
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
    const client = await this.pool.connect();
    try {
      // Fetch all tables, database size, and record counts in parallel
      const [allTables, databaseSize, countResults] = await Promise.all([
        this.getUserTables(),
        this.getDatabaseSizeInGB(),
        // Get all counts from system.table_metadata_counters in a single query
        (async () => {
          let tableNames: string[] = [];
          try {
            const tablesResult = await client.query(
              `
              SELECT table_name as name
              FROM information_schema.tables
              WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
              ORDER BY table_name
            `
            );
            tableNames = tablesResult.rows.map((row: { name: string }) => row.name);

            if (tableNames.length === 0) {
              return [];
            }

            const placeholders = tableNames.map((_, i) => `$${i + 2}`).join(', ');
            const result = await client.query(
              `SELECT table_name, row_count as count 
               FROM system.table_metadata_counters 
               WHERE schema_name = $1 AND table_name IN (${placeholders})`,
              ['public', ...tableNames]
            );

            const rowMap = new Map<string, number>();
            for (const row of result.rows) {
              rowMap.set(row.table_name, Number(row.count));
            }

            // Batch the fallback COUNT(*) queries in a single UNION ALL query for all missing tables to prevent sequential round-trip latency
            const missingTables = tableNames.filter((name) => !rowMap.has(name));
            if (missingTables.length > 0) {
              try {
                const unionQuery = missingTables
                  .map((tableName) =>
                    pgFormat(
                      'SELECT %L as table_name, COUNT(*) as count FROM %I.%I',
                      tableName,
                      'public',
                      tableName
                    )
                  )
                  .join(' UNION ALL ');
                const fallbackResults = await client.query(unionQuery);
                for (const row of fallbackResults.rows) {
                  rowMap.set(row.table_name, Number(row.count));
                }
              } catch (fallbackErr) {
                console.warn('Failed fallback batch COUNT(*) for missing tables:', fallbackErr);
              }
            }

            const finalResults: { table_name: string; count: number }[] = [];
            for (const tableName of tableNames) {
              finalResults.push({
                table_name: tableName,
                count: rowMap.get(tableName) ?? 0,
              });
            }
            return finalResults;
          } catch (error) {
            console.warn(
              'Failed to retrieve counts from system.table_metadata_counters, falling back to batch COUNT(*):',
              error
            );
            // Global counter-table query failure fallback: execute standard counts in a single batch query for all tables
            try {
              const unionQuery = tableNames
                .map((tableName) =>
                  pgFormat(
                    'SELECT %L as table_name, COUNT(*) as count FROM %I.%I',
                    tableName,
                    'public',
                    tableName
                  )
                )
                .join(' UNION ALL ');
              const fallbackResults = await client.query(unionQuery);
              return fallbackResults.rows.map(
                (row: { table_name: string; count: string | number }) => ({
                  table_name: row.table_name,
                  count: Number(row.count),
                })
              );
            } catch (fallbackError) {
              console.error('Failed complete fallback batch COUNT(*) as well:', fallbackError);
              return [];
            }
          }
        })(),
      ]);

      // Map the count results to a lookup object
      const countMap = new Map(countResults.map((r) => [r.table_name, Number(r.count)]));

      const tableMetadatas = allTables.map((tableName) => ({
        tableName,
        recordCount: countMap.get(tableName) || 0,
      }));

      return {
        tables: tableMetadatas,
        totalSizeInGB: databaseSize,
        hint: 'To retrieve detailed schema information for a specific table, call the get-table-schema tool with the table name.',
      };
    } finally {
      client.release();
    }
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
