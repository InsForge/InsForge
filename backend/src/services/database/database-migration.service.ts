import { parseSync } from 'libpg-query';
import type {
  CreateMigrationRequest,
  CreateMigrationResponse,
  DatabaseMigrationsResponse,
  Migration,
} from '@insforge/shared-schemas';
import { AppError } from '@/api/middlewares/error.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { isPgErrorLike } from '@/utils/errors.js';
import {
  analyzeQuery,
  initSqlParser,
  parseSQLStatements,
  type DatabaseResourceUpdate,
} from '@/utils/sql-parser.js';

interface CreateMigrationResult {
  migration: CreateMigrationResponse;
  changes: DatabaseResourceUpdate[];
}

export function assertMigrationDoesNotManageTransactions(statement: string): void {
  const { stmts } = parseSync(statement);
  const statementWrappers = stmts as Array<{ stmt: Record<string, unknown> }>;

  for (const statementWrapper of statementWrappers) {
    const [statementType] = Object.entries(statementWrapper.stmt)[0] as [
      string,
      Record<string, unknown>,
    ];

    if (statementType === 'TransactionStmt') {
      throw new AppError(
        'Custom migrations cannot manage their own transactions.',
        400,
        ERROR_CODES.DATABASE_FORBIDDEN
      );
    }
  }
}

export class DatabaseMigrationService {
  private static instance: DatabaseMigrationService;
  private dbManager = DatabaseManager.getInstance();

  private constructor() {}

  public static getInstance(): DatabaseMigrationService {
    if (!DatabaseMigrationService.instance) {
      DatabaseMigrationService.instance = new DatabaseMigrationService();
    }
    return DatabaseMigrationService.instance;
  }

  async listMigrations(): Promise<DatabaseMigrationsResponse> {
    const result = await this.dbManager.getPool().query(`
      SELECT
        version,
        name,
        statements,
        created_at AS "createdAt"
      FROM system.custom_migrations
      ORDER BY version::numeric DESC
    `);

    return {
      migrations: result.rows as Migration[],
    };
  }

  async createMigration(input: CreateMigrationRequest): Promise<CreateMigrationResult> {
    const statements = parseSQLStatements(input.sql);
    if (statements.length === 0) {
      throw new AppError(
        'Migration SQL must contain at least one statement.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    await initSqlParser();

    for (const statement of statements) {
      assertMigrationDoesNotManageTransactions(statement);
    }

    const client = await this.dbManager.getPool().connect();
    let transactionStarted = false;

    try {
      await client.query('BEGIN');
      transactionStarted = true;
      await client.query("SELECT pg_advisory_xact_lock(hashtext('system.custom_migrations'))");
      await client.query('SET LOCAL search_path TO public');

      const versionResult = await client.query<{
        latestVersion: string | null;
      }>(`
        SELECT version AS "latestVersion"
        FROM system.custom_migrations
        ORDER BY version::numeric DESC
        LIMIT 1
      `);

      const latestVersion = versionResult.rows[0]?.latestVersion ?? null;
      const version = input.version;

      if (latestVersion && BigInt(version) <= BigInt(latestVersion)) {
        throw new AppError(
          'Migration version must be newer than the latest applied migration.',
          409,
          ERROR_CODES.ALREADY_EXISTS
        );
      }

      await client.query(input.sql);

      const insertResult = await client.query<Migration>(
        `
          INSERT INTO system.custom_migrations (version, name, statements)
          VALUES ($1, $2, $3)
          RETURNING
            version,
            name,
            statements,
            created_at AS "createdAt"
        `,
        [version, input.name, statements]
      );

      await client.query(`NOTIFY pgrst, 'reload schema';`);
      await client.query('COMMIT');
      transactionStarted = false;

      DatabaseManager.clearColumnTypeCache();

      return {
        migration: {
          ...insertResult.rows[0],
          message: 'Migration executed successfully',
        },
        changes: analyzeQuery(input.sql),
      };
    } catch (error) {
      if (transactionStarted) {
        await client.query('ROLLBACK');
      }

      if (
        isPgErrorLike(error) &&
        error.code === '23505' &&
        error.constraint === 'custom_migrations_pkey'
      ) {
        throw new AppError('Migration version already exists.', 409, ERROR_CODES.ALREADY_EXISTS);
      }

      throw error;
    } finally {
      client.release();
    }
  }
}
