import { DatabaseManager } from '@/core/database/database.js';
import {
  ColumnSchema,
  TableSchema,
  DatabaseSchema,
  OnDeleteActionSchema,
  OnUpdateActionSchema,
} from '@insforge/shared-schemas';
import { StorageConfig } from '@/types/storage.js';
import { AuthConfig } from '@/types/auth.js';
import { AppMetadata } from '@/types/metadata.js';
import logger from '@/utils/logger.js';
import { BETTER_AUTH_SYSTEM_TABLES } from '@/utils/constants.js';
import { convertSqlTypeToColumnType } from '@/utils/helpers';

export class MetadataService {
  private static instance: MetadataService;
  private db: ReturnType<DatabaseManager['getDb']>;

  private constructor() {
    this.db = DatabaseManager.getInstance().getDb();
  }

  static getInstance(): MetadataService {
    if (!MetadataService.instance) {
      MetadataService.instance = new MetadataService();
    }
    return MetadataService.instance;
  }

  // Define metadata key types
  private async getMetadata(key: 'database'): Promise<DatabaseSchema | null>;
  private async getMetadata(key: 'auth'): Promise<AuthConfig | null>;
  private async getMetadata(key: 'storage'): Promise<StorageConfig | null>;
  private async getMetadata(
    key: string
  ): Promise<DatabaseSchema | AuthConfig | StorageConfig | string | null>;
  private async getMetadata(
    key: string
  ): Promise<DatabaseSchema | AuthConfig | StorageConfig | string | null> {
    const result = (await this.db
      .prepare('SELECT value FROM _metadata WHERE key = ?')
      .get(key)) as { value: string } | null;
    if (result && result.value) {
      try {
        return JSON.parse(result.value);
      } catch {
        return result.value;
      }
    }
    return null;
  }

  private async setMetadata(
    key: string,
    value: DatabaseSchema | AuthConfig | StorageConfig | string
  ): Promise<void> {
    const jsonValue = typeof value === 'string' ? value : JSON.stringify(value);
    await this.db
      .prepare(
        `
      INSERT INTO _metadata (key, value) 
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET 
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `
      )
      .run(key, jsonValue);
  }

  async updateDatabaseMetadata(): Promise<void> {
    // Get all tables excluding system tables (those starting with _) and logs
    // Also exclude Better Auth system tables
    const allTables = (await this.db
      .prepare(
        `
      SELECT table_name as name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      AND table_name NOT LIKE '\\_%'
      AND table_name != 'logs'
      AND table_name NOT IN (${BETTER_AUTH_SYSTEM_TABLES.filter((t) => t !== 'user')
        .map((t) => `'${t}'`)
        .join(', ')})
      ORDER BY table_name
    `
      )
      .all()) as { name: string }[];

    const tableMetadata: TableSchema[] = [];

    for (const table of allTables) {
      // Get comprehensive column information with constraints in a single query
      const columns = (await this.db
        .prepare(
          `
        SELECT 
          c.column_name as name,
          c.data_type as type,
          c.is_nullable,
          c.column_default as dflt_value,
          c.ordinal_position,
          CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
          CASE WHEN uk.column_name IS NOT NULL THEN true ELSE false END as is_unique
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT kcu.column_name
          FROM information_schema.key_column_usage kcu
          JOIN information_schema.table_constraints tc 
            ON kcu.constraint_name = tc.constraint_name 
            AND kcu.table_schema = tc.table_schema
          WHERE tc.table_schema = 'public'
            AND tc.table_name = ?
            AND tc.constraint_type = 'PRIMARY KEY'
        ) pk ON c.column_name = pk.column_name
        LEFT JOIN (
          SELECT kcu.column_name
          FROM information_schema.key_column_usage kcu
          JOIN information_schema.table_constraints tc 
            ON kcu.constraint_name = tc.constraint_name 
            AND kcu.table_schema = tc.table_schema
          WHERE tc.table_schema = 'public'
            AND tc.table_name = ?
            AND tc.constraint_type = 'UNIQUE'
        ) uk ON c.column_name = uk.column_name
        WHERE c.table_schema = 'public' 
          AND c.table_name = ?
        ORDER BY c.ordinal_position
      `
        )
        .all(table.name, table.name, table.name)) as {
        name: string;
        type: string;
        is_nullable: string;
        dflt_value: string | null;
        ordinal_position: number;
        is_primary_key: boolean;
        is_unique: boolean;
      }[];

      const columnMetadata: ColumnSchema[] = columns.map((col) => {
        // Map PostgreSQL types to our type system
        const type = convertSqlTypeToColumnType(col.type);

        const column: ColumnSchema = {
          columnName: col.name,
          type: type,
          isNullable: col.is_nullable === 'YES',
          defaultValue: col.dflt_value || undefined,
          isPrimaryKey: col.is_primary_key,
          isUnique: col.is_unique,
        };

        return column;
      });

      // Get foreign key information
      const foreignKeys = (await this.db
        .prepare(
          `
        SELECT
          kcu.column_name as from_column,
          ccu.table_name AS foreign_table,
          ccu.column_name AS foreign_column,
          rc.delete_rule as on_delete,
          rc.update_rule as on_update
        FROM information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        JOIN information_schema.referential_constraints AS rc
          ON rc.constraint_name = tc.constraint_name
          AND rc.constraint_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' 
        AND tc.table_name = ?
        AND tc.table_schema = 'public'
      `
        )
        .all(table.name)) as {
        from_column: string;
        foreign_table: string;
        foreign_column: string;
        on_delete: string;
        on_update: string;
      }[];

      // Map foreign keys to columns
      for (const fk of foreignKeys) {
        const column = columnMetadata.find((col) => col.columnName === fk.from_column);
        if (column) {
          column.foreignKey = {
            referenceTable: fk.foreign_table,
            referenceColumn: fk.foreign_column,
            onDelete: fk.on_delete as OnDeleteActionSchema,
            onUpdate: fk.on_update as OnUpdateActionSchema,
          };
        }
      }

      // Get record count
      let recordCount = 0;
      try {
        // there is a race condition here, if the table is immeditely deleted, so added an extra check to see if the table exists
        const tableExists = (await this.db
          .prepare(
            `
          SELECT EXISTS (
            SELECT 1 FROM pg_class 
            WHERE relname = ? 
            AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
            AND relkind = 'r'
          ) as exists
        `
          )
          .get(table.name)) as { exists: boolean } | null;

        if (tableExists?.exists) {
          const countResult = (await this.db
            .prepare(`SELECT COUNT(*) as count FROM "${table.name}"`)
            .get()) as { count: number } | null;
          recordCount = countResult?.count || 0;
        }
      } catch (error) {
        // Handle any unexpected errors
        logger.warn('Could not get record count for table', {
          table: table.name,
          error: error instanceof Error ? error.message : String(error),
        });
        recordCount = 0;
      }

      tableMetadata.push({
        tableName: table.name,
        columns: columnMetadata,
        recordCount: recordCount,
      });
    }

    const databaseMetadata: DatabaseSchema = {
      tables: tableMetadata,
    };

    await this.setMetadata('database', databaseMetadata);
  }

