import { createHash } from 'crypto';
import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/utils/errors.js';
import { COLUMN_TYPES, ForeignKeyRow, ColumnInfo, PrimaryKeyInfo } from '@/types/database.js';
import {
  ERROR_CODES,
  ColumnSchema,
  ColumnType,
  CreateTableResponse,
  GetTableSchemaResponse,
  UpdateTableSchemaRequest,
  UpdateTableSchemaResponse,
  DeleteTableResponse,
  ForeignKeySchema,
  TableRlsStatus,
} from '@insforge/shared-schemas';
import { validateIdentifier, validateSchemaName } from '@/utils/validations.js';
import { convertSqlTypeToColumnType } from '@/utils/utils.js';
import {
  DEFAULT_DATABASE_SCHEMA,
  quoteQualifiedName,
  splitQualifiedTableReference,
  FOREIGN_KEY_INTROSPECTION_QUERY,
  groupForeignKeyRows,
} from './helpers.js';
import { withAdminContext } from './user-context.service.js';

const reservedColumns = {
  id: ColumnType.UUID,
  created_at: ColumnType.DATETIME,
  updated_at: ColumnType.DATETIME,
};

const SAFE_FUNCS = new Set(['now()', 'gen_random_uuid()']);

/**
 * Generate a safe dollar-quoted literal for PostgreSQL
 * Ensures the tag doesn't conflict with the content by appending underscores
 * @param s - The string to quote
 * @returns A dollar-quoted string safe for use in SQL
 */
function getSafeDollarQuotedLiteral(s: string) {
  let tag = 'val';
  while (s.includes(`$${tag}$`)) {
    tag += '_';
  }
  return `$${tag}$${s}$${tag}$`;
}

/**
 * Get the system default value for a column type
 * Returns null for nullable columns or types without defaults
 * @param columnType - The column type
 * @param isNullable - Whether the column is nullable
 * @returns The default value clause or null
 */
function getSystemDefault(columnType?: ColumnType, isNullable?: boolean): string | null {
  if (!columnType || isNullable) {
    return null;
  }
  const fieldType = COLUMN_TYPES[columnType];
  if (!fieldType?.defaultValue) {
    return null;
  }

  const def = fieldType.defaultValue.trim().toLowerCase();
  if (SAFE_FUNCS.has(def)) {
    return `DEFAULT ${def}`;
  }
  return `DEFAULT ${getSafeDollarQuotedLiteral(def)}`;
}

/**
 * Format a default value for PostgreSQL column definition
 * Handles special functions (now(), gen_random_uuid()) and escapes string values
 * @param input - The default value input
 * @param columnType - The column type for system defaults
 * @param isNullable - Whether the column is nullable
 * @returns Formatted DEFAULT clause for SQL
 */
export function formatDefaultValue(
  input: string | null | undefined,
  columnType?: ColumnType,
  isNullable?: boolean
): string {
  if (!input) {
    return getSystemDefault(columnType, isNullable) ?? '';
  }
  const value = input.trim();
  const lowered = value.toLowerCase();

  if (SAFE_FUNCS.has(lowered)) {
    return `DEFAULT ${lowered}`;
  }
  return `DEFAULT ${getSafeDollarQuotedLiteral(value)}`;
}

/**
 * Service managing database table lifecycle, DDL operations, schema introspection,
 * foreign key constraints, and Row Level Security (RLS) enforcement.
 */
export class DatabaseTableService {
  private static instance: DatabaseTableService;
  private pool: Pool | null = null;

  private constructor() {}

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Retrieves the singleton instance of DatabaseTableService.
   *
   * @returns The singleton DatabaseTableService instance
   */
  public static getInstance(): DatabaseTableService {
    if (!DatabaseTableService.instance) {
      DatabaseTableService.instance = new DatabaseTableService();
    }
    return DatabaseTableService.instance;
  }

  /**
   * Lists all base table names in the specified database schema.
   *
   * @param schemaName - Target database schema name (defaults to 'public')
   * @returns Array of base table names sorted alphabetically
   * @throws {AppError} When schemaName validation fails
   */
  async listTables(schemaName: string = DEFAULT_DATABASE_SCHEMA): Promise<string[]> {
    validateSchemaName(schemaName);
    const result = await this.getPool().query(
      `
        SELECT table_name as name
        FROM information_schema.tables
        WHERE table_schema = $1
        AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `,
      [schemaName]
    );

    return result.rows.map((t: { name: string }) => t.name);
  }

