import { AppError } from '@/utils/errors.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { ERROR_CODES, type AdminTableRecordPrimaryKey } from '@insforge/shared-schemas';
import type { PoolClient } from 'pg';
import type { DatabaseRecord } from '@/types/database.js';
import { TEXT_LIKE_DATA_TYPES } from '@/utils/constants.js';
import { escapeSqlLikePattern, validateTableName } from '@/utils/validations.js';
import { quoteIdentifier, quoteQualifiedName } from './helpers.js';
import { withAdminContext } from './user-context.service.js';

interface SortClause {
  columnName: string;
  direction: 'asc' | 'desc';
}

interface ListTableRecordsOptions {
  limit: number;
  offset: number;
  search?: string;
  sort?: SortClause[];
  filterColumn?: string;
  filterValue?: string;
}

interface TableColumnMetadata {
  columnTypeMap: Record<string, string>;
  nullableColumns: Set<string>;
  searchableColumns: string[];
  primaryKeyColumns: string[];
}

// A record's primary key as a map of column name -> value. Supports composite keys.
type PrimaryKey = AdminTableRecordPrimaryKey;

export class AdminRecordService {
  private static instance: AdminRecordService;
  private dbManager = DatabaseManager.getInstance();

  private constructor() {}

  public static getInstance(): AdminRecordService {
    if (!AdminRecordService.instance) {
      AdminRecordService.instance = new AdminRecordService();
    }
    return AdminRecordService.instance;
  }

