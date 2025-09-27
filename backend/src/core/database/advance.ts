import { DatabaseManager } from '@/core/database/manager.js';
import { AppError } from '@/api/middleware/error.js';
import {
  type RawSQLResponse,
  type ExportDatabaseResponse,
  type ExportDatabaseJsonData,
  type ImportDatabaseResponse,
  type BulkUpsertResponse,
  type DatabaseMetadataSchema,
  type TableSchema,
  type ColumnSchema,
  type OnDeleteActionSchema,
  type OnUpdateActionSchema,
} from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { ERROR_CODES } from '@/types/error-constants';
import { parseSQLStatements } from '@/utils/sql-parser.js';
import { convertSqlTypeToColumnType } from '@/utils/helpers.js';
import { validateTableName } from '@/utils/validations.js';
import format from 'pg-format';
import { parse } from 'csv-parse/sync';

export class DatabaseAdvanceService {
  private dbManager = DatabaseManager.getInstance();

  /**
   * Get table data using simple SELECT query
   * More reliable than streaming for moderate datasets
   */
  private async getTableData(
    client: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    table: string,
    rowLimit: number | undefined
  ): Promise<{ rows: Record<string, unknown>[]; totalRows: number; wasTruncated: boolean }> {
    const query = rowLimit ? `SELECT * FROM ${table} LIMIT ${rowLimit}` : `SELECT * FROM ${table}`;

    let wasTruncated = false;
    let totalRows = 0;

    // Check for truncation upfront if rowLimit is set
    if (rowLimit) {
      try {
        const countResult = await client.query(`SELECT COUNT(*) FROM ${table}`);
        totalRows = parseInt(countResult.rows[0].count);
        wasTruncated = totalRows > rowLimit;
      } catch (err) {
        logger.error('Error counting rows:', err);
      }
    }

    const result = await client.query(query);
    const rows = result.rows || [];

    if (!rowLimit) {
      totalRows = rows.length;
    }

    return { rows, totalRows, wasTruncated };
  }

  private sanitizeQuery(query: string): string {
    // Basic SQL injection prevention - check for dangerous patterns
    const dangerousPatterns = [
      /DROP\s+DATABASE/i,
      /CREATE\s+DATABASE/i,
      /ALTER\s+DATABASE/i,
      /pg_catalog/i,
      /information_schema/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(query)) {
        throw new AppError('Query contains restricted operations', 403, ERROR_CODES.FORBIDDEN);
      }
    }

