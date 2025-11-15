import { DatabaseManager } from '@/core/database/manager.js';
import { AppError } from '@/api/middleware/error.js';
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
import { convertSqlTypeToColumnType } from '@/utils/utils';

const reservedColumns = {
  id: ColumnType.UUID,
  created_at: ColumnType.DATETIME,
  updated_at: ColumnType.DATETIME,
};

const userTableFrozenColumns = ['nickname', 'avatar_url'];

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
  private dbManager: DatabaseManager;

  constructor() {
    this.dbManager = DatabaseManager.getInstance();
  }

  /**
   * List all tables
   */
  async listTables(): Promise<string[]> {
    const db = this.dbManager.getDb();
    const tables = await db
      .prepare(
        `
        SELECT table_name as name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name NOT LIKE '\\_%'
      `
      )
      .all();

    return tables.map((t: { name: string }) => t.name);
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
    // Prevent creation of system tables
    if (table_name.startsWith('_')) {
      throw new AppError(
        'Cannot create system tables',
        403,
        ERROR_CODES.FORBIDDEN,
        'Table names starting with underscore are reserved for system tables'
      );
    }

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

    const db = this.dbManager.getDb();

    // Check if table exists
    const tableExists = await db
      .prepare(
        `
          SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = ?
          ) as exists
        `
      )
      .get(table_name);

    if (tableExists?.exists) {
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

    await db
      .prepare(
        `
          CREATE TABLE ${this.quoteIdentifier(table_name)} (
            ${tableDefinition}
          );
          NOTIFY pgrst, 'reload schema';
        `
      )
      .exec();

    if (use_RLS) {
      // Enable RLS policies
      await db
        .prepare(
          `
            ALTER TABLE ${this.quoteIdentifier(table_name)} ENABLE ROW LEVEL SECURITY;
          `
        )
        .exec();
    }

    // Create trigger for updated_at
    await db
      .prepare(
        `
          CREATE TRIGGER ${this.quoteIdentifier(table_name + '_update_timestamp')} 
          BEFORE UPDATE ON ${this.quoteIdentifier(table_name)}
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        `
      )
      .exec();

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
      nextActions: 'you can now use the table with the POST /api/database/tables/{table} endpoint',
    };
  }

  /**
   * Get all table schemas
   */
  async getAllTableSchemas(): Promise<GetTableSchemaResponse[]> {
    const tables = await this.listTables();
    const schemas = await Promise.all(tables.map((table) => this.getTableSchema(table)));
    return schemas;
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
    const db = this.dbManager.getDb();

    // Get column information from information_schema
    const columns = await db
      .prepare(
        `
          SELECT 
            column_name,
            data_type,
            is_nullable,
            column_default,
            character_maximum_length
          FROM information_schema.columns
          WHERE table_schema = 'public' 
          AND table_name = ?
          ORDER BY ordinal_position
        `
      )
      .all(table);

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
    const primaryKeys = await db
      .prepare(
        `
          SELECT column_name
          FROM information_schema.key_column_usage
          WHERE table_schema = 'public'
          AND table_name = ?
          AND constraint_name = (
            SELECT constraint_name
            FROM information_schema.table_constraints
            WHERE table_schema = 'public'
            AND table_name = ?
            AND constraint_type = 'PRIMARY KEY'
          )
        `
      )
      .all(table, table);

    const pkSet = new Set(primaryKeys.map((pk: PrimaryKeyInfo) => pk.column_name));

    // Get unique columns
    const uniqueColumns = await db
      .prepare(
        `
          SELECT DISTINCT kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.table_schema = 'public'
            AND tc.table_name = ?
            AND tc.constraint_type = 'UNIQUE'
        `
      )
      .all(table);

    const uniqueSet = new Set(uniqueColumns.map((u: { column_name: string }) => u.column_name));

    // Get row count
    const { row_count } = await db.prepare(`SELECT COUNT(*) as row_count FROM "${table}"`).get();

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

    // Prevent modification of system tables
    if (tableName.startsWith('_')) {
      throw new AppError(
        'System tables cannot be modified',
        403,
        ERROR_CODES.DATABASE_FORBIDDEN,
        'System tables cannot be modified. System tables are prefixed with underscore.'
      );
    }

    const db = this.dbManager.getDb();

    // Check if table exists
    const tableExists = await db
      .prepare(
        `
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = ?
          ) as exists
        `
      )
      .get(tableName);

    if (!tableExists?.exists) {
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
          await db
            .prepare(
              `
                ALTER TABLE ${safeTableName} 
                DROP CONSTRAINT ${this.quoteIdentifier(constraintName)}
              `
            )
            .exec();

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
        if (tableName === 'users' && userTableFrozenColumns.includes(col)) {
          throw new AppError(
            'cannot drop frozen users columns',
            403,
            ERROR_CODES.FORBIDDEN,
            `You cannot drop the frozen users column '${col}'`
          );
        }
        await db
          .prepare(
            `
              ALTER TABLE ${safeTableName} 
              DROP COLUMN ${this.quoteIdentifier(col)}
            `
          )
          .exec();

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
        if (tableName === 'users' && userTableFrozenColumns.includes(column.columnName)) {
          throw new AppError(
            'cannot update frozen user columns',
            403,
            ERROR_CODES.FORBIDDEN,
            `You cannot update the frozen users column '${column.columnName}'`
          );
        }

        // Handle default value changes
        if (column.defaultValue !== undefined) {
          if (column.defaultValue === '') {
            // Drop default
            await db
              .prepare(
                `
                ALTER TABLE ${safeTableName} 
                ALTER COLUMN ${this.quoteIdentifier(column.columnName)} DROP DEFAULT
              `
              )
              .exec();
          } else {
            // Set default
            await db
              .prepare(
                `
                ALTER TABLE ${safeTableName} 
                ALTER COLUMN ${this.quoteIdentifier(column.columnName)} SET ${formatDefaultValue(column.defaultValue)}
              `
              )
              .exec();
          }
        }

        // Handle column rename - do this last to avoid issues with other operations
        if (column.newColumnName) {
          await db
            .prepare(
              `
              ALTER TABLE ${safeTableName} 
              RENAME COLUMN ${this.quoteIdentifier(column.columnName)} TO ${this.quoteIdentifier(column.newColumnName as string)}
            `
            )
            .exec();
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

        await db
          .prepare(
            `
              ALTER TABLE ${safeTableName} 
              ADD COLUMN ${this.quoteIdentifier(col.columnName)} ${sqlType} ${nullable} ${unique} ${defaultClause}
            `
          )
          .exec();

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
        await db
          .prepare(
            `
              ALTER TABLE ${safeTableName} 
              ADD ${fkeyConstraint}
            `
          )
          .exec();

        completedOperations.push(`Added foreign key constraint on column: ${col.columnName}`);
      }
    }

    if (renameTable && renameTable.newTableName) {
      if (tableName === 'users') {
        throw new AppError('Cannot rename users table', 403, ERROR_CODES.FORBIDDEN);
      }
      // Prevent renaming to system tables
      if (renameTable.newTableName.startsWith('_')) {
        throw new AppError(
          'Cannot rename to system table',
          403,
          ERROR_CODES.FORBIDDEN,
          'Table names starting with underscore are reserved for system tables'
        );
      }

      const safeNewTableName = this.quoteIdentifier(renameTable.newTableName);
      // Rename the table
      await db
        .prepare(
          `
            ALTER TABLE ${safeTableName} 
            RENAME TO ${safeNewTableName}
          `
        )
        .exec();

      completedOperations.push(`Renamed table from ${tableName} to ${renameTable.newTableName}`);
    }

    // Update metadata after schema changes
    // Metadata is now updated on-demand

    // enable postgrest to query this table
    await db
      .prepare(
        `
          NOTIFY pgrst, 'reload schema';
        `
      )
      .exec();

    return {
      message: 'table schema updated successfully',
      tableName,
      operations: completedOperations,
    };
  }

  /**
   * Delete a table
   */
  async deleteTable(table: string): Promise<DeleteTableResponse> {
    // Prevent deletion of system tables
    if (table.startsWith('_')) {
      throw new AppError(
        'System tables cannot be deleted',
        403,
        ERROR_CODES.DATABASE_FORBIDDEN,
        'System tables cannot be deleted. System tables are prefixed with underscore.'
      );
    }
    if (table === 'users') {
      throw new AppError('Cannot delete users table', 403, ERROR_CODES.DATABASE_FORBIDDEN);
    }

    const db = this.dbManager.getDb();
    await db.prepare(`DROP TABLE IF EXISTS ${this.quoteIdentifier(table)} CASCADE`).run();

    // Update metadata
    // Metadata is now updated on-demand

    // enable postgrest to query this table
    await db
      .prepare(
        `
        NOTIFY pgrst, 'reload schema';
      `
      )
      .exec();

    return {
      message: 'table deleted successfully',
      tableName: table,
      nextActions:
        'table deleted successfully, you can create a new table with the POST /api/database/tables endpoint',
    };
  }

  // Helper methods
  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
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
    const constraintName = `fk_${col.columnName}_${fk.referenceTable}_${fk.referenceColumn}`;
    const onDelete = fk.onDelete || 'RESTRICT';
    const onUpdate = fk.onUpdate || 'RESTRICT';

    if (include_source_column) {
      return `CONSTRAINT ${this.quoteIdentifier(constraintName)} FOREIGN KEY (${this.quoteIdentifier(col.columnName)}) REFERENCES ${this.quoteIdentifier(fk.referenceTable)}(${this.quoteIdentifier(fk.referenceColumn)}) ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
    } else {
      return `CONSTRAINT ${this.quoteIdentifier(constraintName)} REFERENCES ${this.quoteIdentifier(fk.referenceTable)}(${this.quoteIdentifier(fk.referenceColumn)}) ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
    }
  }

  private async getFkeyConstraints(table: string): Promise<Map<string, ForeignKeyInfo>> {
    const db = this.dbManager.getDb();
    const foreignKeys = await db
      .prepare(
        `
        SELECT
          tc.constraint_name,
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
      `
      )
      .all(table);

    // Create a map of column names to their foreign key info
    const foreignKeyMap = new Map<string, ForeignKeyInfo>();
    foreignKeys.forEach((fk: ForeignKeyRow) => {
      if (fk.foreign_table.startsWith('_')) {
        // hiden internal table.
        return;
      }
      foreignKeyMap.set(fk.from_column, {
        constraint_name: fk.constraint_name,
        referenceTable: fk.foreign_table,
        referenceColumn: fk.foreign_column,
        onDelete: fk.on_delete as OnDeleteActionSchema,
        onUpdate: fk.on_update as OnUpdateActionSchema,
      });
    });
    return foreignKeyMap;
  }
}
