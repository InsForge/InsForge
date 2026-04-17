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
import {
  analyzeQuery,
  initSqlParser,
  parseSQLStatements,
  type DatabaseResourceUpdate,
} from '@/utils/sql-parser.js';

const RESERVED_SCHEMAS = new Set([
  'auth',
  'system',
  'storage',
  'ai',
  'functions',
  'realtime',
  'schedules',
  'pg_catalog',
  'information_schema',
]);

interface CreateMigrationResult {
  migration: CreateMigrationResponse;
  changes: DatabaseResourceUpdate[];
}

type AstNode = Record<string, unknown>;

function readStringNode(node: unknown): string | null {
  if (!node || typeof node !== 'object') {
    return null;
  }

  const value = (node as { String?: { sval?: unknown } }).String?.sval;
  return typeof value === 'string' ? value : null;
}

function collectExplicitSchemas(node: unknown, schemas: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectExplicitSchemas(item, schemas);
    }
    return;
  }

  if (!node || typeof node !== 'object') {
    return;
  }

  const record = node as AstNode;
  const names = record.names;
  const isTypeNameNode =
    Array.isArray(names) && (Object.hasOwn(record, 'typemod') || Object.hasOwn(record, 'typmods'));

  if (typeof record.schemaname === 'string') {
    schemas.add(record.schemaname.toLowerCase());
  }

  for (const nameKey of ['funcname', 'objname']) {
    const nameList = record[nameKey];
    if (Array.isArray(nameList) && nameList.length > 1) {
      const schemaName = readStringNode(nameList[0]);
      if (schemaName) {
        schemas.add(schemaName.toLowerCase());
      }
    }
  }

  if (Array.isArray(names) && names.length > 1) {
    const schemaName = readStringNode(names[0]);
    if (schemaName) {
      const normalizedSchemaName = schemaName.toLowerCase();
      if (!isTypeNameNode || normalizedSchemaName !== 'pg_catalog') {
        schemas.add(normalizedSchemaName);
      }
    }
  }

  for (const value of Object.values(record)) {
    collectExplicitSchemas(value, schemas);
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
        sequence_number AS "sequenceNumber",
        name,
        statements,
        created_at AS "createdAt"
      FROM system.custom_migrations
      ORDER BY sequence_number DESC
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
      this.assertStatementIsAllowed(statement);
    }

    const client = await this.dbManager.getPool().connect();
    let transactionStarted = false;

    try {
      await client.query('BEGIN');
      transactionStarted = true;
      await client.query("SELECT pg_advisory_xact_lock(hashtext('system.custom_migrations'))");
      await client.query('SET LOCAL search_path TO public');

      const sequenceResult = await client.query<{
        nextSequenceNumber: number;
      }>(`
        SELECT COALESCE(MAX(sequence_number), 0) + 1 AS "nextSequenceNumber"
        FROM system.custom_migrations
      `);

      const sequenceNumber = Number(sequenceResult.rows[0]?.nextSequenceNumber ?? 1);

      for (const statement of statements) {
        await client.query(statement);
      }

      const insertResult = await client.query<Migration>(
        `
          INSERT INTO system.custom_migrations (sequence_number, name, statements)
          VALUES ($1, $2, $3)
          RETURNING
            sequence_number AS "sequenceNumber",
            name,
            statements,
            created_at AS "createdAt"
        `,
        [sequenceNumber, input.name, statements]
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
      throw error;
    } finally {
      client.release();
    }
  }

  private assertStatementIsAllowed(statement: string): void {
    const { stmts } = parseSync(statement);
    const statementWrappers = stmts as Array<{ stmt: AstNode }>;

    for (const statementWrapper of statementWrappers) {
      const [statementType] = Object.entries(statementWrapper.stmt)[0] as [string, AstNode];

      if (statementType === 'TransactionStmt') {
        throw new AppError(
          'Custom migrations cannot manage their own transactions.',
          400,
          ERROR_CODES.DATABASE_FORBIDDEN
        );
      }

      if (statementType === 'VariableSetStmt' && /\bsearch_path\b/i.test(statement)) {
        throw new AppError(
          'Custom migrations cannot change search_path.',
          400,
          ERROR_CODES.DATABASE_FORBIDDEN
        );
      }

      if (statementType === 'CreateSchemaStmt') {
        throw new AppError(
          'Custom migrations may only target the public schema.',
          400,
          ERROR_CODES.DATABASE_FORBIDDEN
        );
      }
    }

    if (/\bset_config\s*\(\s*'search_path'/i.test(statement)) {
      throw new AppError(
        'Custom migrations cannot change search_path.',
        400,
        ERROR_CODES.DATABASE_FORBIDDEN
      );
    }

    const explicitSchemas = new Set<string>();
    collectExplicitSchemas(statementWrappers, explicitSchemas);

    for (const schemaName of explicitSchemas) {
      if (schemaName !== 'public' || RESERVED_SCHEMAS.has(schemaName)) {
        throw new AppError(
          'Custom migrations may only target the public schema.',
          400,
          ERROR_CODES.DATABASE_FORBIDDEN
        );
      }
    }
  }
}
