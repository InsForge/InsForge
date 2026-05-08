import { AppError } from '@/api/middlewares/error.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import type { DatabaseRecord } from '@/types/database.js';
import { escapeSqlLikePattern, validateTableName } from '@/utils/validations.js';
import { assertWritableDatabaseSchema, quoteIdentifier, quoteQualifiedName } from './helpers.js';

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
}

const TEXT_LIKE_DATA_TYPES = new Set(['text', 'character varying', 'character', 'citext']);

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
    const metadata = await this.getTableColumnMetadata(schemaName, tableName);
    const { whereSql, params } = this.buildWhereClause(metadata, options);
    const qualifiedTableName = quoteQualifiedName(schemaName, tableName);
    const orderBySql = this.buildOrderByClause(metadata, options.sort);

    const countResult = await this.dbManager.getPool().query<{
      total: string;
    }>(`SELECT COUNT(*)::text AS total FROM ${qualifiedTableName}${whereSql}`, params);

    const dataParams = [...params, options.limit, options.offset];
    const limitPlaceholder = `$${params.length + 1}`;
    const offsetPlaceholder = `$${params.length + 2}`;
    const recordsResult = await this.dbManager
      .getPool()
      .query<DatabaseRecord>(
        `SELECT * FROM ${qualifiedTableName}${whereSql}${orderBySql} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
        dataParams
      );

    return {
      records: recordsResult.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
    };
  }

  async lookupRecord(
    schemaName: string,
    tableName: string,
    columnName: string,
    value: string
  ): Promise<DatabaseRecord | null> {
    validateTableName(tableName);
    const metadata = await this.getTableColumnMetadata(schemaName, tableName);
    this.assertColumnExists(metadata, columnName);

    const qualifiedTableName = quoteQualifiedName(schemaName, tableName);
    const result = await this.dbManager
      .getPool()
      .query<DatabaseRecord>(
        `SELECT * FROM ${qualifiedTableName} WHERE ${quoteIdentifier(columnName)} = $1 LIMIT 1`,
        [value]
      );

    return result.rows[0] ?? null;
  }

  async createRecords(
    schemaName: string,
    tableName: string,
    records: DatabaseRecord[]
  ): Promise<DatabaseRecord[]> {
    validateTableName(tableName);
    assertWritableDatabaseSchema(schemaName);

    const metadata = await this.getTableColumnMetadata(schemaName, tableName);
    const qualifiedTableName = quoteQualifiedName(schemaName, tableName);
    const client = await this.dbManager.getPool().connect();
    const createdRecords: DatabaseRecord[] = [];
    let transactionStarted = false;

    try {
      await client.query('BEGIN');
      transactionStarted = true;

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

      await client.query('COMMIT');
      transactionStarted = false;

      return createdRecords;
    } catch (error) {
      if (transactionStarted) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updateRecord(
    schemaName: string,
    tableName: string,
    pkColumn: string,
    pkValue: string,
    data: DatabaseRecord
  ): Promise<DatabaseRecord> {
    validateTableName(tableName);
    assertWritableDatabaseSchema(schemaName);

    const metadata = await this.getTableColumnMetadata(schemaName, tableName);
    this.assertColumnExists(metadata, pkColumn);

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
    const values = entries.map(([, value]) => value);
    values.push(pkValue);

    const qualifiedTableName = quoteQualifiedName(schemaName, tableName);
    const result = await this.dbManager
      .getPool()
      .query<DatabaseRecord>(
        `UPDATE ${qualifiedTableName} SET ${assignments.join(', ')} WHERE ${quoteIdentifier(pkColumn)} = $${values.length} RETURNING *`,
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
  }

  async deleteRecords(
    schemaName: string,
    tableName: string,
    pkColumn: string,
    pkValues: string[]
  ): Promise<number> {
    validateTableName(tableName);
    assertWritableDatabaseSchema(schemaName);

    const metadata = await this.getTableColumnMetadata(schemaName, tableName);
    this.assertColumnExists(metadata, pkColumn);

    if (pkValues.length === 0) {
      return 0;
    }

    const placeholders = pkValues.map((_, index) => `$${index + 1}`);
    const qualifiedTableName = quoteQualifiedName(schemaName, tableName);
    const result = await this.dbManager
      .getPool()
      .query(
        `DELETE FROM ${qualifiedTableName} WHERE ${quoteIdentifier(pkColumn)} IN (${placeholders.join(', ')})`,
        pkValues
      );

    return result.rowCount ?? 0;
  }

  private async getTableColumnMetadata(
    schemaName: string,
    tableName: string
  ): Promise<TableColumnMetadata> {
    const result = await this.dbManager.getPool().query<{
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

    return {
      columnTypeMap,
      nullableColumns,
      searchableColumns,
    };
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
