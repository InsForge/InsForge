import {
  ERROR_CODES,
  type CreateMigrationRequest,
  type CreateMigrationResponse,
  type DatabaseMigrationsResponse,
  type Migration,
  type DryRunMigrationRequest,
  type DryRunMigrationResponse,
  type MigrationRiskFactor,
  type MigrationRiskLevel,
} from '@insforge/shared-schemas';
import { AppError, isPgErrorLike } from '@/utils/errors.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import {
  analyzeQuery,
  checkSqlExecutionGuards,
  initSqlParser,
  parseSQLStatements,
  type DatabaseResourceUpdate,
} from '@/utils/sql-parser.js';
import { parseSync } from 'libpg-query';
import { withAdminContext } from './user-context.service.js';

interface CreateMigrationResult {
  migration: CreateMigrationResponse;
  changes: DatabaseResourceUpdate[];
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

    const guardError = checkSqlExecutionGuards(input.sql);
    if (guardError) {
      throw new AppError(guardError, 403, ERROR_CODES.FORBIDDEN);
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
          ERROR_CODES.DATABASE_MIGRATION_ALREADY_EXISTS
        );
      }

      await withAdminContext(client, () => client.query(input.sql), true);

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
        await client.query('ROLLBACK').catch(() => {});
      }

      if (
        isPgErrorLike(error) &&
        error.code === '23505' &&
        error.constraint === 'custom_migrations_pkey'
      ) {
        throw new AppError(
          'Migration version already exists.',
          409,
          ERROR_CODES.DATABASE_MIGRATION_ALREADY_EXISTS
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async dryRunMigration(input: DryRunMigrationRequest): Promise<DryRunMigrationResponse> {
    let statements: string[];
    try {
      statements = parseSQLStatements(input.sql);
    } catch (parseError) {
      const errMsg = parseError instanceof Error ? parseError.message : String(parseError);
      return {
        valid: false,
        statementCount: 0,
        statements: [],
        riskLevel: 'DANGER',
        riskFactors: [
          {
            code: 'SYNTAX_OR_EXECUTION_ERROR',
            description: errMsg,
            level: 'DANGER',
          },
        ],
        error: errMsg,
      };
    }

    if (statements.length === 0) {
      return {
        valid: false,
        statementCount: 0,
        statements: [],
        riskLevel: 'DANGER',
        riskFactors: [
          {
            code: 'EMPTY_SQL',
            description: 'Migration SQL must contain at least one statement.',
            level: 'DANGER',
          },
        ],
        error: 'Migration SQL must contain at least one statement.',
      };
    }

    await initSqlParser();

    const guardError = checkSqlExecutionGuards(input.sql);
    if (guardError) {
      return {
        valid: false,
        statementCount: statements.length,
        statements,
        riskLevel: 'DANGER',
        riskFactors: [
          {
            code: 'GUARD_VIOLATION',
            description: guardError,
            level: 'DANGER',
          },
        ],
        error: guardError,
      };
    }

    const riskFactors: MigrationRiskFactor[] = [];
    let riskLevel: MigrationRiskLevel = 'SAFE';

    try {
      const { stmts } = parseSync(input.sql);
      for (let i = 0; i < stmts.length; i++) {
        const stmtWrapper = stmts[i];
        const statementText = statements[i] || input.sql;
        const stmt = stmtWrapper.stmt as Record<string, unknown>;
        const [stmtType, data] = Object.entries(stmt)[0] as [string, Record<string, unknown>];

        if (stmtType === 'DropStmt') {
          const removeType = String(data.removeType || '');
          if (
            removeType === 'OBJECT_TABLE' ||
            removeType === 'OBJECT_DATABASE' ||
            removeType === 'OBJECT_SCHEMA'
          ) {
            riskFactors.push({
              code: 'DESTRUCTIVE_DATA_LOSS',
              description: `Statement drops database object (${removeType}) permanently resulting in potential data loss.`,
              level: 'DANGER',
              statement: statementText,
            });
            riskLevel = 'DANGER';
          } else if (removeType === 'OBJECT_COLUMN' || removeType === 'OBJECT_CONSTRAINT') {
            riskFactors.push({
              code: 'SCHEMA_BREAKING_CHANGE',
              description: `Statement drops column/constraint (${removeType}) which may break dependent application logic.`,
              level: 'WARNING',
              statement: statementText,
            });
            if (riskLevel !== 'DANGER') {
              riskLevel = 'WARNING';
            }
          }
        } else if (stmtType === 'TruncateStmt') {
          riskFactors.push({
            code: 'DESTRUCTIVE_DATA_LOSS',
            description: 'TRUNCATE statement clears all records from targeted table(s).',
            level: 'DANGER',
            statement: statementText,
          });
          riskLevel = 'DANGER';
        } else if (stmtType === 'AlterTableStmt') {
          const cmds = (data.cmds as Array<Record<string, unknown>>) || [];
          for (const cmdWrapper of cmds) {
            const cmd = (cmdWrapper.AlterTableCmd as Record<string, unknown>) || {};
            const subtype = String(cmd.subtype || '');
            if (
              subtype === 'AT_DropColumn' ||
              subtype === 'AT_DropConstraint' ||
              subtype === 'AT_AlterColumnType'
            ) {
              riskFactors.push({
                code: 'SCHEMA_BREAKING_CHANGE',
                description: `ALTER TABLE statement contains destructive command: ${subtype}.`,
                level: 'WARNING',
                statement: statementText,
              });
              if (riskLevel !== 'DANGER') {
                riskLevel = 'WARNING';
              }
            }
          }
        }
      }
    } catch {
      for (const statement of statements) {
        const upperStmt = statement.toUpperCase();
        if (
          upperStmt.includes('DROP TABLE') ||
          upperStmt.includes('DROP DATABASE') ||
          upperStmt.includes('TRUNCATE')
        ) {
          riskFactors.push({
            code: 'DESTRUCTIVE_DATA_LOSS',
            description: 'Statement drops tables or truncates data permanently.',
            level: 'DANGER',
            statement,
          });
          riskLevel = 'DANGER';
        }
      }
    }

    const client = await this.dbManager.getPool().connect();
    let valid = true;
    let executionError: string | undefined = undefined;

    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL search_path TO public');
      await withAdminContext(client, () => client.query(input.sql), true);
    } catch (error) {
      valid = false;
      executionError = error instanceof Error ? error.message : String(error);
    } finally {
      await Promise.resolve(client.query('ROLLBACK')).catch(() => {});
      client.release();
    }

    if (!valid) {
      riskLevel = 'DANGER';
      riskFactors.push({
        code: 'SYNTAX_OR_EXECUTION_ERROR',
        description: executionError || 'Failed to execute SQL dry-run.',
        level: 'DANGER',
      });
    }

    return {
      valid,
      statementCount: statements.length,
      statements,
      riskLevel,
      riskFactors,
      error: executionError,
    };
  }
}