  /**
   * Get lightweight RLS status for all tables in a schema.
   * Performs a single query against pg_class and pg_namespace without executing
   * row counts or introspecting columns, avoiding the N+1 schema query overhead.
   *
   * @param schemaName Target schema name (defaults to public)
   * @returns Array of table RLS status records
   */
  async getTableRlsStatuses(
    schemaName: string = DEFAULT_DATABASE_SCHEMA
  ): Promise<TableRlsStatus[]> {
    validateSchemaName(schemaName);
    const result = await this.getPool().query(
      `
        SELECT
          n.nspname AS "schemaName",
          c.relname AS "tableName",
          c.relrowsecurity AS "rlsEnabled"
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
          AND c.relkind IN ('r', 'p')
        ORDER BY c.relname
      `,
      [schemaName]
    );

    return result.rows.map((row) => ({
      tableName: row.tableName as string,
      schemaName: row.schemaName as string,
      rlsEnabled: Boolean(row.rlsEnabled),
    }));
  }

  /**
   * Creates a new table within the specified database schema.
   *
   * By default, tables are created with Row Level Security (RLS) enabled.
   * If `use_RLS` is explicitly passed as `false`, RLS is disabled within the same
   * transaction before committing to satisfy deliberate API opt-out contracts without
   * exposing an insecure window. PostgREST schema cache is reloaded upon creation.
   *
   * @param schemaName - Target database schema name (e.g. 'public')
   * @param table_name - Identifier of the table to create
   * @param columns - Array of column definitions including types, constraints, and defaults
   * @param foreignKeys - Optional array of foreign key constraint definitions
   * @param use_RLS - Whether Row Level Security should be enabled (default: true)
   * @returns Detailed schema of the newly created table including RLS status
   * @throws {AppError} When identifier validation fails, duplicate table exists, or DDL execution fails
   */
  async createTable(
    schemaName: string,
    table_name: string,
    columns: ColumnSchema[],
    foreignKeys: ForeignKeySchema[] = [],
    use_RLS = true
  ): Promise<CreateTableResponse> {
    validateSchemaName(schemaName);
    // Validate table name
    validateIdentifier(table_name, 'table');

    // Filter out reserved fields with matching types, throw error for mismatched types
    const validatedColumns = this.validateReservedFields(columns);

    // Ensure at least one user-defined column exists
    if (validatedColumns.length === 0) {
      throw new AppError(
        'Table must have at least one user-defined column',
        400,
        ERROR_CODES.DATABASE_VALIDATION_ERROR,
        'Please add at least one custom column (not id, created_at, or updated_at) to the table.'
      );
    }
    // Validate remaining columns - only need to validate column names since Zod handles type validation
    validatedColumns.forEach((col: ColumnSchema, index: number) => {
      // Validate column name
      try {
        validateIdentifier(col.columnName, 'column');
      } catch (error) {
        if (error instanceof AppError) {
          throw new AppError(
            `Invalid column name at index ${index}: ${error.message}`,
            error.statusCode,
            error.code,
            error.nextActions
          );
        }
        throw error;
      }
    });

    const client = await this.getPool().connect();
    let transactionStarted = false;
    let releaseError: Error | undefined;
    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const response = await withAdminContext(
        client,
        async () => {
          const safeQualifiedTableName = quoteQualifiedName(schemaName, table_name);

          // Check if table exists
          const tableExistsResult = await client.query(
            `
            SELECT EXISTS (
              SELECT FROM information_schema.tables
              WHERE table_schema = $1
              AND table_name = $2
            ) as exists
          `,
            [schemaName, table_name]
          );

          if (tableExistsResult.rows[0]?.exists) {
            throw new AppError(
              `table ${table_name} already exists`,
              400,
              ERROR_CODES.DATABASE_DUPLICATE,
              `table ${table_name} already exists. Please check the table name, it must be a unique table name.`
            );
          }

          // Map columns to SQL with proper type conversion
          const columnDefs = validatedColumns
            .map((col: ColumnSchema) => {
              const fieldType = COLUMN_TYPES[col.type as ColumnType];
              const sqlType = fieldType.sqlType;

              // Handle default values
              const defaultClause = formatDefaultValue(
                col.defaultValue,
                col.type as ColumnType,
                col.isNullable
              );

              const nullable = col.isNullable ? '' : 'NOT NULL';
              const unique = col.isUnique ? 'UNIQUE' : '';

              return `${this.quoteIdentifier(col.columnName)} ${sqlType} ${nullable} ${unique} ${defaultClause}`.trim();
            })
            .join(', ');

          // Reject foreign keys on system columns (consistent with updateTableSchema).
          for (const fk of foreignKeys) {
            const systemSourceColumn = fk.referenceColumns
              .map((rc) => rc.sourceColumn)
              .find((source) => Object.keys(reservedColumns).includes(source));
            if (systemSourceColumn) {
              throw new AppError(
                'cannot add foreign key on system columns',
                400,
                ERROR_CODES.DATABASE_FORBIDDEN,
                `You cannot add foreign key on the system column '${systemSourceColumn}'`
              );
            }
          }

          // Prepare foreign key constraints — one statement per constraint entity.
          const foreignKeyConstraints = foreignKeys
            .map((fk) => this.generateFkeyConstraintStatement(fk, schemaName, true))
            .join(', ');

          // Create table with auto fields and foreign keys
          const tableDefinition = [
            'id UUID PRIMARY KEY DEFAULT gen_random_uuid()',
            columnDefs,
            'created_at TIMESTAMPTZ DEFAULT now()',
            'updated_at TIMESTAMPTZ DEFAULT now()',
            foreignKeyConstraints,
          ]
            .filter(Boolean)
            .join(', ');

          await client.query(
            `
            CREATE TABLE ${safeQualifiedTableName} (
              ${tableDefinition}
            );
            NOTIFY pgrst, 'reload schema';
          `
          );

          if (use_RLS) {
            // Enable RLS policies
            await client.query(
              `
              ALTER TABLE ${safeQualifiedTableName} ENABLE ROW LEVEL SECURITY;
            `
            );
          } else {
            // Explicit opt-out: when an admin explicitly passes rlsEnabled: false to the
            // structured table creation API, the PostgreSQL event trigger (system.auto_enable_rls)
            // will have auto-enabled RLS upon CREATE TABLE in schema public. We immediately disable
            // RLS within the same uncommitted transaction prior to COMMIT so the table is created
            // with RLS disabled without exposing an intermediate state to external connections.
            await client.query(
              `
              ALTER TABLE ${safeQualifiedTableName} DISABLE ROW LEVEL SECURITY;
            `
            );
          }

          // Create trigger for updated_at
          await client.query(
            `
            CREATE TRIGGER ${this.quoteIdentifier(table_name + '_update_timestamp')}
            BEFORE UPDATE ON ${safeQualifiedTableName}
            FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
          `
          );

          // Update metadata
          // Metadata is now updated on-demand

          return {
            schemaName,
            message: 'table created successfully',
            tableName: table_name,
            columns: validatedColumns.map((col) => ({
              ...col,
              sqlType: COLUMN_TYPES[col.type as ColumnType].sqlType,
            })),
            autoFields: ['id', 'created_at', 'updated_at'],
            nextActions:
              'you can now use the table with the POST /api/database/tables/{table} endpoint',
            rlsEnabled: use_RLS,
          };
        },
        true,
        (error) => {
          releaseError = error;
        }
      );

      await client.query('COMMIT');
      transactionStarted = false;
      return response;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          releaseError =
            rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
        }
        transactionStarted = false;
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }

  /**
   * Parses PostgreSQL default value expressions into cleaned literal strings.
   * Extracts the actual value from type-cast expressions such as `'abc'::text` or `123::integer`.
   *
   * @param defaultValue - Raw PostgreSQL column default value expression
   * @returns Extracted default value string or undefined if input is null/empty
   */
  private parseDefaultValue(defaultValue: string | null): string | undefined {
    if (!defaultValue) {
      return undefined;
    }
    // Handle string literals with type casting (e.g., 'abc'::text)
    const stringMatch = defaultValue.match(/^'([^']*)'::[\w\s]+$/);
    if (stringMatch) {
      return stringMatch[1];
    }

    // Handle numeric/boolean values with type casting (e.g., 123::integer, true::boolean)
    const typeCastMatch = defaultValue.match(/^(.+?)::[\w\s]+$/);
    if (typeCastMatch) {
      return typeCastMatch[1];
    }

    // Return as-is if no type casting pattern found
    return defaultValue;
  }

  /**
   * Introspects and retrieves the full schema of an existing table.
   *
   * Queries `information_schema` views (`columns`, `table_constraints`, `key_column_usage`)
   * and PostgreSQL catalogs (`pg_class`, `pg_namespace`, `pg_constraint`, `pg_attribute`)
   * to resolve columns, data types, nullability, default values, primary/foreign keys,
   * exact row counts, and current Row Level Security (`rlsEnabled`) status.
   *
   * @param schemaName - Target database schema name
   * @param table - Identifier of the table to introspect
   * @returns Table schema metadata object conforming to `GetTableSchemaResponse`
   * @throws {AppError} When table does not exist or identifier validation fails
   */
  async getTableSchema(schemaName: string, table: string): Promise<GetTableSchemaResponse> {
    validateSchemaName(schemaName);
    validateIdentifier(table, 'table');
    const client = await this.getPool().connect();
    try {
      // Get column information from information_schema
      const columnsResult = await client.query(
        `
          SELECT
            column_name,
            data_type,
            udt_name,
            is_nullable,
            column_default,
            character_maximum_length
          FROM information_schema.columns
          WHERE table_schema = $1
          AND table_name = $2
          ORDER BY ordinal_position
        `,
        [schemaName, table]
      );

      const columns = columnsResult.rows;

      if (columns.length === 0) {
        throw new AppError(
          'table not found',
          404,
          ERROR_CODES.DATABASE_NOT_FOUND,
          'table not found. Please check the table name, it must be a valid table name, or you can create a new table with the POST /api/database/tables endpoint'
        );
      }

      // Get foreign key information (one entity per constraint)
      const foreignKeys = await this.getFkeyConstraints(schemaName, table);

      // Get primary key information
      const primaryKeysResult = await client.query(
        `
          SELECT column_name
          FROM information_schema.key_column_usage
          WHERE table_schema = $1
          AND table_name = $2
          AND constraint_name = (
            SELECT constraint_name
            FROM information_schema.table_constraints
            WHERE table_schema = $1
            AND table_name = $3
            AND constraint_type = 'PRIMARY KEY'
          )
        `,
        [schemaName, table, table]
      );

      const primaryKeys = primaryKeysResult.rows;
      const pkSet = new Set(primaryKeys.map((pk: PrimaryKeyInfo) => pk.column_name));

      // Get unique columns
      const uniqueColumnsResult = await client.query(
        `
          SELECT DISTINCT kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.table_schema = $1
            AND tc.table_name = $2
            AND tc.constraint_type = 'UNIQUE'
        `,
        [schemaName, table]
      );

      const uniqueColumns = uniqueColumnsResult.rows;
      const uniqueSet = new Set(uniqueColumns.map((u: { column_name: string }) => u.column_name));

      // Get exact row count using standard COUNT(*)
      let row_count = 0;
      try {
        const countResult = await client.query(
          `SELECT COUNT(*) as row_count FROM ${quoteQualifiedName(schemaName, table)}`
        );
        row_count = Number(countResult.rows[0]?.row_count || 0);
      } catch {
        row_count = 0;
      }

      // Get RLS status from pg_class
      const rlsResult = await client.query(
        `
          SELECT c.relrowsecurity
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1
            AND c.relname = $2
            AND c.relkind IN ('r', 'p')
        `,
        [schemaName, table]
      );
      const rlsEnabled = Boolean(rlsResult.rows[0]?.relrowsecurity);

      return {
        schemaName,
        tableName: table,
        columns: columns.map((col: ColumnInfo) => {
          // For USER-DEFINED types (extensions like pgvector), use udt_name
          const effectiveType = col.data_type === 'USER-DEFINED' ? col.udt_name : col.data_type;
          return {
            columnName: col.column_name,
            type: convertSqlTypeToColumnType(effectiveType),
            isNullable: col.is_nullable === 'YES',
            isPrimaryKey: pkSet.has(col.column_name),
            isUnique: pkSet.has(col.column_name) || uniqueSet.has(col.column_name),
            defaultValue: this.parseDefaultValue(col.column_default),
          };
        }),
        foreignKeys,
        recordCount: row_count,
        rlsEnabled,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Updates an existing table schema by applying column and constraint alterations.
   *
   * Executes DDL operations (add/drop/update columns, add/drop foreign keys, rename table)
   * within an admin transaction. Automatically reloads the PostgREST schema cache upon
   * completion and safely cleans up connections on rollback failures.
   *
   * @param schemaName - Target database schema name
   * @param tableName - Name of the table to modify
   * @param operations - Schema modifications conforming to `UpdateTableSchemaRequest`
   * @returns Updated table schema response
   * @throws {AppError} When table is missing, identifier validation fails, or DDL execution fails
   */
  async updateTableSchema(
    schemaName: string,
    tableName: string,
    operations: UpdateTableSchemaRequest
  ): Promise<UpdateTableSchemaResponse> {
    validateSchemaName(schemaName);
    const { addColumns, dropColumns, updateColumns, addForeignKeys, dropForeignKeys, renameTable } =
      operations;

    const client = await this.getPool().connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const response = await withAdminContext(
        client,
        async () => {
          const safeQualifiedTableName = quoteQualifiedName(schemaName, tableName);

          // Check if table exists
          const tableExistsResult = await client.query(
            `
            SELECT EXISTS (
              SELECT FROM information_schema.tables
              WHERE table_schema = $1
              AND table_name = $2
            ) as exists
          `,
            [schemaName, tableName]
          );

          if (!tableExistsResult.rows[0]?.exists) {
            throw new AppError(
              'table not found',
              404,
              ERROR_CODES.DATABASE_NOT_FOUND,
              'Please check the table name, it must be a valid table name, or you can create a new table with the POST /api/database/tables endpoint'
            );
          }
          const currentSchema = await this.getTableSchema(schemaName, tableName);
          const currentUserColumns = currentSchema.columns.filter(
            (col) => !Object.keys(reservedColumns).includes(col.columnName)
          );

          // Filter dropped and added user columns
          const droppedUserColumns = dropColumns
            ? dropColumns.filter((col) => !Object.keys(reservedColumns).includes(col))
            : [];
          const addedUserColumns = addColumns ? this.validateReservedFields(addColumns) : [];

          // Calculate final user column count
          const finalUserColumnsCount =
            currentUserColumns.length - droppedUserColumns.length + addedUserColumns.length;

          if (finalUserColumnsCount <= 0) {
            throw new AppError(
              'Table must have at least one user-defined column after update',
              400,
              ERROR_CODES.DATABASE_VALIDATION_ERROR,
              'The update would leave the table with no custom columns. Please add columns or avoid dropping all user-defined columns.'
            );
          }

          const existingForeignKeys = await this.getFkeyConstraints(schemaName, tableName);
          const existingConstraintNames = new Set(
            existingForeignKeys.map((fk) => fk.constraintName).filter(Boolean)
          );
          const completedOperations: string[] = [];

          // Execute operations

          // Drop foreign key constraints by constraint name.
          if (dropForeignKeys && Array.isArray(dropForeignKeys)) {
            for (const constraintName of dropForeignKeys) {
              // Fail loudly on an unknown/stale name instead of reporting success while
              // the constraint is still enforced (e.g. a typo'd or already-dropped name).
              if (!existingConstraintNames.has(constraintName)) {
                throw new AppError(
                  `Foreign key constraint '${constraintName}' does not exist on this table.`,
                  404,
                  ERROR_CODES.DATABASE_NOT_FOUND,
                  'Refresh the table schema and retry; the constraint may have already been removed.'
                );
              }
              await client.query(
                `
                  ALTER TABLE ${safeQualifiedTableName}
                  DROP CONSTRAINT ${this.quoteIdentifier(constraintName)}
                `
              );

              completedOperations.push(`Dropped foreign key constraint: ${constraintName}`);
            }
          }

          // Drop columns first (to avoid conflicts with renames)
          if (dropColumns && Array.isArray(dropColumns)) {
            for (const col of dropColumns) {
              if (Object.keys(reservedColumns).includes(col)) {
                throw new AppError(
                  'cannot drop system columns',
                  404,
                  ERROR_CODES.DATABASE_FORBIDDEN,
                  `You cannot drop the system column '${col}'`
                );
              }
              await client.query(
                `
                ALTER TABLE ${safeQualifiedTableName}
                DROP COLUMN ${this.quoteIdentifier(col)}
              `
              );

              completedOperations.push(`Dropped column: ${col}`);
            }
          }

          // Update columns
          if (updateColumns && Array.isArray(updateColumns)) {
            for (const column of updateColumns) {
              if (Object.keys(reservedColumns).includes(column.columnName)) {
                throw new AppError(
                  'cannot update system columns',
                  404,
                  ERROR_CODES.DATABASE_FORBIDDEN,
                  `You cannot update the system column '${column.columnName}'`
                );
              }

              // Handle default value changes
              if (column.defaultValue !== undefined) {
                if (column.defaultValue === '') {
                  // Drop default
                  await client.query(
                    `
                  ALTER TABLE ${safeQualifiedTableName}
                  ALTER COLUMN ${this.quoteIdentifier(column.columnName)} DROP DEFAULT
                `
                  );
                } else {
                  // Set default
                  await client.query(
                    `
                  ALTER TABLE ${safeQualifiedTableName}
                  ALTER COLUMN ${this.quoteIdentifier(column.columnName)} SET ${formatDefaultValue(column.defaultValue)}
                `
                  );
                }
              }

              // Handle column rename - do this last to avoid issues with other operations
              if (column.newColumnName) {
                await client.query(
                  `
                ALTER TABLE ${safeQualifiedTableName}
                RENAME COLUMN ${this.quoteIdentifier(column.columnName)} TO ${this.quoteIdentifier(column.newColumnName as string)}
              `
                );
              }
              completedOperations.push(`Updated column: ${column.columnName}`);
            }
          }

          // Add new columns
          if (addColumns && Array.isArray(addColumns)) {
            // Validate and filter reserved fields
            const columnsToAdd = this.validateReservedFields(addColumns);

            for (const col of columnsToAdd) {
              const fieldType = COLUMN_TYPES[col.type as ColumnType];
              let sqlType = fieldType.sqlType;
              if (col.type === ColumnType.UUID) {
                sqlType = 'UUID';
              }

              const nullable = col.isNullable !== false ? '' : 'NOT NULL';
              const unique = col.isUnique ? 'UNIQUE' : '';
              const defaultClause = formatDefaultValue(
                col.defaultValue,
                col.type as ColumnType,
                col.isNullable
              );

              await client.query(
                `
                ALTER TABLE ${safeQualifiedTableName}
                ADD COLUMN ${this.quoteIdentifier(col.columnName)} ${sqlType} ${nullable} ${unique} ${defaultClause}
              `
              );

              completedOperations.push(`Added column: ${col.columnName}`);
            }
          }

          // Add foreign key constraints — one ALTER per constraint entity.
          if (addForeignKeys && Array.isArray(addForeignKeys)) {
            for (const fk of addForeignKeys) {
              const systemSourceColumn = fk.referenceColumns
                .map((rc) => rc.sourceColumn)
                .find((source) => Object.keys(reservedColumns).includes(source));
              if (systemSourceColumn) {
                throw new AppError(
                  'cannot add foreign key on system columns',
                  404,
                  ERROR_CODES.DATABASE_FORBIDDEN,
                  `You cannot add foreign key on the system column '${systemSourceColumn}'`
                );
              }
              const fkeyConstraint = this.generateFkeyConstraintStatement(fk, schemaName, true);
              await client.query(
                `
                ALTER TABLE ${safeQualifiedTableName}
                ADD ${fkeyConstraint}
              `
              );

              const sourceColumns = fk.referenceColumns.map((rc) => rc.sourceColumn).join(', ');
              completedOperations.push(
                `Added foreign key constraint on column(s): ${sourceColumns}`
              );
            }
          }

          if (renameTable && renameTable.newTableName) {
            validateIdentifier(renameTable.newTableName, 'table');
            const safeNewTableName = this.quoteIdentifier(renameTable.newTableName);
            // Rename the table
            await client.query(
              `
              ALTER TABLE ${safeQualifiedTableName}
              RENAME TO ${safeNewTableName}
            `
            );

            completedOperations.push(
              `Renamed table from ${tableName} to ${renameTable.newTableName}`
            );
          }

          // Update metadata after schema changes
          // Metadata is now updated on-demand

          // enable postgrest to query this table
          await client.query(
            `
            NOTIFY pgrst, 'reload schema';
          `
          );

          return {
            schemaName,
            message: 'table schema updated successfully',
            tableName,
            operations: completedOperations,
          };
        },
        true
      );

      await client.query('COMMIT');
      transactionStarted = false;
      return response;
    } catch (error) {
      if (transactionStarted) {
        await client.query('ROLLBACK');
        transactionStarted = false;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Drops an existing database table and its dependent objects using CASCADE.
   *
   * Executes within an admin transaction, reloads the PostgREST schema cache,
   * and safely releases pool connections even if rollback fails.
   *
   * @param schemaName - Target database schema name
   * @param table - Identifier of the table to delete
   * @returns Confirmation response containing success status and table name
   * @throws {AppError} When schemaName validation fails or DDL execution fails
   */
  async deleteTable(schemaName: string, table: string): Promise<DeleteTableResponse> {
    validateSchemaName(schemaName);
    const client = await this.getPool().connect();
    let transactionStarted = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const response = await withAdminContext(
        client,
        async () => {
          await client.query(
            `DROP TABLE IF EXISTS ${quoteQualifiedName(schemaName, table)} CASCADE`
          );

          // Update metadata
          // Metadata is now updated on-demand

          // enable postgrest to query this table
          await client.query(
            `
          NOTIFY pgrst, 'reload schema';
        `
          );

          return {
            schemaName,
            message: 'table deleted successfully',
            tableName: table,
            nextActions:
              'table deleted successfully, you can create a new table with the POST /api/database/tables endpoint',
          };
        },
        true
      );

      await client.query('COMMIT');
      transactionStarted = false;
      return response;
    } catch (error) {
      if (transactionStarted) {
        await client.query('ROLLBACK');
        transactionStarted = false;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Enables Row Level Security (RLS) on an existing table.
   *
   * Validates schema and table identifiers, verifies table existence in pg_class within
   * an admin transaction context, executes `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`,
   * notifies PostgREST to reload its schema cache (`NOTIFY pgrst, 'reload schema'`),
   * and guarantees pool connection cleanup even upon rollback failures.
   *
   * @param schemaName - Target database schema name
   * @param tableName - Identifier of the table on which to enable RLS
   * @returns Confirmation object with schemaName, tableName, rlsEnabled, and human-readable message
   * @throws {AppError} 404 when table is not found, or 400 when identifier validation fails
   */
  async enableTableRLS(
    schemaName: string,
    tableName: string
  ): Promise<{ schemaName: string; tableName: string; rlsEnabled: boolean; message: string }> {
    validateSchemaName(schemaName);
    validateIdentifier(tableName, 'table');
    const client = await this.getPool().connect();
    let transactionStarted = false;
    let releaseError: Error | undefined;
    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const response = await withAdminContext(
        client,
        async () => {
          const safeQualifiedTableName = quoteQualifiedName(schemaName, tableName);

          // Verify table exists
          const tableCheck = await client.query(
            `
              SELECT c.relrowsecurity
              FROM pg_catalog.pg_class c
              JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = $1
                AND c.relname = $2
                AND c.relkind IN ('r', 'p')
            `,
            [schemaName, tableName]
          );

          if (tableCheck.rows.length === 0) {
            throw new AppError(
              `table ${tableName} not found in schema ${schemaName}`,
              404,
              ERROR_CODES.DATABASE_NOT_FOUND,
              `table ${tableName} not found in schema ${schemaName}.`
            );
          }

          await client.query(`ALTER TABLE ${safeQualifiedTableName} ENABLE ROW LEVEL SECURITY;`);
          await client.query(`NOTIFY pgrst, 'reload schema';`);

          return {
            schemaName,
            tableName,
            rlsEnabled: true,
            message: `Row Level Security enabled on ${schemaName}.${tableName}`,
          };
        },
        true,
        (error) => {
          releaseError = error;
        }
      );

      await client.query('COMMIT');
      transactionStarted = false;
      return response;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          releaseError =
            rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
        }
        transactionStarted = false;
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }

  // Helper methods

  /**
   * Quotes an SQL identifier to prevent SQL injection and preserve case sensitivity.
   *
   * @param identifier - SQL identifier name
   * @returns Double-quoted SQL identifier
   */
  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  /**
   * Safely formats and quotes a potentially qualified table reference (e.g. `schema.table` or `table`).
   *
   * @param tableRef - Table name or qualified schema.table reference
   * @param defaultSchemaName - Fallback schema name when unqualified
   * @returns Properly quoted qualified table reference
   */
  private quoteTableReference(tableRef: string, defaultSchemaName: string): string {
    const { schemaName, tableName } = splitQualifiedTableReference(tableRef, defaultSchemaName);
    return quoteQualifiedName(schemaName, tableName);
  }

  /**
   * Validates column definitions against reserved field names and prevents mutations
   * to system-managed fields (`id`, `created_at`, `updated_at`).
   *
   * @param columns - Array of column definitions to validate
   * @returns Validated column definitions array
   * @throws {AppError} 400 if user attempts to define or alter system-reserved columns
   */
  private validateReservedFields(columns: ColumnSchema[]): ColumnSchema[] {
    return columns.filter((col: ColumnSchema) => {
      const reservedType = reservedColumns[col.columnName as keyof typeof reservedColumns];
      if (reservedType) {
        // If it's a reserved field name
        if (col.type === reservedType) {
          // Type matches - silently ignore this column
          return false;
        } else {
          // Type doesn't match - throw error
          throw new AppError(
            `Column '${col.columnName}' is a reserved field that requires type '${reservedType}', but got '${col.type}'`,
            400,
            ERROR_CODES.DATABASE_VALIDATION_ERROR,
            'Please check the column name and type, id/created_at/updated_at are reserved fields and cannot be used as column names'
          );
        }
      }
      return true;
    });
  }

  /**
   * Generates a PostgreSQL DDL constraint statement for a foreign key definition.
   *
   * @param fk - Foreign key schema specification
   * @param defaultSchemaName - Default schema for unqualified reference tables
   * @param include_source_column - Whether to include source column list (for multi-column syntax)
   * @returns Formatted SQL CONSTRAINT clause
   */
  private generateFkeyConstraintStatement(
    fk: ForeignKeySchema,
    defaultSchemaName: string,
    include_source_column: boolean = true
  ) {
    if (!fk.referenceColumns || fk.referenceColumns.length === 0) {
      return '';
    }
    const sourceCols = fk.referenceColumns.map((r) => r.sourceColumn);
    const refCols = fk.referenceColumns.map((r) => r.referenceColumn);
    const safeTableName = fk.referenceTable.replace(/\./g, '_');
    const baseName = `fk_${sourceCols.join('_')}_${safeTableName}_${refCols.join('_')}`;
    const MAX_IDENTIFIER_LENGTH = 63;
    const constraintName =
      baseName.length > MAX_IDENTIFIER_LENGTH
        ? `${baseName.slice(0, MAX_IDENTIFIER_LENGTH - 9)}_${createHash('sha256').update(baseName).digest('hex').slice(0, 8)}`
        : baseName;
    const onDelete = fk.onDelete || 'RESTRICT';
    const onUpdate = fk.onUpdate || 'RESTRICT';

    const sourcePart = sourceCols.map((c) => this.quoteIdentifier(c)).join(', ');
    const refPart = refCols.map((c) => this.quoteIdentifier(c)).join(', ');

    if (include_source_column) {
      return `CONSTRAINT ${this.quoteIdentifier(constraintName)} FOREIGN KEY (${sourcePart}) REFERENCES ${this.quoteTableReference(fk.referenceTable, defaultSchemaName)}(${refPart}) ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
    } else {
      return `CONSTRAINT ${this.quoteIdentifier(constraintName)} REFERENCES ${this.quoteTableReference(fk.referenceTable, defaultSchemaName)}(${refPart}) ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
    }
  }

  /**
   * Introspects foreign key constraints on the specified table from PostgreSQL catalogs.
   *
   * @param schemaName - Target database schema name
   * @param table - Identifier of the table to introspect
   * @returns Array of foreign key constraint schemas
   */
  private async getFkeyConstraints(schemaName: string, table: string): Promise<ForeignKeySchema[]> {
    const result = await this.getPool().query(FOREIGN_KEY_INTROSPECTION_QUERY, [schemaName, table]);
    return groupForeignKeyRows(result.rows as ForeignKeyRow[]);
  }
}
