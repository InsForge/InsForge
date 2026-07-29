import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError, hasPgErrorCode } from '@/utils/errors.js';
import {
  ERROR_CODES,
  type RawSQLResponse,
  type ExportDatabaseResponse,
  type ExportDatabaseJsonData,
  type ImportDatabaseResponse,
  type BulkUpsertResponse,
} from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import {
  checkSqlExecutionGuards,
  parseSQLStatements,
  checkSqlReadOnly,
} from '@/utils/sql-parser.js';
import { validateSchemaName, validateTableName } from '@/utils/validations.js';
import pgFormat from 'pg-format';
import { parse } from 'csv-parse/sync';
import { type PoolClient } from 'pg';
import { withAdminContext } from './user-context.service.js';
import type { ForeignKeyRow } from '@/types/database.js';
import { FOREIGN_KEY_INTROSPECTION_QUERY, groupForeignKeyRows } from './helpers.js';

export class DatabaseAdvanceService {
  private static instance: DatabaseAdvanceService;
  private dbManager = DatabaseManager.getInstance();

  private constructor() {}

  public static getInstance(): DatabaseAdvanceService {
    if (!DatabaseAdvanceService.instance) {
      DatabaseAdvanceService.instance = new DatabaseAdvanceService();
    }
    return DatabaseAdvanceService.instance;
  }

  /**
   * Get table data using simple SELECT query
   * More reliable than streaming for moderate datasets
   */
  private async getTableData(
    client: PoolClient,
    table: string,
    rowLimit: number | undefined
  ): Promise<{ rows: Record<string, unknown>[]; totalRows: number; wasTruncated: boolean }> {
    const safeTable = pgFormat('SELECT * FROM %I', table);
    const query = rowLimit ? `${safeTable} LIMIT $1` : safeTable;
    const queryParams: unknown[] = rowLimit ? [rowLimit] : [];

    let wasTruncated = false;
    let totalRows = 0;

    // Check for truncation upfront if rowLimit is set
    if (rowLimit) {
      try {
        const countResult = await client.query(pgFormat('SELECT COUNT(*) FROM %I', table));
        totalRows = parseInt(countResult.rows[0].count);
        wasTruncated = totalRows > rowLimit;
      } catch (err) {
        logger.error('Error counting rows:', err);
      }
    }

    const result = await client.query(query, queryParams);
    const rows = result.rows || [];

    if (!rowLimit) {
      totalRows = rows.length;
    }

    return { rows, totalRows, wasTruncated };
  }

  sanitizeQuery(query: string): string {
    const guardError = checkSqlExecutionGuards(query);
    if (guardError) {
      logger.warn('Blocked raw SQL operation', {
        query: query.substring(0, 100),
      });
      throw new AppError(guardError, 403, ERROR_CODES.FORBIDDEN);
    }

    return query;
  }