  async listRecords(
    schemaName: string,
    tableName: string,
    options: ListTableRecordsOptions
  ): Promise<{ records: DatabaseRecord[]; total: number }> {
    validateTableName(tableName);

    return this.withAdminTransaction(async (client) => {
      const metadata = await this.getTableColumnMetadata(schemaName, tableName, client);
      const { whereSql, params } = this.buildWhereClause(metadata, options);
      const qualifiedTableName = quoteQualifiedName(schemaName, tableName);
      const orderBySql = this.buildOrderByClause(metadata, options.sort);

      const countResult = await client.query<{
        total: string;
      }>(`SELECT COUNT(*)::text AS total FROM ${qualifiedTableName}${whereSql}`, params);

      const dataParams = [...params, options.limit, options.offset];
      const limitPlaceholder = `$${params.length + 1}`;
      const offsetPlaceholder = `$${params.length + 2}`;
      const recordsResult = await client.query<DatabaseRecord>(
        `SELECT * FROM ${qualifiedTableName}${whereSql}${orderBySql} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
        dataParams
      );

      return {
        records: recordsResult.rows,
        total: Number(countResult.rows[0]?.total ?? 0),
      };
    });
  }

  async lookupRecord(
    schemaName: string,
    tableName: string,
    columnName: string,
    value: string
  ): Promise<DatabaseRecord | null> {
    validateTableName(tableName);

    return this.withAdminTransaction(async (client) => {
      const metadata = await this.getTableColumnMetadata(schemaName, tableName, client);
      this.assertColumnExists(metadata, columnName);

      const qualifiedTableName = quoteQualifiedName(schemaName, tableName);
      const result = await client.query<DatabaseRecord>(
        `SELECT * FROM ${qualifiedTableName} WHERE ${quoteIdentifier(columnName)} = $1 LIMIT 1`,
        [value]
      );

      return result.rows[0] ?? null;
    });
  }

  async createRecords(
    schemaName: string,
    tableName: string,
    records: DatabaseRecord[]
  ): Promise<DatabaseRecord[]> {
    validateTableName(tableName);

    return this.withAdminTransaction(async (client) => {
      const createdRecords: DatabaseRecord[] = [];
      const metadata = await this.getTableColumnMetadata(schemaName, tableName, client);
      const qualifiedTableName = quoteQualifiedName(schemaName, tableName);

      for (const record of records) {
        const sanitizedRecord = this.sanitizeInsertRecord(record, metadata);
        const entries = Object.entries(sanitizedRecord);

        if (entries.length === 0) {
          const result = await client.query<DatabaseRecord>(
            `INSERT INTO ${qualifiedTableName} DEFAULT VALUES RETURNING *`
          );
          createdRecords.push(...result.rows);
          continue;
        }

        const columns = entries.map(([columnName]) => quoteIdentifier(columnName));
        const placeholders = entries.map((_, index) => `$${index + 1}`);
        const values = entries.map(([, value]) => value);

        const result = await client.query<DatabaseRecord>(
          `INSERT INTO ${qualifiedTableName} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
          values
        );
        createdRecords.push(...result.rows);
      }

      return createdRecords;
    });
  }

  async updateRecord(
    schemaName: string,
    tableName: string,
    primaryKey: PrimaryKey,
    data: DatabaseRecord
  ): Promise<DatabaseRecord> {
    validateTableName(tableName);

    const keyEntries = Object.entries(primaryKey);
    if (keyEntries.length === 0) {
      throw new AppError(
        'Primary key is required to update a record.',
        400,
        ERROR_CODES.INVALID_INPUT,
        'Provide at least one primary key column and value.'
      );
    }

    return this.withAdminTransaction(async (client) => {
      const metadata = await this.getTableColumnMetadata(schemaName, tableName, client);
      keyEntries.forEach(([columnName]) => this.assertColumnExists(metadata, columnName));
      this.assertCompletePrimaryKey(
        metadata,
        keyEntries.map(([columnName]) => columnName)
      );

      const sanitizedRecord = this.sanitizeUpdateRecord(data, metadata);
      const entries = Object.entries(sanitizedRecord);

      if (entries.length === 0) {
        throw new AppError(
          'No valid fields to update.',
          400,
          ERROR_CODES.INVALID_INPUT,
          'Provide at least one editable field with a non-empty value.'
        );
      }

      const assignments = entries.map(
        ([columnName], index) => `${quoteIdentifier(columnName)} = $${index + 1}`
      );
      const values: unknown[] = entries.map(([, value]) => value);

      // WHERE matches the full primary-key tuple so composite keys target exactly one row.
      const whereClauses = keyEntries.map(([columnName, value]) => {
        values.push(value);
        return `${quoteIdentifier(columnName)} = $${values.length}`;
      });

      const qualifiedTableName = quoteQualifiedName(schemaName, tableName);
      const result = await client.query<DatabaseRecord>(
        `UPDATE ${qualifiedTableName} SET ${assignments.join(', ')} WHERE ${whereClauses.join(
          ' AND '
        )} RETURNING *`,
        values
      );

      const updatedRecord = result.rows[0];
      if (!updatedRecord) {
        throw new AppError(
          'Record not found.',
          404,
          ERROR_CODES.DATABASE_NOT_FOUND,
          'Check the record identifier and try again.'
        );
      }

      return updatedRecord;
    });
  }

  async deleteRecords(
    schemaName: string,
    tableName: string,
    primaryKeys: PrimaryKey[]
  ): Promise<number> {
    validateTableName(tableName);

    return this.withAdminTransaction(async (client) => {
      const metadata = await this.getTableColumnMetadata(schemaName, tableName, client);

      if (primaryKeys.length === 0) {
        return 0;
      }

      const values: unknown[] = [];
      // Each selected row is matched by its full primary-key tuple, OR'd together,
      // so composite keys delete exactly the selected rows (not WHERE first_col IN (...)).
      const rowClauses = primaryKeys.map((primaryKey) => {
        const keyEntries = Object.entries(primaryKey);
        if (keyEntries.length === 0) {
          throw new AppError(
            'Primary key is required to delete a record.',
            400,
            ERROR_CODES.INVALID_INPUT,
            'Provide at least one primary key column and value for each record.'
          );
        }

        keyEntries.forEach(([columnName]) => this.assertColumnExists(metadata, columnName));
        this.assertCompletePrimaryKey(
          metadata,
          keyEntries.map(([columnName]) => columnName)
        );

        const columnClauses = keyEntries.map(([columnName, value]) => {
          values.push(value);
          return `${quoteIdentifier(columnName)} = $${values.length}`;
        });

        return `(${columnClauses.join(' AND ')})`;
      });

      const qualifiedTableName = quoteQualifiedName(schemaName, tableName);
      const result = await client.query(
        `DELETE FROM ${qualifiedTableName} WHERE ${rowClauses.join(' OR ')}`,
        values
      );

      return result.rowCount ?? 0;
    });
  }

  private async withAdminTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.dbManager.getPool().connect();
    let transactionStarted = false;
    let releaseError: Error | undefined;

    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const result = await withAdminContext(
        client,
        () => fn(client),
        true,
        (error) => {
          releaseError = error;
        }
      );

      await client.query('COMMIT');
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          releaseError =
            rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
        }
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }

  private async getTableColumnMetadata(
    schemaName: string,
    tableName: string,
    client?: PoolClient
  ): Promise<TableColumnMetadata> {
    const queryable = client ?? this.dbManager.getPool();
    const result = await queryable.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      udt_name: string;
    }>(
      `
        SELECT column_name, data_type, is_nullable, udt_name
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
        ORDER BY ordinal_position
      `,
      [schemaName, tableName]
    );

    if (result.rows.length === 0) {
      throw new AppError(
        'Table not found.',
        404,
        ERROR_CODES.DATABASE_NOT_FOUND,
        'Check the table name and schema, then try again.'
      );
    }

    const columnTypeMap: Record<string, string> = {};
    const nullableColumns = new Set<string>();
    const searchableColumns: string[] = [];

    for (const row of result.rows) {
      const normalizedDataType =
        row.data_type.toLowerCase() === 'user-defined'
          ? row.udt_name.toLowerCase()
          : row.data_type.toLowerCase();

      columnTypeMap[row.column_name] = normalizedDataType;

      if (TEXT_LIKE_DATA_TYPES.has(normalizedDataType)) {
        searchableColumns.push(row.column_name);
      }

      if (row.is_nullable === 'YES') {
        nullableColumns.add(row.column_name);
      }
    }

    const primaryKeyResult = await queryable.query<{ column_name: string }>(
      `
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = $1
          AND tc.table_name = $2
        ORDER BY kcu.ordinal_position
      `,
      [schemaName, tableName]
    );

    return {
      columnTypeMap,
      nullableColumns,
      searchableColumns,
      primaryKeyColumns: primaryKeyResult.rows.map((row) => row.column_name),
    };
  }

  /**
   * Ensures the supplied key columns are exactly the table's primary key, so a
   * partial composite key (e.g. only `tenant_id` of a `(tenant_id, item_id)` key)
   * can't match and mutate more rows than intended. Tables with no detected
   * primary key fall back to the caller-provided columns (validated for existence).
   */
  private assertCompletePrimaryKey(metadata: TableColumnMetadata, suppliedColumns: string[]): void {
    const { primaryKeyColumns } = metadata;
    if (primaryKeyColumns.length === 0) {
      return;
    }

    const suppliedSet = new Set(suppliedColumns);
    const matchesFullKey =
      suppliedSet.size === primaryKeyColumns.length &&
      primaryKeyColumns.every((column) => suppliedSet.has(column));

    if (!matchesFullKey) {
      throw new AppError(
        'Primary key does not match the table primary key.',
        400,
        ERROR_CODES.INVALID_INPUT,
        `Provide exactly these primary key columns: ${primaryKeyColumns.join(', ')}.`
      );
    }
  }

  private buildWhereClause(
    metadata: TableColumnMetadata,
    options: Pick<ListTableRecordsOptions, 'filterColumn' | 'filterValue' | 'search'>
  ): { whereSql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options.filterColumn && options.filterValue !== undefined) {
      this.assertColumnExists(metadata, options.filterColumn);
      params.push(options.filterValue);
      clauses.push(`${quoteIdentifier(options.filterColumn)} = $${params.length}`);
    }

    const trimmedSearch = options.search?.trim();
    if (trimmedSearch && metadata.searchableColumns.length > 0) {
      const escapedSearch = `%${escapeSqlLikePattern(trimmedSearch)}%`;
      const searchClauses = metadata.searchableColumns.map((columnName) => {
        params.push(escapedSearch);
        return `${quoteIdentifier(columnName)} ILIKE $${params.length} ESCAPE '\\'`;
      });
      clauses.push(`(${searchClauses.join(' OR ')})`);
    }

    return {
      whereSql: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  }

  private buildOrderByClause(
    metadata: TableColumnMetadata,
    sortClauses: SortClause[] | undefined
  ): string {
    if (!sortClauses || sortClauses.length === 0) {
      return '';
    }

    const normalizedClauses = sortClauses.map(({ columnName, direction }) => {
      this.assertColumnExists(metadata, columnName);
      const normalizedDirection = direction.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      return `${quoteIdentifier(columnName)} ${normalizedDirection}`;
    });

    return ` ORDER BY ${normalizedClauses.join(', ')}`;
  }

  private sanitizeInsertRecord(
    record: DatabaseRecord,
    metadata: TableColumnMetadata
  ): DatabaseRecord {
    const sanitizedRecord: DatabaseRecord = {};

    for (const [columnName, value] of Object.entries(record)) {
      this.assertColumnExists(metadata, columnName);

      if (value === '' && !TEXT_LIKE_DATA_TYPES.has(metadata.columnTypeMap[columnName] ?? '')) {
        continue;
      }

      sanitizedRecord[columnName] = value;
    }

    return sanitizedRecord;
  }

  private sanitizeUpdateRecord(
    record: DatabaseRecord,
    metadata: TableColumnMetadata
  ): DatabaseRecord {
    const sanitizedRecord: DatabaseRecord = {};

    for (const [columnName, value] of Object.entries(record)) {
      this.assertColumnExists(metadata, columnName);

      if (value === '') {
        const columnType = metadata.columnTypeMap[columnName] ?? '';

        if (TEXT_LIKE_DATA_TYPES.has(columnType)) {
          sanitizedRecord[columnName] = value;
          continue;
        }

        if (metadata.nullableColumns.has(columnName)) {
          sanitizedRecord[columnName] = null;
          continue;
        }

        throw new AppError(
          `Column "${columnName}" cannot be blank.`,
          400,
          ERROR_CODES.INVALID_INPUT,
          'Provide a value for required fields or clear only nullable non-text fields.'
        );
      }

      sanitizedRecord[columnName] = value;
    }

    return sanitizedRecord;
  }

  private assertColumnExists(metadata: TableColumnMetadata, columnName: string): void {
    if (!Object.prototype.hasOwnProperty.call(metadata.columnTypeMap, columnName)) {
      throw new AppError(
        `Unknown column "${columnName}".`,
        400,
        ERROR_CODES.INVALID_INPUT,
        'Check the table schema and try again.'
      );
    }
  }
}