    // Check for system table operations (tables starting with underscore)
    // This pattern checks each statement in multi-statement queries, including schema-qualified names
    const systemTablePattern =
      /(?:^|\n|;)\s*(?:CREATE|ALTER|DROP|INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+(?:TABLE\s+)?(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:\w+\.)?["']?_\w+/im;
    if (systemTablePattern.test(query)) {
      throw new AppError(
        'Cannot modify or create system tables (tables starting with underscore)',
        403,
        ERROR_CODES.FORBIDDEN
      );
    }

    // Check for RENAME TO system table
    const renameToSystemTablePattern = /RENAME\s+TO\s+(?:\w+\.)?["']?_\w+/im;
    if (renameToSystemTablePattern.test(query)) {
      throw new AppError(
        'Cannot rename tables to system table names (tables starting with underscore)',
        403,
        ERROR_CODES.FORBIDDEN
      );
    }

    return query;
  }

  async executeRawSQL(input_query: string, params: unknown[] = []): Promise<RawSQLResponse> {
    const query = this.sanitizeQuery(input_query);
    const pool = this.dbManager.getPool();
    const client = await pool.connect();

    try {
      // Execute query with timeout
      const result = (await Promise.race([
        client.query(query, params),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 30000)),
      ])) as { rows: unknown[]; rowCount: number; fields?: { name: string; dataTypeID: number }[] };

      // Refresh schema cache if it was a DDL operation
      if (/CREATE|ALTER|DROP/i.test(query)) {
        await client.query(`NOTIFY pgrst, 'reload schema';`);
        // Metadata is now updated on-demand
      }

      const response: RawSQLResponse = {
        rows: result.rows || [],
        rowCount: result.rowCount,
        fields: result.fields?.map((field: { name: string; dataTypeID: number }) => ({
          name: field.name,
          dataTypeID: field.dataTypeID,
        })),
      };

      return response;
    } finally {
      client.release();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async exportTableSchemaBySQL(client: any, table: string): Promise<string> {
    let sqlExport = '';
    // Always export table schema with defaults
    const schemaResult = await client.query(
      `
      SELECT 'CREATE TABLE IF NOT EXISTS ' || table_name || ' (' ||
      string_agg(column_name || ' ' || 
        CASE 
          WHEN data_type = 'character varying' THEN 'varchar' || COALESCE('(' || character_maximum_length || ')', '')
          WHEN data_type = 'timestamp with time zone' THEN 'timestamptz'
          ELSE data_type
        END || 
        CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
        CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END,
        ', ') || ');' as create_statement
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1
      GROUP BY table_name
    `,
      [table]
    );

    if (schemaResult.rows.length > 0) {
      sqlExport += `-- Table: ${table}\n`;
      sqlExport += schemaResult.rows[0].create_statement + '\n\n';
    }

    // Export indexes (excluding primary key indexes)
    const indexesResult = await client.query(
      `
      SELECT 
        indexname,
        indexdef
      FROM pg_indexes 
      WHERE tablename = $1 
      AND schemaname = 'public'
      AND indexname NOT LIKE '%_pkey'
      ORDER BY indexname
    `,
      [table]
    );

    if (indexesResult.rows.length > 0) {
      sqlExport += `-- Indexes for table: ${table}\n`;
      for (const indexRow of indexesResult.rows) {
        sqlExport += indexRow.indexdef + ';\n';
      }
      sqlExport += '\n';
    }

    // Export foreign key constraints
    const foreignKeysResult = await client.query(
      `
      SELECT DISTINCT
        'ALTER TABLE ' || quote_ident(tc.table_name) ||
        ' ADD CONSTRAINT ' || quote_ident(tc.constraint_name) ||
        ' FOREIGN KEY (' || quote_ident(kcu.column_name) || ')' ||
        ' REFERENCES ' || quote_ident(ccu.table_name) ||
        ' (' || quote_ident(ccu.column_name) || ')' ||
        CASE
          WHEN rc.delete_rule != 'NO ACTION' THEN ' ON DELETE ' || rc.delete_rule
          ELSE ''
        END ||
        CASE
          WHEN rc.update_rule != 'NO ACTION' THEN ' ON UPDATE ' || rc.update_rule
          ELSE ''
        END || ';' as fk_statement,
        tc.constraint_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND kcu.table_name = tc.table_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      LEFT JOIN information_schema.referential_constraints AS rc
        ON tc.constraint_name = rc.constraint_name
        AND tc.table_schema = rc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = $1
      AND tc.table_schema = 'public'
      ORDER BY tc.constraint_name
    `,
      [table]
    );

    if (foreignKeysResult.rows.length > 0) {
      sqlExport += `-- Foreign key constraints for table: ${table}\n`;
      for (const fkRow of foreignKeysResult.rows) {
        sqlExport += fkRow.fk_statement + '\n';
      }
      sqlExport += '\n';
    }

    // Check if RLS is enabled on the table
    const rlsResult = await client.query(
      `
          SELECT relrowsecurity 
          FROM pg_class 
          WHERE relname = $1
          AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        `,
      [table]
    );
    const rlsEnabled =
      rlsResult.rows.length > 0 &&
      (rlsResult.rows[0].relrowsecurity === true || rlsResult.rows[0].relrowsecurity === 1);
    if (rlsEnabled) {
      sqlExport += `-- RLS enabled for table: ${table}\n`;
      sqlExport += `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;\n\n`;
    }

    // Export RLS policies
    const policiesResult = await client.query(
      `
      SELECT 
        'CREATE POLICY ' || quote_ident(policyname) || ' ON ' || quote_ident(tablename) ||
        ' FOR ' || cmd ||
        CASE 
          WHEN roles != '{}'::name[] THEN ' TO ' || array_to_string(roles, ', ')
          ELSE ''
        END ||
        CASE 
          WHEN qual IS NOT NULL THEN ' USING (' || qual || ')'
          ELSE ''
        END ||
        CASE 
          WHEN with_check IS NOT NULL THEN ' WITH CHECK (' || with_check || ')'
          ELSE ''
        END || ';' as policy_statement
      FROM pg_policies 
      WHERE schemaname = 'public' AND tablename = $1
      ORDER BY policyname
    `,
      [table]
    );

    if (policiesResult.rows.length > 0) {
      sqlExport += `-- RLS policies for table: ${table}\n`;
      for (const policyRow of policiesResult.rows) {
        sqlExport += policyRow.policy_statement + '\n';
      }
      sqlExport += '\n';
    }

    // Export triggers for this table
    const triggersResult = await client.query(
      `
      SELECT 
        'CREATE TRIGGER ' || quote_ident(trigger_name) || 
        ' ' || action_timing || ' ' || event_manipulation ||
        ' ON ' || quote_ident(event_object_table) ||
        CASE 
          WHEN action_reference_new_table IS NOT NULL OR action_reference_old_table IS NOT NULL 
          THEN ' REFERENCING ' ||
            CASE WHEN action_reference_new_table IS NOT NULL 
              THEN 'NEW TABLE AS ' || quote_ident(action_reference_new_table) 
              ELSE '' 
            END ||
            CASE WHEN action_reference_old_table IS NOT NULL 
              THEN ' OLD TABLE AS ' || quote_ident(action_reference_old_table) 
              ELSE '' 
            END
          ELSE ''
        END ||
        ' FOR EACH ' || action_orientation ||
        CASE 
          WHEN action_condition IS NOT NULL 
          THEN ' WHEN (' || action_condition || ')'
          ELSE ''
        END ||
        ' ' || action_statement || ';' as trigger_statement
      FROM information_schema.triggers
      WHERE event_object_schema = 'public' 
      AND event_object_table = $1
      ORDER BY trigger_name
    `,
      [table]
    );

    if (triggersResult.rows.length > 0) {
      sqlExport += `-- Triggers for table: ${table}\n`;
      for (const triggerRow of triggersResult.rows) {
        sqlExport += triggerRow.trigger_statement + '\n';
      }
      sqlExport += '\n';
    }
    return sqlExport;
  }

  async exportDatabase(
    tables?: string[],
    format: 'sql' | 'json' = 'sql',
    includeData: boolean = true,
    includeFunctions: boolean = false,
    includeSequences: boolean = false,
    includeViews: boolean = false,
    rowLimit?: number
  ): Promise<ExportDatabaseResponse> {
    const pool = this.dbManager.getPool();
    const client = await pool.connect();

    try {
      // Get tables to export
      let tablesToExport: string[];
      if (tables && tables.length > 0) {
        tablesToExport = tables;
      } else {
        const tablesResult = await client.query(`
          SELECT tablename 
          FROM pg_tables 
          WHERE schemaname = 'public' 
          ORDER BY tablename
        `);
        tablesToExport = tablesResult.rows.map((row: { tablename: string }) => row.tablename);
      }
      logger.info(
        `Exporting tables: ${tablesToExport.join(', ')}, format: ${format}, includeData: ${includeData}, includeFunctions: ${includeFunctions}, includeSequences: ${includeSequences}, includeViews: ${includeViews}, rowLimit: ${rowLimit}`
      );

      const timestamp = new Date().toISOString();
      const truncatedTables: string[] = [];

      if (format === 'sql') {
        let sqlExport = `-- Database Export\n-- Generated on: ${timestamp}\n-- Format: SQL\n-- Include Data: ${includeData}\n`;
        if (rowLimit) {
          sqlExport += `-- Row Limit: ${rowLimit} rows per table\n`;
        }
        sqlExport += '\n';

        for (const table of tablesToExport) {
          sqlExport += await this.exportTableSchemaBySQL(client, table);

          // Export data if requested - using simple SELECT query
          if (includeData) {
            let tableDataSql = '';

            const { rows, wasTruncated } = await this.getTableData(client, table, rowLimit);

            if (rows.length > 0) {
              tableDataSql += `-- Data for table: ${table}\n`;

              for (const row of rows) {
                const columns = Object.keys(row);
                const values = Object.values(row).map((val) => {
                  if (val === null) {
                    return 'NULL';
                  } else if (typeof val === 'string') {
                    return `'${val.replace(/'/g, "''")}'`;
                  } else if (val instanceof Date) {
                    return `'${val.toISOString()}'`;
                  } else if (typeof val === 'object') {
                    // Handle JSON/JSONB columns
                    return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
                  } else if (typeof val === 'boolean') {
                    return val ? 'true' : 'false';
                  } else {
                    return String(val);
                  }
                });
                tableDataSql += `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});\n`;
              }
            }

            if (wasTruncated) {
              const countResult = await client.query(`SELECT COUNT(*) FROM ${table}`);
              const totalRowsInTable = parseInt(countResult.rows[0].count);
              tableDataSql =
                `-- WARNING: Table contains ${totalRowsInTable} rows, but only ${rowLimit} rows exported due to row limit\n` +
                tableDataSql;
              truncatedTables.push(table);
            }

            if (tableDataSql) {
              sqlExport += tableDataSql + '\n';
            }
          }
        }

        // Export all functions in public schema
        if (includeFunctions) {
          const functionsResult = await client.query(`
            SELECT 
              pg_get_functiondef(p.oid) || ';' as function_def,
              p.proname as function_name
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
              AND p.prokind IN ('f', 'p', 'w')  -- functions, procedures, window functions
              AND NOT EXISTS (
                SELECT 1 FROM pg_depend d
                JOIN pg_extension e ON d.refobjid = e.oid
                WHERE d.objid = p.oid
              )  -- Exclude extension functions
            ORDER BY p.proname
          `);

          if (functionsResult.rows.length > 0) {
            sqlExport += `-- Functions and Procedures\n`;
            for (const funcRow of functionsResult.rows) {
              sqlExport += `-- Function: ${funcRow.function_name}\n`;
              sqlExport += funcRow.function_def + '\n\n';
            }
          }
        }

        // Export all sequences in public schema
        if (includeSequences) {
          const sequencesResult = await client.query(`
            SELECT 
              'CREATE SEQUENCE IF NOT EXISTS ' || quote_ident(sequence_name) ||
              ' START WITH ' || start_value ||
              ' INCREMENT BY ' || increment ||
              CASE WHEN minimum_value IS NOT NULL THEN ' MINVALUE ' || minimum_value ELSE ' NO MINVALUE' END ||
              CASE WHEN maximum_value IS NOT NULL THEN ' MAXVALUE ' || maximum_value ELSE ' NO MAXVALUE' END ||
              CASE WHEN cycle_option = 'YES' THEN ' CYCLE' ELSE ' NO CYCLE' END ||
              ';' as sequence_statement,
              sequence_name
            FROM information_schema.sequences
            WHERE sequence_schema = 'public'
            ORDER BY sequence_name
          `);

          if (sequencesResult.rows.length > 0) {
            sqlExport += `-- Sequences\n`;
            for (const seqRow of sequencesResult.rows) {
              sqlExport += seqRow.sequence_statement + '\n';
            }
            sqlExport += '\n';
          }
        }

        // Export all views in public schema
        if (includeViews) {
          const viewsResult = await client.query(`
            SELECT 
              'CREATE OR REPLACE VIEW ' || quote_ident(table_name) || ' AS ' || 
              view_definition as view_statement,
              table_name as view_name
            FROM information_schema.views
            WHERE table_schema = 'public'
            ORDER BY table_name
          `);

          if (viewsResult.rows.length > 0) {
            sqlExport += `-- Views\n`;
            for (const viewRow of viewsResult.rows) {
              sqlExport += `-- View: ${viewRow.view_name}\n`;
              sqlExport += viewRow.view_statement + '\n\n';
            }
          }
        }

        return {
          format: 'sql',
          data: sqlExport,
          timestamp,
          ...(truncatedTables.length > 0 && {
            truncatedTables,
            rowLimit,
          }),
        };
      } else {
        // JSON format
        const jsonData: ExportDatabaseJsonData = {
          timestamp,
          tables: {},
          functions: [],
          sequences: [],
          views: [],
        };

        for (const table of tablesToExport) {
          // Get schema
          const schemaResult = await client.query(
            `
            SELECT 
              column_name as "columnName",
              data_type as "dataType", 
              character_maximum_length as "characterMaximumLength",
              is_nullable as "isNullable",
              column_default as "columnDefault"
            FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
          `,
            [table]
          );

          // Get indexes
          const indexesResult = await client.query(
            `
            SELECT DISTINCT
              pi.indexname,
              pi.indexdef,
              idx.indisunique as "isUnique",
              idx.indisprimary as "isPrimary"
            FROM pg_indexes pi
            JOIN pg_class cls ON cls.relname = pi.indexname
              AND cls.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = pi.schemaname)
            JOIN pg_index idx ON idx.indexrelid = cls.oid
            WHERE pi.tablename = $1
            AND pi.schemaname = 'public'
            ORDER BY pi.indexname
          `,
            [table]
          );

          // Get foreign keys
          const foreignKeysResult = await client.query(
            `
            SELECT DISTINCT
              tc.constraint_name as "constraintName",
              kcu.column_name as "columnName",
              ccu.table_name as "foreignTableName",
              ccu.column_name as "foreignColumnName",
              rc.delete_rule as "deleteRule",
              rc.update_rule as "updateRule"
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
              AND kcu.table_name = tc.table_name
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            LEFT JOIN information_schema.referential_constraints AS rc
              ON tc.constraint_name = rc.constraint_name
              AND tc.table_schema = rc.constraint_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_name = $1
            AND tc.table_schema = 'public'
            ORDER BY "constraintName", "columnName"
          `,
            [table]
          );

          // Check if RLS is enabled on the table
          const rlsResult = await client.query(
            `
                SELECT relrowsecurity 
                FROM pg_class 
                WHERE relname = $1
                AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
              `,
            [table]
          );

          const rlsEnabled =
            rlsResult.rows.length > 0 &&
            (rlsResult.rows[0].relrowsecurity === true || rlsResult.rows[0].relrowsecurity === 1);

          // Get policies
          const policiesResult = await client.query(
            `
            SELECT 
              policyname,
              cmd,
              roles,
              qual,
              with_check as "withCheck"
            FROM pg_policies 
            WHERE schemaname = 'public' AND tablename = $1
          `,
            [table]
          );

          // Get triggers
          const triggersResult = await client.query(
            `
            SELECT 
              trigger_name as "triggerName",
              action_timing as "actionTiming",
              event_manipulation as "eventManipulation",
              action_orientation as "actionOrientation",
              action_condition as "actionCondition",
              action_statement as "actionStatement",
              action_reference_new_table as "newTable",
              action_reference_old_table as "oldTable"
            FROM information_schema.triggers
            WHERE event_object_schema = 'public' 
            AND event_object_table = $1
            ORDER BY trigger_name
          `,
            [table]
          );

          // Get data if requested - using streaming to avoid memory issues
          const rows: unknown[] = [];
          let truncated = false;
          let totalRowCount: number | undefined;

          if (includeData) {
            const tableData = await this.getTableData(client, table, rowLimit);

            rows.push(...tableData.rows);
            truncated = tableData.wasTruncated;

            if (truncated) {
              totalRowCount = tableData.totalRows;
              truncatedTables.push(table);
            }
          }

          jsonData.tables[table] = {
            schema: schemaResult.rows,
            indexes: indexesResult.rows,
            foreignKeys: foreignKeysResult.rows,
            rlsEnabled,
            policies: policiesResult.rows,
            triggers: triggersResult.rows,
            rows,
            ...(truncated && {
              truncated: true,
              exportedRowCount: rows.length,
              totalRowCount,
            }),
          };
        }

        // Get all functions
        if (includeFunctions) {
          const functionsResult = await client.query(`
            SELECT 
              p.proname as "functionName",
              pg_get_functiondef(p.oid) as "functionDef",
              p.prokind as "kind"
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
              AND p.prokind IN ('f', 'p', 'w')
              AND NOT EXISTS (
                SELECT 1 FROM pg_depend d
                JOIN pg_extension e ON d.refobjid = e.oid
                WHERE d.objid = p.oid
              )
            ORDER BY p.proname
          `);
          jsonData.functions = functionsResult.rows;
        }

        // Get all sequences
        if (includeSequences) {
          const sequencesResult = await client.query(`
            SELECT 
              sequence_name as "sequenceName",
              start_value as "startValue",
              increment as "increment",
              minimum_value as "minValue",
              maximum_value as "maxValue",
              cycle_option as "cycle"
            FROM information_schema.sequences
            WHERE sequence_schema = 'public'
            ORDER BY sequence_name
          `);
          jsonData.sequences = sequencesResult.rows;
        }

        // Get all views
        if (includeViews) {
          const viewsResult = await client.query(`
            SELECT 
              table_name as "viewName",
              view_definition as "definition"
            FROM information_schema.views
            WHERE table_schema = 'public'
            ORDER BY table_name
          `);
          jsonData.views = viewsResult.rows;
        }

        return {
          format: 'json',
          data: jsonData,
          timestamp,
          ...(truncatedTables.length > 0 && {
            truncatedTables,
            rowLimit,
          }),
        };
      }
    } finally {
      client.release();
    }
  }

  async importDatabase(
    fileBuffer: Buffer,
    filename: string,
    fileSize: number,
    truncate: boolean = false
  ): Promise<ImportDatabaseResponse> {
    // Validate file type
    const allowedExtensions = ['.sql', '.txt'];
    const fileExtension = filename.toLowerCase().substring(filename.lastIndexOf('.'));

    if (!allowedExtensions.includes(fileExtension)) {
      throw new AppError('Only .sql/.txt files are allowed', 400, ERROR_CODES.INVALID_INPUT);
    }

    // Convert buffer to string
    const raw_data = fileBuffer.toString('utf-8');
    const data = this.sanitizeQuery(raw_data);
    const pool = this.dbManager.getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const importedTables: string[] = [];
      let totalRows = 0;

      // If truncate is requested, truncate all public tables first
      if (truncate) {
        const tablesResult = await client.query(`
          SELECT tablename 
          FROM pg_tables 
          WHERE schemaname = 'public'
        `);

        for (const row of tablesResult.rows) {
          try {
            await client.query(`TRUNCATE TABLE ${row.tablename} CASCADE`);
            logger.info(`Truncated table: ${row.tablename}`);
          } catch (err) {
            logger.warn(`Could not truncate table ${row.tablename}:`, err);
          }
        }
      }

      // Process SQL file using our SQL parser utility
      let statements: string[] = [];

      try {
        statements = parseSQLStatements(data);
        logger.info(`Parsed ${statements.length} SQL statements from import file`);
      } catch (parseError) {
        logger.warn('Failed to parse SQL file:', parseError);
        throw new AppError(
          'Invalid SQL file format. Please ensure the file contains valid SQL statements.',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      for (const statement of statements) {
        // Basic validation to prevent dangerous operations
        this.sanitizeQuery(statement);

        try {
          const result = await client.query(statement);

          // Track INSERT operations
          if (statement.toUpperCase().startsWith('INSERT')) {
            totalRows += result.rowCount || 0;

            // Extract table name from INSERT statement
            const tableMatch = statement.match(/INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
            if (tableMatch && !importedTables.includes(tableMatch[1])) {
              importedTables.push(tableMatch[1]);
            }
          }

          // Track CREATE TABLE operations
          if (statement.toUpperCase().includes('CREATE TABLE')) {
            // Extract table name from CREATE TABLE statement
            const tableMatch = statement.match(
              /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)/i
            );
            if (tableMatch && !importedTables.includes(tableMatch[1])) {
              importedTables.push(tableMatch[1]);
            }
          }
        } catch (err: unknown) {
          logger.warn(`Failed to execute statement: ${statement.substring(0, 100)}...`, err);
          throw new AppError(
            `Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
            400,
            ERROR_CODES.INVALID_INPUT
          );
        }
      }

      await client.query(`NOTIFY pgrst, 'reload schema';`);
      await client.query('COMMIT');
      // Metadata is now updated on-demand

      return {
        success: true,
        message: 'SQL file imported successfully',
        filename,
        tables: importedTables,
        rowsImported: totalRows,
        fileSize,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async bulkUpsertFromFile(
    table: string,
    fileBuffer: Buffer,
    filename: string,
    upsertKey?: string
  ): Promise<BulkUpsertResponse> {
    validateTableName(table);

    const fileExtension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    let records: Record<string, unknown>[] = [];

    // Parse file based on type
    try {
      if (fileExtension === '.csv') {
        records = parse(fileBuffer, {
          columns: true,
          skip_empty_lines: true,
        });
      } else if (fileExtension === '.json') {
        const jsonContent = fileBuffer.toString('utf-8');
        const parsed = JSON.parse(jsonContent);
        records = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        throw new AppError(
          'Unsupported file type. Use .csv or .json',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
    } catch (parseError) {
      if (parseError instanceof AppError) {
        throw parseError;
      }
      throw new AppError(
        `Failed to parse ${fileExtension} file: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    if (!records || records.length === 0) {
      throw new AppError('No records found in file', 400, ERROR_CODES.INVALID_INPUT);
    }

    // Perform the bulk insert
    const result = await this.bulkInsert(table, records, upsertKey);

    return {
      success: true,
      message: `Successfully inserted ${result.rowCount} rows into ${table}`,
      table,
      rowsAffected: result.rowCount,
      totalRecords: records.length,
      filename,
    };
  }

  private async bulkInsert(
    table: string,
    records: Record<string, unknown>[],
    upsertKey?: string
  ): Promise<{ rowCount: number; rows?: unknown[] }> {
    if (!records || records.length === 0) {
      throw new AppError('No records to insert', 400, ERROR_CODES.INVALID_INPUT);
    }

    const pool = this.dbManager.getPool();
    const client = await pool.connect();

    try {
      // Get column names from first record
      const columns = Object.keys(records[0]);

      // Convert records to array format for pg-format
      const values = records.map((record) =>
        columns.map((col) => {
          const value = record[col];
          // pg-format handles NULL, dates, JSON automatically
          // Convert empty strings to NULL for consistency
          return value === '' ? null : value;
        })
      );

      let query: string;

      if (upsertKey) {
        // Validate upsert key exists in columns
        if (!columns.includes(upsertKey)) {
          throw new AppError(
            `Upsert key '${upsertKey}' not found in record columns`,
            400,
            ERROR_CODES.INVALID_INPUT
          );
        }

        // Build upsert query with pg-format
        const updateColumns = columns.filter((c) => c !== upsertKey);

        if (updateColumns.length > 0) {
          // Build UPDATE SET clause
          const updateClause = updateColumns
            .map((col) => format('%I = EXCLUDED.%I', col, col))
            .join(', ');

          query = format(
            'INSERT INTO %I (%I) VALUES %L ON CONFLICT (%I) DO UPDATE SET %s',
            table,
            columns,
            values,
            upsertKey,
            updateClause
          );
        } else {
          // No columns to update, just do nothing on conflict
          query = format(
            'INSERT INTO %I (%I) VALUES %L ON CONFLICT (%I) DO NOTHING',
            table,
            columns,
            values,
            upsertKey
          );
        }
      } else {
        // Simple insert
        query = format('INSERT INTO %I (%I) VALUES %L', table, columns, values);
      }

      // Execute query
      const result = await client.query(query);

      // Refresh schema cache if needed
      await client.query(`NOTIFY pgrst, 'reload schema';`);

      return {
        rowCount: result.rowCount || 0,
        rows: result.rows,
      };
    } catch (error) {
      // Log the error for debugging
      logger.error('Bulk insert error:', error);

      // Re-throw with better error message
      if (error instanceof AppError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Bulk insert failed';
      throw new AppError(message, 400, ERROR_CODES.INVALID_INPUT);
    } finally {
      client.release();
    }
  }

  /**
   * Get database metadata
   */
  async getMetadata(): Promise<DatabaseMetadataSchema> {
    const db = this.dbManager.getDb();

    // Get all tables excluding system tables (those starting with _)
    // Also exclude Better Auth system tables, except for user table
    const allTables = (await db
      .prepare(
        `
      SELECT table_name as name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND (table_name NOT LIKE '\\_%')
      ORDER BY table_name
    `
      )
      .all()) as { name: string }[];

    const tableMetadata: TableSchema[] = [];

    for (const table of allTables) {
      // Get comprehensive column information with constraints in a single query
      const columns = (await db
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
          SELECT DISTINCT kcu.column_name
          FROM information_schema.key_column_usage kcu
          JOIN information_schema.table_constraints tc
            ON kcu.constraint_name = tc.constraint_name
            AND kcu.table_schema = tc.table_schema
            AND kcu.table_name = tc.table_name
          WHERE tc.table_schema = 'public'
            AND tc.table_name = ?
            AND tc.constraint_type = 'PRIMARY KEY'
        ) pk ON c.column_name = pk.column_name
        LEFT JOIN (
          SELECT DISTINCT kcu.column_name
          FROM information_schema.key_column_usage kcu
          JOIN information_schema.table_constraints tc
            ON kcu.constraint_name = tc.constraint_name
            AND kcu.table_schema = tc.table_schema
            AND kcu.table_name = tc.table_name
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
      const foreignKeys = (await db
        .prepare(
          `
        SELECT DISTINCT
          kcu.column_name as from_column,
          ccu.table_name AS foreign_table,
          ccu.column_name AS foreign_column,
          rc.delete_rule as on_delete,
          rc.update_rule as on_update
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND kcu.table_name = tc.table_name
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
        const tableExists = (await db
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
          const countResult = (await db
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

    const databaseSize = await this.getDatabaseSizeInGB();

    return {
      tables: tableMetadata,
      totalSize: databaseSize,
    };
  }

  async getDatabaseSizeInGB(): Promise<number> {
    try {
      const db = this.dbManager.getDb();
      // Query PostgreSQL for database size
      const result = (await db
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
}