  async executeRawSQL(
    query: string,
    params: unknown[] = [],
    asRoot: boolean = false
  ): Promise<RawSQLResponse> {
    const sanitizedQuery = this.sanitizeQuery(query);
    const pool = this.dbManager.getPool();
    const client = await pool.connect();
    let releaseError: Error | undefined;

    try {
      // Set statement timeout at session level (30 seconds)
      await client.query('SET statement_timeout = 30000');

      const result = asRoot
        ? await client.query<Record<string, unknown>>(sanitizedQuery, params)
        : await withAdminContext(
            client,
            () => client.query<Record<string, unknown>>(sanitizedQuery, params),
            false,
            (error) => {
              releaseError = error;
            }
          );

      // Refresh schema cache if it was a DDL operation
      if (/CREATE|ALTER|DROP/i.test(sanitizedQuery)) {
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
    } catch (error) {
      // Handle timeout errors specifically for better error messages
      if (hasPgErrorCode(error, '57014')) {
        throw new Error('Query timeout: The query took longer than 30 seconds to execute');
      }
      // Re-throw other errors as-is
      throw error;
    } finally {
      await client.query('SET statement_timeout = 0').catch((error: unknown) => {
        releaseError = error instanceof Error ? error : new Error(String(error));
      });
      client.release(releaseError);
    }
  }

  async executeExplain(
    query: string,
    params: unknown[] = [],
    asRoot: boolean = false
  ): Promise<RawSQLResponse> {
    const readOnlyError = checkSqlReadOnly(query);
    if (readOnlyError) {
      throw new AppError(readOnlyError, 400, ERROR_CODES.INVALID_INPUT);
    }
    const sanitizedQuery = this.sanitizeQuery(query);
    const pool = this.dbManager.getPool();
    const client = await pool.connect();
    let releaseError: Error | undefined;

    try {
      // Set statement timeout at session level (30 seconds)
      await client.query('SET statement_timeout = 30000');

      // Start transaction block
      await client.query('BEGIN');

      const explainQuery = `EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS) ${sanitizedQuery}`;

      const result = asRoot
        ? await client.query<Record<string, unknown>>(explainQuery, params)
        : await withAdminContext(
            client,
            () => client.query<Record<string, unknown>>(explainQuery, params),
            true,
            (error) => {
              releaseError = error;
            }
          );

      const response: RawSQLResponse = {
        rows: result.rows || [],
        rowCount: result.rowCount,
        fields: result.fields?.map((field: { name: string; dataTypeID: number }) => ({
          name: field.name,
          dataTypeID: field.dataTypeID,
        })),
      };

      return response;
    } catch (error) {
      // Handle timeout errors specifically for better error messages
      if (hasPgErrorCode(error, '57014')) {
        throw new Error('Query timeout: The query took longer than 30 seconds to execute');
      }
      throw error;
    } finally {
      // Always rollback transaction to discard any mutations/context changes
      await client.query('ROLLBACK').catch((error: unknown) => {
        if (!releaseError) {
          releaseError = error instanceof Error ? error : new Error(String(error));
        }
      });
      await client.query('SET statement_timeout = 0').catch((error: unknown) => {
        if (!releaseError) {
          releaseError = error instanceof Error ? error : new Error(String(error));
        }
      });
      client.release(releaseError);
    }
  }

  private async exportTableSchemaBySQL(client: PoolClient, table: string): Promise<string> {
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

    if (schemaResult.rows.length) {
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

    if (indexesResult.rows.length) {
      sqlExport += `-- Indexes for table: ${table}\n`;
      for (const indexRow of indexesResult.rows) {
        sqlExport += indexRow.indexdef + ';\n';
      }
      sqlExport += '\n';
    }

    // Export foreign key constraints
    const foreignKeysResult = await client.query(
      `
      SELECT
        'ALTER TABLE ' || quote_ident(ct.relname) ||
        ' ADD CONSTRAINT ' || quote_ident(c.conname) ||
        ' FOREIGN KEY (' || string_agg(quote_ident(a1.attname), ', ' ORDER BY u.pos) || ')' ||
        ' REFERENCES ' || CASE WHEN nf.nspname = 'public' THEN quote_ident(cf.relname) ELSE quote_ident(nf.nspname) || '.' || quote_ident(cf.relname) END ||
        ' (' || string_agg(quote_ident(a2.attname), ', ' ORDER BY u.pos) || ')' ||
        CASE
          WHEN c.confdeltype = 'c' THEN ' ON DELETE CASCADE'
          WHEN c.confdeltype = 'n' THEN ' ON DELETE SET NULL'
          WHEN c.confdeltype = 'r' THEN ' ON DELETE RESTRICT'
          WHEN c.confdeltype = 'd' THEN ' ON DELETE SET DEFAULT'
          ELSE ''
        END ||
        CASE
          WHEN c.confupdtype = 'c' THEN ' ON UPDATE CASCADE'
          WHEN c.confupdtype = 'n' THEN ' ON UPDATE SET NULL'
          WHEN c.confupdtype = 'r' THEN ' ON UPDATE RESTRICT'
          WHEN c.confupdtype = 'd' THEN ' ON UPDATE SET DEFAULT'
          ELSE ''
        END || ';' as fk_statement,
        c.conname as constraint_name
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class ct ON c.conrelid = ct.oid
      JOIN pg_catalog.pg_namespace nt ON ct.relnamespace = nt.oid
      JOIN pg_catalog.pg_class cf ON c.confrelid = cf.oid
      JOIN pg_catalog.pg_namespace nf ON cf.relnamespace = nf.oid
      CROSS JOIN LATERAL unnest(c.conkey, c.confkey)
        WITH ORDINALITY AS u(src_attnum, ref_attnum, pos)
      JOIN pg_catalog.pg_attribute a1
        ON a1.attnum = u.src_attnum AND a1.attrelid = c.conrelid
      JOIN pg_catalog.pg_attribute a2
        ON a2.attnum = u.ref_attnum AND a2.attrelid = c.confrelid
      WHERE c.contype = 'f'
        AND nt.nspname = 'public'
        AND ct.relname = $1
      GROUP BY c.conname, ct.relname, nf.nspname, cf.relname, c.confdeltype, c.confupdtype
      ORDER BY c.conname
    `,
      [table]
    );

    if (foreignKeysResult.rows.length) {
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
      !!rlsResult.rows.length &&
      (rlsResult.rows[0].relrowsecurity === true || rlsResult.rows[0].relrowsecurity === 1);
    if (rlsEnabled) {
      sqlExport += `-- RLS enabled for table: ${table}\n`;
      sqlExport += `ALTER TABLE ${pgFormat('%I', table)} ENABLE ROW LEVEL SECURITY;\n\n`;
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

    if (policiesResult.rows.length) {
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

    if (triggersResult.rows.length) {
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
      if (tables && tables.length) {
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

            if (rows.length) {
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
                tableDataSql += `INSERT INTO ${pgFormat('%I', table)} (${columns.map((c) => pgFormat('%I', c)).join(', ')}) VALUES (${values.join(', ')});\n`;
              }
            }

            if (wasTruncated) {
              const countResult = await client.query(pgFormat('SELECT COUNT(*) FROM %I', table));
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

          if (functionsResult.rows.length) {
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

          if (sequencesResult.rows.length) {
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

          if (viewsResult.rows.length) {
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
          ...(truncatedTables.length && {
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

          // Get foreign keys (one entity per constraint, columns in ordinal order)
          const foreignKeysResult = await client.query(FOREIGN_KEY_INTROSPECTION_QUERY, [
            'public',
            table,
          ]);

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
            !!rlsResult.rows.length &&
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
          const rows: Record<string, unknown>[] = [];
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
            foreignKeys: groupForeignKeyRows(foreignKeysResult.rows as ForeignKeyRow[]),
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
          ...(truncatedTables.length && {
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

      await withAdminContext(
        client,
        async () => {
          // If truncate is requested, truncate all public tables first
          if (truncate) {
            const tablesResult = await client.query(`
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public'
          `);

            for (const row of tablesResult.rows) {
              try {
                // Use a SAVEPOINT before each TRUNCATE so that a failure only rolls back
                // this single statement and does NOT abort the entire transaction (PG 25P02).
                // Without this, a failed TRUNCATE inside a transaction permanently poisons
                // the transaction and causes every subsequent query to fail with:
                // "ERROR: current transaction is aborted, commands ignored until end of transaction block"
                await client.query('SAVEPOINT truncate_attempt');
                await client.query(pgFormat('TRUNCATE TABLE %I CASCADE', row.tablename));
                await client.query('RELEASE SAVEPOINT truncate_attempt');
                logger.info(`Truncated table: ${row.tablename}`);
              } catch (err) {
                // Roll back to the savepoint to restore the transaction to a healthy state,
                // then release it to clean up the savepoint and prevent accumulation, then log and continue with the next table.
                await client.query('ROLLBACK TO SAVEPOINT truncate_attempt');
                await client.query('RELEASE SAVEPOINT truncate_attempt');
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
        },
        true
      );

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
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async bulkUpsertFromFile(
    schemaName: string,
    table: string,
    fileBuffer: Buffer,
    filename: string,
    upsertKey?: string
  ): Promise<BulkUpsertResponse> {
    validateSchemaName(schemaName);
    validateTableName(table);

    const fileExtension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    let records: Record<string, unknown>[] = [];

    // Parse file based on type
    try {
      if (fileExtension === '.csv') {
        records = parse(fileBuffer, {
          columns: true,
          skip_empty_lines: true,
          bom: true,
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

    if (!records || !records.length) {
      throw new AppError('No records found in file', 400, ERROR_CODES.INVALID_INPUT);
    }

    // Perform the bulk insert
    const result = await this.bulkInsert(schemaName, table, records, upsertKey);

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
    schemaName: string,
    table: string,
    records: Record<string, unknown>[],
    upsertKey?: string
  ): Promise<{ rowCount: number; rows?: unknown[] }> {
    if (!records || !records.length) {
      throw new AppError('No records to insert', 400, ERROR_CODES.INVALID_INPUT);
    }

    const pool = this.dbManager.getPool();

    try {
      // Group records by their key shape (sorted keys signature) to prevent data loss
      // and avoid overwriting existing non-null columns with NULL during upserts.
      const groupsMap = new Map<
        string,
        { columns: string[]; records: Record<string, unknown>[] }
      >();

      for (const record of records) {
        const keys: string[] = [];
        for (const key of Object.keys(record)) {
          keys.push(key);
        }
        keys.sort();
        const signature = keys.join(',');

        let group = groupsMap.get(signature);
        if (!group) {
          group = {
            columns: keys,
            records: [],
          };
          groupsMap.set(signature, group);
        }
        group.records.push(record);
      }

      const client = await pool.connect();
      let releaseError: Error | undefined;
      let totalRowCount = 0;
      const allRows: unknown[] = [];

      try {
        await withAdminContext(
          client,
          async () => {
            await client.query('BEGIN');
            try {
              for (const { columns, records: groupRecords } of groupsMap.values()) {
                // Convert records to array format for pg-format.
                const values = groupRecords.map((record) =>
                  columns.map((col) => {
                    const value = record[col];
                    // pg-format handles NULL, dates, JSON automatically.
                    // Convert empty strings and undefined to NULL for consistency (preserving original behaviour).
                    return value === '' || value === undefined ? null : value;
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

                  if (updateColumns.length) {
                    // Build UPDATE SET clause
                    const updateClause = updateColumns
                      .map((col) => pgFormat('%I = EXCLUDED.%I', col, col))
                      .join(', ');

                    query = pgFormat(
                      'INSERT INTO %I.%I (%I) VALUES %L ON CONFLICT (%I) DO UPDATE SET %s',
                      schemaName,
                      table,
                      columns,
                      values,
                      upsertKey,
                      updateClause
                    );
                  } else {
                    // No columns to update, just do nothing on conflict
                    query = pgFormat(
                      'INSERT INTO %I.%I (%I) VALUES %L ON CONFLICT (%I) DO NOTHING',
                      schemaName,
                      table,
                      columns,
                      values,
                      upsertKey
                    );
                  }
                } else {
                  // Simple insert
                  query = pgFormat(
                    'INSERT INTO %I.%I (%I) VALUES %L',
                    schemaName,
                    table,
                    columns,
                    values
                  );
                }

                const result = await client.query(query);

                totalRowCount += result.rowCount || 0;
                if (result.rows) {
                  allRows.push(...result.rows);
                }
              }

              // Refresh schema cache if needed
              await client.query(`NOTIFY pgrst, 'reload schema';`);
              await client.query('COMMIT');
            } catch (err) {
              await client.query('ROLLBACK').catch(() => {});
              throw err;
            }
          },
          false,
          (error) => {
            releaseError = error;
          }
        );

        return {
          rowCount: totalRowCount,
          rows: allRows,
        };
      } finally {
        client.release(releaseError);
      }
    } catch (error) {
      // Log the error for debugging
      logger.error('Bulk insert error:', error);

      // Re-throw with better error message
      if (error instanceof AppError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Bulk insert failed';
      throw new AppError(message, 400, ERROR_CODES.INVALID_INPUT);
    }
  }
}