  async updateAuthMetadata(config?: Partial<AuthConfig>): Promise<void> {
    const currentAuth = (await this.getMetadata('auth')) || {
      enabled: true,
      providers: ['email'],
      magicLink: false,
    };

    const authMetadata: AuthConfig = {
      ...currentAuth,
      ...config,
    } as AuthConfig;

    await this.setMetadata('auth', authMetadata);
  }

  async updateStorageMetadata(): Promise<void> {
    // Get storage buckets from _storage_buckets table
    const storageBuckets = (await this.db
      .prepare('SELECT name, public, created_at FROM _storage_buckets ORDER BY name')
      .all()) as { name: string; public: boolean; created_at: string }[];

    const buckets = storageBuckets.map((b) => ({
      name: b.name,
      public: b.public,
      createdAt: b.created_at,
    }));

    const storageMetadata: StorageConfig = { buckets };

    await this.setMetadata('storage', storageMetadata);
  }

  async getFullMetadata(): Promise<AppMetadata> {
    const database = (await this.getMetadata('database')) || {
      tables: [],
    };
    const auth = (await this.getMetadata('auth')) || {
      enabled: true,
      providers: ['email'],
      magicLink: false,
    };
    const storage = (await this.getMetadata('storage')) || {
      buckets: [],
    };

    // Get version from package.json or default
    const version = process.env.npm_package_version || '1.0.0';

    return {
      database,
      auth,
      storage,
      version,
    };
  }

  async getDatabaseMetadata(): Promise<{
    tables: Record<
      string,
      {
        record_count: number;
        created_at?: string;
        updated_at?: string;
      }
    >;
    database_size_gb?: number;
    storage_size_gb?: number;
  }> {
    const database = (await this.getMetadata('database')) || {
      tables: [],
    };

    // Convert to format expected by frontend dashboard
    const tables: Record<
      string,
      {
        record_count: number;
        created_at?: string;
        updated_at?: string;
      }
    > = {};
    for (const table of database.tables) {
      tables[table.tableName] = {
        record_count:
          typeof table.recordCount === 'number'
            ? table.recordCount
            : parseInt(String(table.recordCount || '0'), 10) || 0,
        created_at: table.createdAt,
        updated_at: table.updatedAt,
      };
    }

    // Get database and storage sizes
    const database_size_gb = await this.getDatabaseSizeInGB();
    const storage_size_gb = await this.getStorageSizeInGB();

    return { tables, database_size_gb, storage_size_gb };
  }

  async getDatabaseSizeInGB(): Promise<number> {
    try {
      // Query PostgreSQL for database size
      const result = (await this.db
        .prepare(
          `
        SELECT pg_database_size(current_database()) as size
      `
        )
        .get()) as { size: number } | null;

      // PostgreSQL returns size in bytes, convert to GB
      return (result?.size || 0) / (1024 * 1024 * 1024);
    } catch (error) {
      logger.error('Error getting database size', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  async getStorageSizeInGB(): Promise<number> {
    try {
      // Query the _storage table to sum all file sizes
      const result = (await this.db
        .prepare(
          `
        SELECT COALESCE(SUM(size), 0) as total_size 
        FROM _storage
      `
        )
        .get()) as { total_size: number } | null;

      // Convert bytes to GB
      return (result?.total_size || 0) / (1024 * 1024 * 1024);
    } catch (error) {
      logger.error('Error getting storage size', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  // Initialize metadata on first run
  async initialize(): Promise<void> {
    // Update all metadata categories
    await this.updateDatabaseMetadata();
    await this.updateAuthMetadata();
    await this.updateStorageMetadata();
  }
}
