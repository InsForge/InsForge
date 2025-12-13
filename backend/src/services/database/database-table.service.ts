import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import {
  COLUMN_TYPES,
  ForeignKeyRow,
  ColumnInfo,
  PrimaryKeyInfo,
  ForeignKeyInfo,
} from '@/types/database.js';
import {
  ColumnSchema,
  ColumnType,
  CreateTableResponse,
  GetTableSchemaResponse,
  UpdateTableSchemaRequest,
  UpdateTableSchemaResponse,
  DeleteTableResponse,
  OnDeleteActionSchema,
  OnUpdateActionSchema,
  ForeignKeySchema,
} from '@insforge/shared-schemas';
import { validateIdentifier } from '@/utils/validations.js';
import { convertSqlTypeToColumnType } from '@/utils/utils.js';

const reservedColumns = {
  id: ColumnType.UUID,
  created_at: ColumnType.DATETIME,
  updated_at: ColumnType.DATETIME,
};

const SAFE_FUNCS = new Set(['now()', 'gen_random_uuid()']);

function getSafeDollarQuotedLiteral(s: string) {
  let tag = 'val';
  while (s.includes(`$${tag}$`)) {
    tag += '_';
  }
  return `$${tag}$${s}$${tag}$`;
}

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

  public static getInstance(): DatabaseTableService {
    if (!DatabaseTableService.instance) {
      DatabaseTableService.instance = new DatabaseTableService();
    }
    return DatabaseTableService.instance;
  }

  /**
   * List all tables
   */
  async listTables(): Promise<string[]> {
    const result = await this.getPool().query(
      `
        SELECT table_name as name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      `
    );

    return result.rows.map((t: { name: string }) => t.name);
  }

  /**
   * Create a new table
   */
  async createTable(
    table_name: string,
    columns: ColumnSchema[],
    use_RLS = true
  ): Promise<CreateTableResponse> {
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
    try {
      // Check if table exists
      const tableExistsResult = await client.query(
        `
          SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = $1
          ) as exists
        `,
        [table_name]
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

      // Prepare foreign key constraints
      const foreignKeyConstraints = validatedColumns
        .filter((col) => col.foreignKey)
        .map((col) => this.generateFkeyConstraintStatement(col, true))
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
          CREATE TABLE ${this.quoteIdentifier(table_name)} (
            ${tableDefinition}
          );
          NOTIFY pgrst, 'reload schema';
        `
      );

      if (use_RLS) {
        // Enable RLS policies
        await client.query(
          `
            ALTER TABLE ${this.quoteIdentifier(table_name)} ENABLE ROW LEVEL SECURITY;
          `
        );
      }

      // Create trigger for updated_at
      await client.query(
        `
          CREATE TRIGGER ${this.quoteIdentifier(table_name + '_update_timestamp')}
          BEFORE UPDATE ON ${this.quoteIdentifier(table_name)}
          FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
        `
      );

      // Update metadata
      // Metadata is now updated on-demand

      return {
        message: 'table created successfully',
        tableName: table_name,
        columns: validatedColumns.map((col) => ({
          ...col,
          sqlType: COLUMN_TYPES[col.type as ColumnType].sqlType,
        })),
        autoFields: ['id', 'created_at', 'updated_at'],
        nextActions:
          'you can now use the table with the POST /api/database/tables/{table} endpoint',
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get table schema
   */
  /**
   * Parse PostgreSQL default value format
   * Extracts the actual value from formats like 'abc'::text or 123::integer
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

  async getTableSchema(table: string): Promise<GetTableSchemaResponse> {
    const client = await this.getPool().connect();
    try {
      // Get column information from information_schema
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
        [table]
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

      // Get foreign key information
      const foreignKeyMap = await this.getFkeyConstraints(table);

      // Get primary key information
      const primaryKeysResult = await client.query(
        `
          SELECT column_name
          FROM information_schema.key_column_usage
          WHERE table_schema = 'public'
          AND table_name = $1
          AND constraint_name = (
            SELECT constraint_name
            FROM information_schema.table_constraints
            WHERE table_schema = 'public'
            AND table_name = $2
            AND constraint_type = 'PRIMARY KEY'
          )
        `,
        [table, table]
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
          WHERE tc.table_schema = 'public'
            AND tc.table_name = $1
            AND tc.constraint_type = 'UNIQUE'
        `,
        [table]
      );

      const uniqueColumns = uniqueColumnsResult.rows;
      const uniqueSet = new Set(uniqueColumns.map((u: { column_name: string }) => u.column_name));

      // Get row count
      const rowCountResult = await client.query(`SELECT COUNT(*) as row_count FROM "${table}"`);
      const row_count = rowCountResult.rows[0].row_count;

      return {
        tableName: table,
        columns: columns.map((col: ColumnInfo) => ({
          columnName: col.column_name,
          type: convertSqlTypeToColumnType(col.data_type),
          isNullable: col.is_nullable === 'YES',
          isPrimaryKey: pkSet.has(col.column_name),
          isUnique: pkSet.has(col.column_name) || uniqueSet.has(col.column_name),
          defaultValue: this.parseDefaultValue(col.column_default),
          ...(foreignKeyMap.has(col.column_name) && {
            foreignKey: foreignKeyMap.get(col.column_name),
          }),
        })),
        recordCount: row_count,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Update table schema
   */
  async updateTableSchema(
    tableName: string,
    operations: UpdateTableSchemaRequest
  ): Promise<UpdateTableSchemaResponse> {
    const { addColumns, dropColumns, updateColumns, addForeignKeys, dropForeignKeys, renameTable } =
      operations;

    const client = await this.getPool().connect();
    try {
      // Check if table exists
      const tableExistsResult = await client.query(
        `
          SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = $1
          ) as exists
        `,
        [tableName]
      );

      if (!tableExistsResult.rows[0]?.exists) {
        throw new AppError(
          'table not found',
          404,
          ERROR_CODES.DATABASE_NOT_FOUND,
          'Please check the table name, it must be a valid table name, or you can create a new table with the POST /api/database/tables endpoint'
        );
      }
      const currentSchema = await this.getTableSchema(tableName);
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

      const safeTableName = this.quoteIdentifier(tableName);
      const foreignKeyMap = await this.getFkeyConstraints(tableName);
      const completedOperations: string[] = [];

      // Execute operations

      // Drop foreign key constraints
      if (dropForeignKeys && Array.isArray(dropForeignKeys)) {
        for (const col of dropForeignKeys) {
          const constraintName = foreignKeyMap.get(col)?.constraint_name;
          if (constraintName) {
            await client.query(
              `
                ALTER TABLE ${safeTableName}
                DROP CONSTRAINT ${this.quoteIdentifier(constraintName)}
              `
            );

            completedOperations.push(`Dropped foreign key constraint on column: ${col}`);
          }
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
              ALTER TABLE ${safeTableName}
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
                ALTER TABLE ${safeTableName}
                ALTER COLUMN ${this.quoteIdentifier(column.columnName)} DROP DEFAULT
              `
              );
            } else {
              // Set default
              await client.query(
                `
                ALTER TABLE ${safeTableName}
                ALTER COLUMN ${this.quoteIdentifier(column.columnName)} SET ${formatDefaultValue(column.defaultValue)}
              `
              );
            }
          }

          // Handle column rename - do this last to avoid issues with other operations
          if (column.newColumnName) {
            await client.query(
              `
              ALTER TABLE ${safeTableName}
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
              ALTER TABLE ${safeTableName}
              ADD COLUMN ${this.quoteIdentifier(col.columnName)} ${sqlType} ${nullable} ${unique} ${defaultClause}
            `
          );

          completedOperations.push(`Added column: ${col.columnName}`);
        }
      }

      // Add foreign key constraints
      if (addForeignKeys && Array.isArray(addForeignKeys)) {
        for (const col of addForeignKeys) {
          if (Object.keys(reservedColumns).includes(col.columnName)) {
            throw new AppError(
              'cannot add foreign key on system columns',
              404,
              ERROR_CODES.DATABASE_FORBIDDEN,
              `You cannot add foreign key on the system column '${col.columnName}'`
            );
          }
          const fkeyConstraint = this.generateFkeyConstraintStatement(col, true);
          await client.query(
            `
              ALTER TABLE ${safeTableName}
              ADD ${fkeyConstraint}
            `
          );

          completedOperations.push(`Added foreign key constraint on column: ${col.columnName}`);
        }
      }

      if (renameTable && renameTable.newTableName) {
        const safeNewTableName = this.quoteIdentifier(renameTable.newTableName);
        // Rename the table
        await client.query(
          `
            ALTER TABLE ${safeTableName}
            RENAME TO ${safeNewTableName}
          `
        );

        completedOperations.push(`Renamed table from ${tableName} to ${renameTable.newTableName}`);
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
        message: 'table schema updated successfully',
        tableName,
        operations: completedOperations,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Delete a table
   */
  async deleteTable(table: string): Promise<DeleteTableResponse> {
    const client = await this.getPool().connect();
    try {
      await client.query(`DROP TABLE IF EXISTS ${this.quoteIdentifier(table)} CASCADE`);

      // Update metadata
      // Metadata is now updated on-demand

      // enable postgrest to query this table
      await client.query(
        `
        NOTIFY pgrst, 'reload schema';
      `
      );

      return {
        message: 'table deleted successfully',
        tableName: table,
        nextActions:
          'table deleted successfully, you can create a new table with the POST /api/database/tables endpoint',
      };
    } finally {
      client.release();
    }
  }

  // Helper methods
  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  // Quote a table reference, with special handling for auth.users
  private quoteTableReference(tableRef: string): string {
    // Only allow auth.users as a cross-schema reference
    if (tableRef === 'auth.users') {
      return '"auth"."users"';
    }
    return this.quoteIdentifier(tableRef);
  }

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

  private generateFkeyConstraintStatement(
    col: { columnName: string; foreignKey?: ForeignKeySchema },
    include_source_column: boolean = true
  ) {
    if (!col.foreignKey) {
      return '';
    }
    // Store foreign_key in a const to avoid repeated non-null assertions
    const fk = col.foreignKey;
    // Use "auth_users" in constraint name for auth.users references
    const safeTableName = fk.referenceTable === 'auth.users' ? 'auth_users' : fk.referenceTable;
    const constraintName = `fk_${col.columnName}_${safeTableName}_${fk.referenceColumn}`;
    const onDelete = fk.onDelete || 'RESTRICT';
    const onUpdate = fk.onUpdate || 'RESTRICT';

    if (include_source_column) {
      return `CONSTRAINT ${this.quoteIdentifier(constraintName)} FOREIGN KEY (${this.quoteIdentifier(col.columnName)}) REFERENCES ${this.quoteTableReference(fk.referenceTable)}(${this.quoteIdentifier(fk.referenceColumn)}) ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
    } else {
      return `CONSTRAINT ${this.quoteIdentifier(constraintName)} REFERENCES ${this.quoteTableReference(fk.referenceTable)}(${this.quoteIdentifier(fk.referenceColumn)}) ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
    }
  }

  private async getFkeyConstraints(table: string): Promise<Map<string, ForeignKeyInfo>> {
    const result = await this.getPool().query(
      `
        SELECT
          tc.constraint_name,
          kcu.column_name as from_column,
          ccu.table_schema AS foreign_schema,
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
        JOIN information_schema.referential_constraints AS rc
          ON rc.constraint_name = tc.constraint_name
          AND rc.constraint_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = $1
      `,
      [table]
    );

    const foreignKeys = result.rows;

    // Create a map of column names to their foreign key info
    const foreignKeyMap = new Map<string, ForeignKeyInfo>();
    foreignKeys.forEach((fk: ForeignKeyRow) => {
      // Prefix table name with schema if not public (e.g., "auth.users")
      const referenceTable =
        fk.foreign_schema !== 'public'
          ? `${fk.foreign_schema}.${fk.foreign_table}`
          : fk.foreign_table;
      foreignKeyMap.set(fk.from_column, {
        constraint_name: fk.constraint_name,
        referenceTable,
        referenceColumn: fk.foreign_column,
        onDelete: fk.on_delete as OnDeleteActionSchema,
        onUpdate: fk.on_update as OnUpdateActionSchema,
      });
    });
    return foreignKeyMap;
  }
}
