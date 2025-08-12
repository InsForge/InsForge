import { Pool } from 'pg';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { DatabaseMetadata, ColumnInfo, PrimaryKeyInfo } from '@/types/database.js';
import logger from '@/utils/logger.js';
import { convertSqlTypeToColumnType } from '@/utils/helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to quote identifiers for SQL
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

// Using Better Auth for authentication

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

  // Initialize OAuth configuration from environment variables to database
  private async migrateOAuthConfig(client: import('pg').PoolClient): Promise<void> {
    // Google OAuth configuration
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:7130/api/auth/oauth/google/callback';

    if (googleClientId && googleClientSecret) {
      const googleConfig = {
        enabled: true,
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        redirectUri: googleRedirectUri // THIS WAS MISSING - CRITICAL!
      };

      // Check if config already exists
      const existing = await client.query(
        'SELECT value FROM _config WHERE key = $1',
        ['auth.oauth.provider.google']
      );

      if (existing.rows.length === 0) {
        // Insert new config if it doesn't exist
        await client.query(
          `INSERT INTO _config (key, value, created_at, updated_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          ['auth.oauth.provider.google', JSON.stringify(googleConfig)]
        );
      } else {
        // Update if existing config is incomplete
        try {
          const existingValue = JSON.parse(existing.rows[0].value);
          if (!existingValue.clientId || !existingValue.clientSecret || !existingValue.redirectUri) {
            await client.query(
              `UPDATE _config SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2`,
              [JSON.stringify(googleConfig), 'auth.oauth.provider.google']
            );
          }
        } catch (e) {
          logger.error('Failed to parse existing Google OAuth config:', e);
        }
      }
    }

    // GitHub OAuth configuration
    const githubClientId = process.env.GITHUB_CLIENT_ID;
    const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
    const githubRedirectUri = process.env.GITHUB_REDIRECT_URI || 'http://localhost:7130/api/auth/oauth/github/callback';

    if (githubClientId && githubClientSecret) {
      const githubConfig = {
        enabled: true,
        clientId: githubClientId,
        clientSecret: githubClientSecret,
        redirectUri: githubRedirectUri // THIS WAS MISSING - CRITICAL!
      };

      // Check if config already exists
      const existing = await client.query(
        'SELECT value FROM _config WHERE key = $1',
        ['auth.oauth.provider.github']
      );

      if (existing.rows.length === 0) {
        // Insert new config if it doesn't exist
        await client.query(
          `INSERT INTO _config (key, value, created_at, updated_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          ['auth.oauth.provider.github', JSON.stringify(githubConfig)]
        );
      } else {
        // Update if existing config is incomplete
        try {
          const existingValue = JSON.parse(existing.rows[0].value);
          if (!existingValue.clientId || !existingValue.clientSecret || !existingValue.redirectUri) {
            await client.query(
              `UPDATE _config SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2`,
              [JSON.stringify(githubConfig), 'auth.oauth.provider.github']
            );
          }
        } catch (e) {
          logger.error('Failed to parse existing GitHub OAuth config:', e);
        }
      }
    }

    logger.info('OAuth configuration initialized in database');
  }

  private async initializeDb(): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Drop old auth tables if they exist - using Better Auth now
      await client.query(`
        DROP TABLE IF EXISTS users CASCADE;
        DROP TABLE IF EXISTS _superuser CASCADE;
        DROP TABLE IF EXISTS _identifies CASCADE;
        DROP TABLE IF EXISTS _profiles CASCADE;
        DROP TABLE IF EXISTS _auth CASCADE;
        DROP TABLE IF EXISTS _superuser_profiles CASCADE;
        DROP TABLE IF EXISTS _superuser_auth CASCADE;
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

      -- Using Better Auth tables for authentication

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

      -- Auth Tables (2-table structure)
      -- User table
      CREATE TABLE IF NOT EXISTS _user (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        password TEXT, -- NULL for OAuth-only users
        name TEXT,
        email_verified BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Account table (for OAuth connections)
      -- Links OAuth provider accounts to local users
      CREATE TABLE IF NOT EXISTS _account (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
        provider TEXT NOT NULL, -- OAuth provider name: 'google', 'github', etc.
        provider_account_id TEXT NOT NULL, -- User's unique ID on the provider's system (e.g., Google's sub, GitHub's id)
        access_token TEXT, -- OAuth access token for making API calls to provider
        refresh_token TEXT, -- OAuth refresh token for renewing access
        provider_data JSONB, -- OAuth provider's user profile (Google: sub/email/name/picture, GitHub: id/login/email/avatar_url)
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(provider, provider_account_id) -- Ensures one account per provider per user
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
      const tables = ['_config', '_metadata', '_edge_functions'];
      for (const table of tables) {
        await client.query(`
          DROP TRIGGER IF EXISTS update_${table}_updated_at ON ${table};
          CREATE TRIGGER update_${table}_updated_at BEFORE UPDATE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        `);
      }

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
