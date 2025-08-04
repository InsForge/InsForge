import { DatabaseManager } from '@/core/database/database.js';
import { MetadataService } from '@/core/metadata/metadata.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { BETTER_AUTH_SYSTEM_TABLES } from '@/utils/constants.js';
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
import { convertSqlTypeToColumnType } from '@/utils/helpers';

export class TablesController {
  private dbManager: DatabaseManager;
  private metadataService: MetadataService;

  constructor() {
    this.dbManager = DatabaseManager.getInstance();
    this.metadataService = MetadataService.getInstance();
  }

  /**
   * List all tables
   */
  async listTables(): Promise<string[]> {
    const db = this.dbManager.getAppDb();
    const tables = await db
      .prepare(
        `
        SELECT table_name as name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name NOT LIKE '\\_%'
        AND table_name NOT IN (${BETTER_AUTH_SYSTEM_TABLES.map((t) => `'${t}'`).join(', ')})
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

    // Validate remaining columns - only need to validate column names since Zod handles type validation
    validatedColumns.forEach((col: ColumnSchema, index: number) => {
      // Validate column name
      try {
        validateIdentifier(col.name, 'column');
      } catch (error) {
        if (error instanceof AppError) {
          throw new AppError(
            `Invalid column name at index ${index}: ${error.message}`,
            error.statusCode,
            error.code,
            error.nextAction
          );
        }
        throw error;
      }
    });

    const db = this.dbManager.getAppDb();

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
        const fieldType = COLUMN_TYPES[col.type];
        const sqlType = fieldType.sqlType;

        // Handle default values
        let defaultClause = '';
        if (col.default_value) {
          // User-specified default
          defaultClause = `DEFAULT '${col.default_value}'`;
        } else if (fieldType.defaultValue && !col.nullable) {
          // Type-specific default for non-nullable fields
          if (fieldType.defaultValue === 'gen_random_uuid()' && ColumnType.UUID) {
            // PostgreSQL UUID generation
            defaultClause = `DEFAULT gen_random_uuid()`;
          } else if (fieldType.defaultValue === 'CURRENT_TIMESTAMP') {
            defaultClause = `DEFAULT CURRENT_TIMESTAMP`;
          } else {
            defaultClause = `DEFAULT ${fieldType.defaultValue}`;
          }
        }

        const nullable = col.nullable ? '' : 'NOT NULL';
        const unique = col.is_unique ? 'UNIQUE' : '';

        return `${this.quoteIdentifier(col.name)} ${sqlType} ${nullable} ${unique} ${defaultClause}`.trim();
      })
      .join(', ');

    // Prepare foreign key constraints
    const foreignKeyConstraints = validatedColumns
      .filter((col) => col.foreign_key)
      .map((col) => this.generateFkeyConstraintStatement(col, true))
      .join(', ');

    // Create table with auto fields and foreign keys
    const tableDefinition = [
      'id UUID PRIMARY KEY DEFAULT gen_random_uuid()',
      columnDefs,
      'created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP',
      'updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP',
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

    // Log the table creation activity
    await this.dbManager.logActivity('CREATE_TABLE', table_name, undefined, {
      columns: validatedColumns,
    });

    // Update metadata
    await this.metadataService.updateDatabaseMetadata();

    return {
      message: 'table created successfully',
      table_name,
      columns: validatedColumns.map((col) => ({
        ...col,
        sql_type: COLUMN_TYPES[col.type].sqlType,
      })),
      auto_fields: ['id', 'created_at', 'updated_at'],
      nextAction: 'you can now use the table with the POST /api/database/tables/{table} endpoint',
    };
  }

  /**
   * Get table schema
   */
  async getTableSchema(table: string): Promise<GetTableSchemaResponse> {
    const db = this.dbManager.getAppDb();

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
    const { row_count } = await db.prepare(`SELECT COUNT(*) as row_count FROM ${table}`).get();

    return {
      table_name: table,
      columns: columns.map((col: ColumnInfo) => ({
        name: col.column_name,
        type: convertSqlTypeToColumnType(col.data_type),
        nullable: col.is_nullable === 'YES',
        primary_key: pkSet.has(col.column_name),
        is_unique: pkSet.has(col.column_name) || uniqueSet.has(col.column_name),
        default_value: col.column_default ?? undefined,
        ...(foreignKeyMap.has(col.column_name) && {
          foreign_key: foreignKeyMap.get(col.column_name),
        }),
      })),
      record_count: row_count,
    };
  }

  /**
   * Update table schema
   */
  async updateTableSchema(
    table: string,
    operations: UpdateTableSchemaRequest
  ): Promise<UpdateTableSchemaResponse> {
    const { add_columns, drop_columns, rename_columns, add_fkey_columns, drop_fkey_columns } =
      operations;

    // Prevent modification of system tables
    if (table.startsWith('_')) {
      throw new AppError(
        'System tables cannot be modified',
        403,
        ERROR_CODES.DATABASE_FORBIDDEN,
        'System tables cannot be modified. System tables are prefixed with underscore.'
      );
    }

    const db = this.dbManager.getAppDb();

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
      .get(table);

    if (!tableExists?.exists) {
      throw new AppError(
        'table not found',
        404,
        ERROR_CODES.DATABASE_NOT_FOUND,
        'Please check the table name, it must be a valid table name, or you can create a new table with the POST /api/database/tables endpoint'
      );
    }

    const tableColumns = await db
      .prepare(
        `
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ?
        `
      )
      .all(table);
    const columnSet = new Set(tableColumns.map((c: { column_name: string }) => c.column_name));

    // Create a working copy of columnSet to track state changes during validation
    const workingColumnSet = new Set(columnSet);

    // Get foreign key information
    const foreignKeyMap = await this.getFkeyConstraints(table);

    // Validate all operations before executing
    this.validateTableOperations(
      { add_columns, drop_columns, rename_columns, add_fkey_columns, drop_fkey_columns },
      columnSet,
      workingColumnSet,
      foreignKeyMap,
      table
    );

    const completedOperations: string[] = [];

    // Execute operations
    // Drop columns first (to avoid conflicts with renames)
    if (drop_columns && Array.isArray(drop_columns)) {
      for (const col of drop_columns) {
        await db
          .prepare(
            `
              ALTER TABLE ${this.quoteIdentifier(table)} 
              DROP COLUMN ${this.quoteIdentifier(col.name)}
            `
          )
          .exec();

        completedOperations.push(`Dropped column: ${col.name}`);
      }
    }

    // Add new columns
    if (add_columns && Array.isArray(add_columns)) {
      // Validate and filter reserved fields
      const columnsToAdd = this.validateReservedFields(add_columns);

      for (const col of columnsToAdd) {
        const fieldType = COLUMN_TYPES[col.type as ColumnType];
        let sqlType = fieldType.sqlType;
        if (col.type === ColumnType.UUID) {
          sqlType = 'UUID';
        }

        const nullable = col.nullable !== false ? '' : 'NOT NULL';
        let defaultClause = '';

        if (col.default_value !== undefined) {
          defaultClause = `DEFAULT ${col.default_value}`;
        } else if (col.nullable === false && fieldType.defaultValue) {
          if (fieldType.defaultValue === 'gen_random_uuid()' && ColumnType.UUID) {
            defaultClause = 'DEFAULT gen_random_uuid()';
          } else {
            defaultClause = `DEFAULT ${fieldType.defaultValue}`;
          }
        }
        if (col.foreign_key) {
          // Add foreign key constraint
          const fkeyConstraints = this.generateFkeyConstraintStatement(col, false);
          if (fkeyConstraints) {
            defaultClause += ` ${fkeyConstraints}`;
          }
        }

        await db
          .prepare(
            `
              ALTER TABLE ${this.quoteIdentifier(table)} 
              ADD COLUMN ${this.quoteIdentifier(col.name)} ${sqlType} ${nullable} ${defaultClause}
            `
          )
          .exec();

        completedOperations.push(`Added column: ${col.name}`);
      }
    }

    // Rename columns
    if (rename_columns && typeof rename_columns === 'object') {
      for (const [oldName, newName] of Object.entries(rename_columns)) {
        await db
          .prepare(
            `
              ALTER TABLE ${this.quoteIdentifier(table)} 
              RENAME COLUMN ${this.quoteIdentifier(oldName)} TO ${this.quoteIdentifier(newName as string)}
            `
          )
          .exec();

        completedOperations.push(`Renamed column: ${oldName} → ${newName}`);
      }
    }

    // Add foreign key constraints
    if (add_fkey_columns && Array.isArray(add_fkey_columns)) {
      for (const col of add_fkey_columns) {
        const fkeyConstraint = this.generateFkeyConstraintStatement(col, true);
        await db
          .prepare(
            `
              ALTER TABLE ${this.quoteIdentifier(table)} 
              ADD ${fkeyConstraint}
            `
          )
          .exec();

        completedOperations.push(`Added foreign key constraint on column: ${col.name}`);
      }
    }

    // Drop foreign key constraints
    if (drop_fkey_columns && Array.isArray(drop_fkey_columns)) {
      for (const col of drop_fkey_columns) {
        const constraintName = foreignKeyMap.get(col.name)?.constraint_name;
        if (constraintName) {
          await db
            .prepare(
              `
                ALTER TABLE ${this.quoteIdentifier(table)} 
                DROP CONSTRAINT ${this.quoteIdentifier(constraintName)}
              `
            )
            .exec();

          completedOperations.push(`Dropped foreign key constraint on column: ${col.name}`);
        }
      }
    }

    // Update metadata after schema changes
    await this.metadataService.updateDatabaseMetadata();

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
      table_name: table,
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

    const db = this.dbManager.getAppDb();
    await db.prepare(`DROP TABLE IF EXISTS ${this.quoteIdentifier(table)} CASCADE`).run();

    // Update metadata
    await this.metadataService.updateDatabaseMetadata();

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
      table_name: table,
      nextAction:
        'table deleted successfully, you can create a new table with the POST /api/database/tables endpoint',
    };
  }

  // Helper methods
  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private validateReservedFields(columns: ColumnSchema[]): ColumnSchema[] {
    const reservedFields = {
      id: ColumnType.UUID,
      created_at: ColumnType.DATETIME,
      updated_at: ColumnType.DATETIME,
    };
    return columns.filter((col: ColumnSchema) => {
      const reservedType = reservedFields[col.name as keyof typeof reservedFields];
      if (reservedType) {
        // If it's a reserved field name
        if (col.type === reservedType) {
          // Type matches - silently ignore this column
          return false;
        } else {
          // Type doesn't match - throw error
          throw new AppError(
            `Column '${col.name}' is a reserved field that requires type '${reservedType}', but got '${col.type}'`,
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
    col: { name: string; foreign_key?: ForeignKeySchema },
    include_source_column: boolean = true
  ) {
    if (!col.foreign_key) {
      return '';
    }
    // Store foreign_key in a const to avoid repeated non-null assertions
    const fk = col.foreign_key;
    const constraintName = `fk_${col.name}_${fk.reference_table}_${fk.reference_column}`;
    const onDelete = fk.on_delete || 'RESTRICT';
    const onUpdate = fk.on_update || 'RESTRICT';

    if (include_source_column) {
      return `CONSTRAINT ${this.quoteIdentifier(constraintName)} FOREIGN KEY (${this.quoteIdentifier(col.name)}) REFERENCES ${this.quoteIdentifier(fk.reference_table)}(${this.quoteIdentifier(fk.reference_column)}) ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
    } else {
      return `CONSTRAINT ${this.quoteIdentifier(constraintName)} REFERENCES ${this.quoteIdentifier(fk.reference_table)}(${this.quoteIdentifier(fk.reference_column)}) ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
    }
  }

  private async getFkeyConstraints(table: string): Promise<Map<string, ForeignKeyInfo>> {
    const db = this.dbManager.getAppDb();
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
      foreignKeyMap.set(fk.from_column, {
        constraint_name: fk.constraint_name,
        reference_table: fk.foreign_table,
        reference_column: fk.foreign_column,
        on_delete: fk.on_delete as OnDeleteActionSchema,
        on_update: fk.on_update as OnUpdateActionSchema,
      });
    });
    return foreignKeyMap;
  }

  private validateTableOperations(
    operations: {
      add_columns?: unknown;
      drop_columns?: unknown;
      rename_columns?: unknown;
      add_fkey_columns?: unknown;
      drop_fkey_columns?: unknown;
    },
    columnSet: Set<string>,
    workingColumnSet: Set<string>,
    foreignKeyMap: Map<string, ForeignKeyInfo>,
    table: string
  ) {
    const { add_columns, drop_columns, rename_columns, add_fkey_columns, drop_fkey_columns } =
      operations;

    if (add_fkey_columns && Array.isArray(add_fkey_columns)) {
      for (const col of add_fkey_columns) {
        // Zod already validates that name and foreign_key fields are present
        if (foreignKeyMap.has(col.name)) {
          throw new AppError(
            `Foreigh Key on Column(${col.name}) already exists`,
            400,
            ERROR_CODES.DATABASE_VALIDATION_ERROR,
            `Foreigh Key on Column(${col.name}) already exists. Please check the schema with GET /api/database/tables/${table}/schema endpoint.`
          );
        }
      }
    }

    if (drop_fkey_columns && Array.isArray(drop_fkey_columns)) {
      for (const col of drop_fkey_columns) {
        // Zod already validates that name is present
        if (!columnSet.has(col.name)) {
          throw new AppError(
            `Column(${col.name}) not found`,
            404,
            ERROR_CODES.DATABASE_NOT_FOUND,
            `Column(${col.name}) not found. Please check the schema with GET /api/tables/${table}/schema endpoint.`
          );
        }
        if (!foreignKeyMap.has(col.name)) {
          throw new AppError(
            `Foreign Key Constraint on Column(${col.name}) not found`,
            404,
            ERROR_CODES.DATABASE_NOT_FOUND,
            `Foreign Key Constraint on Column(${col.name}) not found. Please check the schema with GET /api/tables/${table}/schema endpoint.`
          );
        }
      }
    }

    // First, validate and simulate drop columns (these happen first)
    if (drop_columns && Array.isArray(drop_columns)) {
      for (const col of drop_columns) {
        // Zod already validates that name is present
        if (!workingColumnSet.has(col.name)) {
          throw new AppError(
            `Column(${col.name}) not found`,
            404,
            ERROR_CODES.DATABASE_NOT_FOUND,
            `Column(${col.name}) not found. Please check the schema with GET /api/database/tables/${table}/schema endpoint.`
          );
        }
        // Remove from working set to simulate the drop
        workingColumnSet.delete(col.name);
      }
    }

    if (add_columns && Array.isArray(add_columns)) {
      for (const col of add_columns) {
        // Zod already validates column name, type, and that type is valid

        if (workingColumnSet.has(col.name)) {
          throw new AppError(
            `Column(${col.name}) already exists`,
            400,
            ERROR_CODES.DATABASE_VALIDATION_ERROR,
            `Column(${col.name}) already exists. Please check the schema with GET /api/database/tables/${table}/schema endpoint.`
          );
        }
        // Add to working set to simulate the add
        workingColumnSet.add(col.name);
      }
    }

    if (rename_columns && typeof rename_columns === 'object') {
      for (const [oldName, newName] of Object.entries(rename_columns)) {
        // Zod validates that rename_columns is a record of strings
        if (!workingColumnSet.has(oldName)) {
          throw new AppError(
            `Column(${oldName}) not found`,
            404,
            ERROR_CODES.DATABASE_NOT_FOUND,
            `Column(${oldName}) not found. Please check the schema with GET /api/database/tables/${table}/schema endpoint.`
          );
        }
        if (workingColumnSet.has(newName as string)) {
          throw new AppError(
            `Column(${newName}) already exists`,
            400,
            ERROR_CODES.DATABASE_VALIDATION_ERROR,
            `Column(${newName}) already exists. Please check the schema with GET /api/database/tables/${table}/schema endpoint.`
          );
        }
        // Simulate the rename
        workingColumnSet.delete(oldName);
        workingColumnSet.add(newName as string);
      }
    }
  }
}
