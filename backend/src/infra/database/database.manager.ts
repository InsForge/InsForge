import { Pool, Client } from 'pg';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { DatabaseMetadataSchema } from '@insforge/shared-schemas';
import pgFormat from 'pg-format';

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
    this.dataDir = process.env.DATABASE_DIR || path.join(__dirname, '../../data');
  }

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });

    // PostgreSQL connection configuration
    this.pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'insforge',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  static async getColumnTypeMap(tableName: string): Promise<Record<string, string>> {
    const cached = DatabaseManager.columnTypeCache.get(tableName);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }

    const instance = DatabaseManager.getInstance();
    const client = await instance.pool.connect();
    try {
      const result = await client.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [tableName]
      );
      const map: Record<string, string> = {};
      for (const row of result.rows) {
        map[row.column_name] = row.data_type;
      }

      DatabaseManager.setColumnTypeCache(tableName, map);
      return map;
    } finally {
      client.release();
    }
  }

  private static setColumnTypeCache(tableName: string, data: Record<string, string>): void {
    if (DatabaseManager.columnTypeCache.size >= DatabaseManager.MAX_CACHE_SIZE) {
      const firstKey = DatabaseManager.columnTypeCache.keys().next().value;
      if (firstKey) {
        DatabaseManager.columnTypeCache.delete(firstKey);
      }
    }
    DatabaseManager.columnTypeCache.set(tableName, {
      data,
      expiry: Date.now() + DatabaseManager.COLUMN_TYPE_CACHE_TTL,
    });
  }

  static clearColumnTypeCache(tableName?: string): void {
    if (tableName) {
      DatabaseManager.columnTypeCache.delete(tableName);
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
        // Get all counts in a single query using UNION ALL
        (async () => {
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
            const tableNames = tablesResult.rows.map((row: { name: string }) => row.name);

            if (tableNames.length === 0) {
              return [];
            }

            // Build a UNION ALL query to get all counts in one query
            const unionQuery = tableNames
              .map((tableName) =>
                pgFormat('SELECT %L as table_name, COUNT(*) as count FROM %I', tableName, tableName)
              )
              .join(' UNION ALL ');

            const result = await client.query(unionQuery);
            return result.rows as { table_name: string; count: number }[];
          } catch {
            return [];
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
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'insforge',
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
