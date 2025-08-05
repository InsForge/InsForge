import { Pool } from 'pg';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { DatabaseMetadata, ColumnInfo, PrimaryKeyInfo } from '@/types/database.js';
import { BETTER_AUTH_SYSTEM_TABLES } from '@insforge/shared-schemas';
import {
  AuthRecord,
  IdentifiesRecord,
  SuperUserAuthRecord,
  SuperUserProfileRecord,
} from '@/types/auth.js';
import { ProfileRecord } from '@/types/profile.js';
import logger from '@/utils/logger.js';
import { convertSqlTypeToColumnType } from '@/utils/helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to quote identifiers for SQL
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

// Type aliases for backward compatibility
export type Auth = AuthRecord;
export type Profile = ProfileRecord;
export type Identifies = IdentifiesRecord;
export type SuperUserAuth = SuperUserAuthRecord;
export type SuperUserProfile = SuperUserProfileRecord;

export class DatabaseManager {
  private static instance: DatabaseManager;
  private pool!: Pool;
  private dataDir: string;

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

    await this.initializeDb();

    await this.migrateDb();
  }

  private async migrateDb(): Promise<void> {
    const client = await this.pool.connect();
    await client.query('BEGIN');

    // placeholder for future migrations
    await client.query(`
      -- Create function
      create or replace function public.uid()
      returns uuid
      language sql stable
      as $$
        select
        nullif(
          coalesce(
            current_setting('request.jwt.claim.sub', true),
            (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
          ),
          ''
        )::uuid
      $$;

      create or replace function public.role()
      returns text
      language sql stable
      as $$
        select
        coalesce(
          current_setting('request.jwt.claim.role', true),
          (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
        )::text
      $$;

      create or replace function public.email()
      returns text
      language sql stable
      as $$
        select
        coalesce(
          current_setting('request.jwt.claim.email', true),
          (current_setting('request.jwt.claims', true)::jsonb ->> 'email')
        )::text
      $$;
    `);

    // Migrate OAuth configuration from environment variables to database
    await this.migrateOAuthConfig(client);

    await client.query('COMMIT');
  }

  // Migrate OAuth configuration from environment variables to database
  private async migrateOAuthConfig(client: import('pg').PoolClient): Promise<void> {
    // Google OAuth configuration
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (googleClientId && googleClientSecret) {
      const googleConfigKey = 'auth.oauth.provider.google';
      const googleConfigValue = JSON.stringify({
        enabled: true,
        clientId: googleClientId,
        clientSecret: googleClientSecret,
      });

      // Check if config already exists
      const existingGoogleConfig = await client.query(
        'SELECT key, value FROM _config WHERE key = $1',
        [googleConfigKey]
      );

      if (existingGoogleConfig.rows.length === 0) {
        // Insert new config if it doesn't exist
        await client.query(
          `
          INSERT INTO _config (key, value, created_at, updated_at)
          VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
          [googleConfigKey, googleConfigValue]
        );
      } else {
        // Check if existing config is empty/disabled and environment variables have values
        try {
          const existingValue = JSON.parse(existingGoogleConfig.rows[0].value);
          if (!existingValue.clientId || !existingValue.clientSecret || !existingValue.enabled) {
            // Update with environment variables if existing config is incomplete
            await client.query(
              `
              UPDATE _config SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2
            `,
              [googleConfigValue, googleConfigKey]
            );
          }
        } catch (e) {
          logger.error('Failed to parse existing Google OAuth config', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    // GitHub OAuth configuration
    const githubClientId = process.env.GITHUB_CLIENT_ID;
    const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (githubClientId && githubClientSecret) {
      const githubConfigKey = 'auth.oauth.provider.github';
      const githubConfigValue = JSON.stringify({
        enabled: true,
        clientId: githubClientId,
        clientSecret: githubClientSecret,
      });

      // Check if config already exists
      const existingGithubConfig = await client.query(
        'SELECT key, value FROM _config WHERE key = $1',
        [githubConfigKey]
      );

      if (existingGithubConfig.rows.length === 0) {
        // Insert new config if it doesn't exist
        await client.query(
          `
          INSERT INTO _config (key, value, created_at, updated_at)
          VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
          [githubConfigKey, githubConfigValue]
        );
      } else {
        // Check if existing config is empty/disabled and environment variables have values
        try {
          const existingValue = JSON.parse(existingGithubConfig.rows[0].value);
          if (!existingValue.clientId || !existingValue.clientSecret || !existingValue.enabled) {
            // Update with environment variables if existing config is incomplete
            await client.query(
              `
              UPDATE _config SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2
            `,
              [githubConfigValue, githubConfigKey]
            );
          }
        } catch (e) {
          logger.error('Failed to parse existing GitHub OAuth config', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  private async initializeDb(): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Drop old tables if they exist (clean slate for new schema)
      await client.query(`
        DROP TABLE IF EXISTS users CASCADE;
        DROP TABLE IF EXISTS _superuser CASCADE;
      `);

      // Create all necessary tables
      await client.query(`
      -- System configuration
      CREATE TABLE IF NOT EXISTS _config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Auth table (authentication only - simplified)
      CREATE TABLE IF NOT EXISTS _auth (
        id UUID PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Profiles table (user profile data)
      CREATE TABLE IF NOT EXISTS _profiles (
        id TEXT PRIMARY KEY,
        auth_id UUID UNIQUE NOT NULL REFERENCES _auth(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        avatar_url TEXT,
        bio TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Superuser auth table (admin authentication)
      CREATE TABLE IF NOT EXISTS _superuser_auth (
        id UUID PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Superuser profiles table (admin profiles)
      CREATE TABLE IF NOT EXISTS _superuser_profiles (
        id TEXT PRIMARY KEY,
        auth_id UUID UNIQUE NOT NULL REFERENCES _superuser_auth(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- App metadata
      CREATE TABLE IF NOT EXISTS _metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Logs table for activity tracking
      CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        table_name TEXT NOT NULL,
        record_id TEXT,
        details TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );

      -- Storage table with bucket-based approach
      -- Storage buckets table to track bucket-level settings
      CREATE TABLE IF NOT EXISTS _storage_buckets (
        name TEXT PRIMARY KEY,
        public BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS _storage (
        bucket TEXT NOT NULL,
        key TEXT NOT NULL,
        size INTEGER NOT NULL,
        mime_type TEXT,
        uploaded_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (bucket, key),
        FOREIGN KEY (bucket) REFERENCES _storage_buckets(name) ON DELETE CASCADE
      );

      -- Identifies table for third-party authentication
      CREATE TABLE IF NOT EXISTS _identifies (
        auth_id UUID NOT NULL REFERENCES _auth(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        identity_data JSONB DEFAULT '{}',
        email TEXT NULL,
        last_login_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (auth_id, provider, provider_id)
      );

      -- Edge functions
      CREATE TABLE IF NOT EXISTS _edge_functions (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        slug VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        code TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'draft',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        deployed_at TIMESTAMPTZ
      );

      -- Better Auth Tables (with quoted names as Better Auth expects)
      -- User table
      CREATE TABLE IF NOT EXISTS "user" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "email" TEXT UNIQUE NOT NULL,
        "emailVerified" BOOLEAN DEFAULT false,
        "name" TEXT,
        "image" TEXT,
        "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ DEFAULT NOW()
      );

      -- Session table
      CREATE TABLE IF NOT EXISTS "session" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "token" TEXT UNIQUE NOT NULL,
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ DEFAULT NOW()
      );

      -- Account table (for OAuth and credentials)
      CREATE TABLE IF NOT EXISTS "account" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "accountId" TEXT NOT NULL,
        "providerId" TEXT NOT NULL,
        "accessToken" TEXT,
        "refreshToken" TEXT,
        "idToken" TEXT,
        "accessTokenExpiresAt" TIMESTAMPTZ,
        "refreshTokenExpiresAt" TIMESTAMPTZ,
        "scope" TEXT,
        "password" TEXT,
        "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE("providerId", "accountId")
      );

      -- Verification table
      CREATE TABLE IF NOT EXISTS "verification" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "identifier" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ DEFAULT NOW()
      );

      -- JWT plugin tables
      CREATE TABLE IF NOT EXISTS "jwks" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "publicKey" TEXT NOT NULL,
        "privateKey" TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      );

    `);

      // Create update timestamp function
      await client.query(`
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ language 'plpgsql';
      `);

      // Create triggers for updated_at
      const tables = [
        '_config',
        '_auth',
        '_profiles',
        '_superuser_auth',
        '_superuser_profiles',
        '_metadata',
        '_identifies',
        '_edge_functions',
      ];
      for (const table of tables) {
        await client.query(`
          DROP TRIGGER IF EXISTS update_${table}_updated_at ON ${table};
          CREATE TRIGGER update_${table}_updated_at BEFORE UPDATE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        `);
      }

      // Create indexes for better performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_auth_email ON _auth(email);
        CREATE INDEX IF NOT EXISTS idx_profiles_auth_id ON _profiles(auth_id);
        CREATE INDEX IF NOT EXISTS idx_superuser_auth_email ON _superuser_auth(email);
        CREATE INDEX IF NOT EXISTS idx_superuser_profiles_auth_id ON _superuser_profiles(auth_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_identify_provider_id ON _identifies(provider, provider_id);
        CREATE INDEX IF NOT EXISTS idx_edge_functions_slug ON _edge_functions(slug);
        CREATE INDEX IF NOT EXISTS idx_edge_functions_status ON _edge_functions(status);
        
        -- Better Auth indexes
        CREATE INDEX IF NOT EXISTS idx_user_email ON "user"("email");
        CREATE INDEX IF NOT EXISTS idx_session_userId ON "session"("userId");
        CREATE INDEX IF NOT EXISTS idx_session_token ON "session"("token");
        CREATE INDEX IF NOT EXISTS idx_account_userId ON "account"("userId");
        CREATE INDEX IF NOT EXISTS idx_verification_identifier ON "verification"("identifier");
      `);

      // Insert initial metadata
      await client.query(`
        INSERT INTO _metadata (key, value) VALUES ('version', '1.0.0')
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
      `);

      await client.query(`
        INSERT INTO _metadata (key, value) VALUES ('created_at', NOW()::TEXT)
        ON CONFLICT (key) DO NOTHING;
      `);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // PostgreSQL-specific prepare method that returns a query object similar to better-sqlite3
  prepare(sql: string) {
    return {
      all: async (...params: unknown[]) => {
        const client = await this.pool.connect();
        try {
          // Convert SQLite parameter placeholders (?) to PostgreSQL ($1, $2, etc.)
          let pgSql = sql;
          let paramIndex = 1;
          while (pgSql.includes('?')) {
            pgSql = pgSql.replace('?', `$${paramIndex}`);
            paramIndex++;
          }

          const result = await client.query(pgSql, params);
          return result.rows;
        } finally {
          client.release();
        }
      },

      get: async (...params: unknown[]) => {
        const client = await this.pool.connect();
        try {
          // Convert SQLite parameter placeholders
          let pgSql = sql;
          let paramIndex = 1;
          while (pgSql.includes('?')) {
            pgSql = pgSql.replace('?', `$${paramIndex}`);
            paramIndex++;
          }

          const result = await client.query(pgSql, params);
          return result.rows[0] || null;
        } finally {
          client.release();
        }
      },

      run: async (...params: unknown[]) => {
        const client = await this.pool.connect();
        try {
          // Convert SQLite parameter placeholders
          let pgSql = sql;
          let paramIndex = 1;
          while (pgSql.includes('?')) {
            pgSql = pgSql.replace('?', `$${paramIndex}`);
            paramIndex++;
          }

          const result = await client.query(pgSql, params);
          return {
            changes: result.rowCount || 0,
            lastInsertRowid: null, // PostgreSQL doesn't have this concept
          };
        } finally {
          client.release();
        }
      },

      exec: async () => {
        const client = await this.pool.connect();
        try {
          await client.query(sql);
        } finally {
          client.release();
        }
      },
    };
  }

  getDb() {
    return {
      prepare: (sql: string) => this.prepare(sql),
      exec: async (sql: string) => {
        const client = await this.pool.connect();
        try {
          await client.query(sql);
        } finally {
          client.release();
        }
      },
    };
  }

  // For backward compatibility with existing code
  getSystemDb() {
    return this.getDb();
  }

  getAppDb() {
    return this.getDb();
  }

  async getDatabaseMetadata(): Promise<DatabaseMetadata> {
    const client = await this.pool.connect();

    try {
      // Get all user tables (excluding system tables except _auth)
      // Also exclude Better Auth system tables
      const tablesResult = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND (table_name NOT LIKE '\\_%' OR table_name = '_auth')
        AND table_name NOT IN (${BETTER_AUTH_SYSTEM_TABLES.map((t) => `'${t}'`).join(', ')})
      `);

      const metadata: DatabaseMetadata = {
        tables: {},
      };

      for (const table of tablesResult.rows) {
        // Get column information
        const columnsResult = await client.query(
          `
          SELECT 
            column_name,
            data_type,
            is_nullable,
            column_default,
            character_maximum_length
          FROM information_schema.columns
          WHERE table_schema = 'public' 
          AND table_name = $1
          ORDER BY ordinal_position
        `,
          [table.table_name]
        );

        // Get primary key information
        const pkResult = await client.query(
          `
          SELECT column_name
          FROM information_schema.key_column_usage
          WHERE table_schema = 'public'
          AND table_name = $1
          AND constraint_name = (
            SELECT constraint_name
            FROM information_schema.table_constraints
            WHERE table_schema = 'public'
            AND table_name = $1
            AND constraint_type = 'PRIMARY KEY'
          )
        `,
          [table.table_name]
        );

        const primaryKeys = pkResult.rows.map((row: PrimaryKeyInfo) => row.column_name);

        // Get row count
        const countResult = await client.query(
          `SELECT COUNT(*) as count FROM "${quoteIdentifier(table.table_name)}"`
        );

        metadata.tables[table.table_name] = {
          //TO FIX: how to get is_unique here?
          columns: columnsResult.rows.map((col: ColumnInfo) => ({
            name: col.column_name,
            type: convertSqlTypeToColumnType(col.data_type.toLowerCase()),
            nullable: col.is_nullable === 'YES',
            primary_key: primaryKeys.includes(col.column_name),
            default_value: col.column_default || undefined,
          })),
          record_count: parseInt(countResult.rows[0].count),
        };
      }

      return metadata;
    } finally {
      client.release();
    }
  }

  static async getColumnTypeMap(tableName: string): Promise<Record<string, string>> {
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
      return map;
    } finally {
      client.release();
    }
  }

  // Log database operations
  async logActivity(
    action: string,
    tableName: string,
    recordId?: string | number,
    details?: unknown
  ): Promise<void> {
    try {
      // Don't log operations for the logs table itself to prevent recursion
      if (tableName === 'logs') {
        return;
      }

      await this.prepare(
        `
        INSERT INTO logs (action, table_name, record_id, details)
        VALUES (?, ?, ?, ?)
      `
      ).run(
        action,
        tableName,
        recordId?.toString() || null,
        details ? JSON.stringify(details) : null
      );
    } catch (error) {
      logger.error('Failed to log activity', {
        error: error instanceof Error ? error.message : String(error),
        action,
        tableName,
        recordId,
      });
    }
  }

  // Store the API key in the config table
  async setApiKey(apiKey: string): Promise<void> {
    await this.prepare(
      'INSERT INTO _config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value'
    ).run('api_key', apiKey);
  }

  // Get the API key from the config table
  async getApiKey(): Promise<string | null> {
    const result = (await this.prepare('SELECT value FROM _config WHERE key = ?').get(
      'api_key'
    )) as { value: string } | null;

    return result?.value || null;
  }

  async getUserTableCount(): Promise<number> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*) as count 
         FROM information_schema.tables 
         WHERE table_schema = 'public' 
         AND table_type = 'BASE TABLE'
         AND table_name NOT LIKE '\\_%'`
      );
      return parseInt(result.rows[0]?.count || '0', 10);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
